use std::fmt;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    Speaker,
    Headphones,
    Monitor,
    Virtual,
}

/// 一个输出设备（Windows 里的一个播放端点）
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// MMDevice 端点 ID，如 `{0.0.0.00000000}.{guid}`
    pub id: String,
    pub name: String,
    pub detail: String,
    pub kind: DeviceKind,
    /// 设备主音量 0–100
    pub volume: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    App,
    System,
}

/// 一路声音流：同一个程序（可执行文件）的所有音频会话合在一起
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// 可执行文件名（小写），如 `spotify.exe`；系统声音为 `system`
    pub id: String,
    pub name: String,
    pub kind: SourceKind,
    /// 至少有一个会话正在发声
    pub active: bool,
    /// 没有被静音
    pub enabled: bool,
    /// 应用音量 0–100
    pub volume: u8,
    pub device_id: String,
    /// 系统声音只能跟随默认设备，不能单独路由
    pub routable: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub sources: Vec<Source>,
    pub devices: Vec<Device>,
    pub default_device_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioError(pub String);

impl AudioError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for AudioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AudioError {}

pub type Result<T> = std::result::Result<T, AudioError>;

pub fn to_percent(scalar: f32) -> u8 {
    (scalar.clamp(0.0, 1.0) * 100.0).round() as u8
}

pub fn from_percent(percent: u8) -> f32 {
    f32::from(percent.min(100)) / 100.0
}

/// 一个音频会话在某一时刻的状态，由平台层采集，再交给 [`build_sources`] 归并
#[derive(Debug, Clone)]
pub(crate) struct SessionInfo {
    pub app_id: String,
    pub app_name: String,
    pub system: bool,
    pub device_id: String,
    pub active: bool,
    pub volume: f32,
    pub muted: bool,
    /// 用户在 Windows 里为这个进程指定过的输出设备（MMDevice ID）
    pub persisted_device: Option<String>,
}

/// 把会话按程序归并成声音流，保持第一次出现的顺序
pub(crate) fn build_sources(sessions: &[SessionInfo], device_ids: &[String], default_device_id: &str) -> Vec<Source> {
    let mut order: Vec<&str> = Vec::new();
    for s in sessions {
        if !order.contains(&s.app_id.as_str()) {
            order.push(&s.app_id);
        }
    }

    order
        .into_iter()
        .map(|app_id| {
            let group: Vec<&SessionInfo> = sessions.iter().filter(|s| s.app_id == app_id).collect();
            let first = group[0];
            let lead = group.iter().find(|s| s.active).copied().unwrap_or(first);
            let known = |id: &String| device_ids.iter().any(|d| d == id);
            let device_id = group
                .iter()
                .find_map(|s| s.persisted_device.as_ref().filter(|id| known(id)))
                .or_else(|| Some(&lead.device_id).filter(|id| known(id)))
                .cloned()
                .unwrap_or_else(|| default_device_id.to_string());
            Source {
                id: app_id.to_string(),
                name: group.iter().map(|s| s.app_name.as_str()).find(|n| !n.is_empty()).unwrap_or(app_id).to_string(),
                kind: if first.system { SourceKind::System } else { SourceKind::App },
                active: group.iter().any(|s| s.active),
                enabled: group.iter().any(|s| !s.muted),
                volume: to_percent(lead.volume),
                device_id,
                routable: !first.system,
            }
        })
        .collect()
}

const MMDEVAPI_TOKEN: &str = r"\\?\SWD#MMDEVAPI#";
const DEVINTERFACE_AUDIO_RENDER: &str = "#{e6327cad-dcec-4949-ae8a-991e976a79d2}";

/// 按应用指定设备的接口要的是设备接口路径，而不是裸的端点 ID
pub(crate) fn policy_device_id(mm_device_id: &str) -> String {
    format!("{MMDEVAPI_TOKEN}{mm_device_id}{DEVINTERFACE_AUDIO_RENDER}")
}

/// [`policy_device_id`] 的反向转换
pub(crate) fn mm_device_id(policy_id: &str) -> Option<&str> {
    let lower_prefix = policy_id.get(..MMDEVAPI_TOKEN.len())?;
    if !lower_prefix.eq_ignore_ascii_case(MMDEVAPI_TOKEN) {
        return None;
    }
    let rest = &policy_id[MMDEVAPI_TOKEN.len()..];
    let end = rest.len().checked_sub(DEVINTERFACE_AUDIO_RENDER.len())?;
    rest.get(end..)
        .filter(|suffix| suffix.eq_ignore_ascii_case(DEVINTERFACE_AUDIO_RENDER))
        .map(|_| &rest[..end])
        .filter(|id| !id.is_empty())
}

/// 依据 PKEY_AudioEndpoint_FormFactor 和名字判断设备类型
pub(crate) fn device_kind(form_factor: Option<u32>, name: &str) -> DeviceKind {
    let lower = name.to_lowercase();
    if ["virtual", "cable", "vb-audio", "voicemeeter", "虚拟"].iter().any(|k| lower.contains(k)) {
        return DeviceKind::Virtual;
    }
    match form_factor {
        // Headphones / Headset / Handset
        Some(3) | Some(5) | Some(6) => DeviceKind::Headphones,
        // DigitalAudioDisplayDevice（HDMI / DP 显示器）
        Some(9) => DeviceKind::Monitor,
        _ => DeviceKind::Speaker,
    }
}

/// 可执行文件路径 → 声音流 ID（文件名小写）
pub(crate) fn app_id_from_path(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_lowercase()
}

/// 没有版本信息时，用文件名凑一个能看的名字：`steamwebhelper.exe` → `Steamwebhelper`
pub(crate) fn name_from_path(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
    let mut chars = stem.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// 名字重复的设备（同一块声卡的扬声器和耳机口）改用完整名称区分
pub(crate) fn disambiguate_names(devices: &mut [Device], full_names: &[String]) {
    let names: Vec<String> = devices.iter().map(|d| d.name.clone()).collect();
    for (i, device) in devices.iter_mut().enumerate() {
        let duplicated = names.iter().filter(|n| **n == names[i]).count() > 1;
        if (duplicated || device.name.is_empty()) && !full_names[i].is_empty() {
            device.name = full_names[i].clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(app: &str, device: &str) -> SessionInfo {
        SessionInfo {
            app_id: app.into(),
            app_name: String::new(),
            system: false,
            device_id: device.into(),
            active: false,
            volume: 1.0,
            muted: false,
            persisted_device: None,
        }
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn groups_sessions_by_app_in_first_seen_order() {
        let sessions = [session("chrome.exe", "a"), session("spotify.exe", "a"), session("chrome.exe", "b")];
        let sources = build_sources(&sessions, &ids(&["a", "b"]), "a");
        assert_eq!(sources.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["chrome.exe", "spotify.exe"]);
        assert_eq!(sources[0].name, "chrome.exe");
    }

    #[test]
    fn device_prefers_persisted_then_active_session() {
        let mut idle = session("game.exe", "a");
        idle.volume = 0.3;
        let mut playing = session("game.exe", "b");
        playing.active = true;
        playing.volume = 0.8;
        let sources = build_sources(&[idle.clone(), playing.clone()], &ids(&["a", "b", "c"]), "a");
        assert_eq!(sources[0].device_id, "b");
        assert_eq!(sources[0].volume, 80);
        assert!(sources[0].active);

        idle.persisted_device = Some("c".into());
        let sources = build_sources(&[idle, playing], &ids(&["a", "b", "c"]), "a");
        assert_eq!(sources[0].device_id, "c");
    }

    #[test]
    fn unknown_devices_fall_back_to_default() {
        let mut s = session("x.exe", "gone");
        s.persisted_device = Some("also-gone".into());
        assert_eq!(build_sources(&[s], &ids(&["a"]), "a")[0].device_id, "a");
    }

    #[test]
    fn enabled_unless_every_session_is_muted() {
        let mut a = session("x.exe", "a");
        a.muted = true;
        let b = session("x.exe", "a");
        assert!(build_sources(&[a.clone(), b], &ids(&["a"]), "a")[0].enabled);
        assert!(!build_sources(&[a], &ids(&["a"]), "a")[0].enabled);
    }

    #[test]
    fn system_sounds_are_not_routable() {
        let mut s = session("system", "a");
        s.system = true;
        let source = &build_sources(&[s], &ids(&["a"]), "a")[0];
        assert_eq!(source.kind, SourceKind::System);
        assert!(!source.routable);
    }

    #[test]
    fn policy_ids_round_trip() {
        let id = "{0.0.0.00000000}.{3b6f8f3e-1111-2222-3333-444455556666}";
        let wrapped = policy_device_id(id);
        assert!(wrapped.starts_with(r"\\?\SWD#MMDEVAPI#{0.0.0"));
        assert_eq!(mm_device_id(&wrapped), Some(id));
        assert_eq!(mm_device_id(&wrapped.to_uppercase()), Some(id.to_uppercase().as_str()));
        assert_eq!(mm_device_id("garbage"), None);
        assert_eq!(mm_device_id(""), None);
    }

    #[test]
    fn percent_conversions_clamp() {
        assert_eq!(to_percent(0.724), 72);
        assert_eq!(to_percent(1.7), 100);
        assert_eq!(to_percent(-1.0), 0);
        assert_eq!(from_percent(150), 1.0);
    }

    #[test]
    fn kinds_and_names() {
        assert_eq!(device_kind(Some(3), "WH-1000XM5"), DeviceKind::Headphones);
        assert_eq!(device_kind(Some(9), "LG ULTRAGEAR"), DeviceKind::Monitor);
        assert_eq!(device_kind(Some(1), "CABLE Input (VB-Audio Virtual Cable)"), DeviceKind::Virtual);
        assert_eq!(device_kind(None, "Harman Kardon"), DeviceKind::Speaker);
        assert_eq!(app_id_from_path(r"C:\Users\me\AppData\Roaming\Spotify\Spotify.exe"), "spotify.exe");
        assert_eq!(name_from_path(r"C:\Games\valorant.exe"), "Valorant");
    }

    #[test]
    fn duplicate_device_names_use_full_name() {
        let device = |name: &str| Device {
            id: name.into(),
            name: name.into(),
            detail: String::new(),
            kind: DeviceKind::Speaker,
            volume: 50,
        };
        let mut devices = vec![device("Realtek(R) Audio"), device("Realtek(R) Audio"), device("Harman Kardon")];
        let full = ids(&["扬声器 (Realtek(R) Audio)", "耳机 (Realtek(R) Audio)", "扬声器 (Harman Kardon)"]);
        disambiguate_names(&mut devices, &full);
        assert_eq!(devices[0].name, "扬声器 (Realtek(R) Audio)");
        assert_eq!(devices[1].name, "耳机 (Realtek(R) Audio)");
        assert_eq!(devices[2].name, "Harman Kardon");
    }
}
