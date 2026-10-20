mod policy;
mod process;

use std::collections::{BTreeSet, HashMap, HashSet};

use windows::core::{Interface, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::{PKEY_DeviceInterface_FriendlyName, PKEY_Device_DeviceDesc, PKEY_Device_FriendlyName};
use windows::Win32::Foundation::{PROPERTYKEY, S_OK};
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, AudioSessionStateActive, AudioSessionStateExpired, IAudioSessionControl, IAudioSessionControl2,
    IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    PKEY_AudioEndpoint_FormFactor,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc, PropVariantToUInt32};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

use crate::model::{
    app_id_from_path, build_sources, device_kind, disambiguate_names, from_percent, mm_device_id, name_from_path, policy_device_id,
    to_percent, AudioError, Device, Result, SessionInfo, Snapshot, Source,
};
use policy::PolicyConfig;

const SYSTEM_SOURCE_ID: &str = "system";

struct DeviceEntry {
    info: Device,
    volume: Option<IAudioEndpointVolume>,
}

struct SessionEntry {
    app_id: String,
    pid: u32,
    volume: ISimpleAudioVolume,
    meter: Option<IAudioMeterInformation>,
}

#[derive(Clone)]
struct ProcessInfo {
    app_id: String,
    name: String,
}

/// Windows Core Audio 的入口。持有 COM 对象，只能在创建它的线程上使用。
pub struct AudioSystem {
    enumerator: IMMDeviceEnumerator,
    policy: Option<PolicyConfig>,
    devices: Vec<DeviceEntry>,
    sessions: Vec<SessionEntry>,
    sources: Vec<Source>,
    default_device_id: String,
    processes: HashMap<u32, ProcessInfo>,
    own_pid: u32,
    // 必须最后一个 drop：上面的 COM 对象释放完才能 CoUninitialize
    _com: ComGuard,
}

struct ComGuard;

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

impl AudioSystem {
    pub fn new() -> Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok().map_err(context("初始化 COM 失败"))?;
        let com = ComGuard;
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(context("无法访问系统音频服务"))?;
        let mut system = Self {
            enumerator,
            // 拿不到也能用，只是不能按应用切设备
            policy: PolicyConfig::new().ok(),
            devices: Vec::new(),
            sessions: Vec::new(),
            sources: Vec::new(),
            default_device_id: String::new(),
            processes: HashMap::new(),
            own_pid: unsafe { GetCurrentProcessId() },
            _com: com,
        };
        system.refresh()?;
        Ok(system)
    }

    /// 重新枚举设备和音频会话
    pub fn refresh(&mut self) -> Result<()> {
        let enumerator = &self.enumerator;
        self.default_device_id = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
            .ok()
            .and_then(|d| device_id(&d))
            .unwrap_or_default();

        let collection = unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) }.map_err(context("枚举输出设备失败"))?;
        let count = unsafe { collection.GetCount() }.map_err(context("枚举输出设备失败"))?;

        let mut devices = Vec::new();
        let mut full_names = Vec::new();
        let mut sessions = Vec::new();
        let mut infos = Vec::new();
        let mut seen_pids = HashSet::new();

        for i in 0..count {
            let Ok(device) = (unsafe { collection.Item(i) }) else { continue };
            let Some(id) = device_id(&device) else { continue };
            let (info, full_name) = read_device(&device, id.clone());
            let volume = unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }.ok();
            let info = Device {
                volume: volume
                    .as_ref()
                    .and_then(|v| unsafe { v.GetMasterVolumeLevelScalar() }.ok())
                    .map(to_percent)
                    .unwrap_or(100),
                ..info
            };
            self.collect_sessions(&device, &id, &mut sessions, &mut infos, &mut seen_pids);
            devices.push(DeviceEntry { info, volume });
            full_names.push(full_name);
        }

        let mut device_infos: Vec<Device> = devices.iter().map(|d| d.info.clone()).collect();
        disambiguate_names(&mut device_infos, &full_names);
        for (entry, info) in devices.iter_mut().zip(device_infos) {
            entry.info = info;
        }

        let device_ids: Vec<String> = devices.iter().map(|d| d.info.id.clone()).collect();
        self.sources = build_sources(&infos, &device_ids, &self.default_device_id);
        self.devices = devices;
        self.sessions = sessions;
        self.processes.retain(|pid, _| seen_pids.contains(pid));
        Ok(())
    }

    fn collect_sessions(
        &mut self,
        device: &IMMDevice,
        device_id: &str,
        sessions: &mut Vec<SessionEntry>,
        infos: &mut Vec<SessionInfo>,
        seen_pids: &mut HashSet<u32>,
    ) {
        let Ok(manager) = (unsafe { device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) }) else { return };
        let Ok(list) = (unsafe { manager.GetSessionEnumerator() }) else { return };
        let count = unsafe { list.GetCount() }.unwrap_or(0);

        for i in 0..count {
            let Ok(control) = (unsafe { list.GetSession(i) }) else { continue };
            let Ok(state) = (unsafe { control.GetState() }) else { continue };
            if state == AudioSessionStateExpired {
                continue;
            }
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
            let system = unsafe { control2.IsSystemSoundsSession() } == S_OK;
            let pid = unsafe { control2.GetProcessId() }.unwrap_or(0);
            if !system && (pid == 0 || pid == self.own_pid) {
                continue;
            }
            let Ok(volume) = control.cast::<ISimpleAudioVolume>() else { continue };

            let (app_id, app_name) = if system {
                (SYSTEM_SOURCE_ID.to_string(), "系统声音".to_string())
            } else {
                seen_pids.insert(pid);
                let info = self.process_info(pid, &control);
                (info.app_id, info.name)
            };
            let persisted_device = if system {
                None
            } else {
                self.policy.as_ref().and_then(|p| p.get(pid)).and_then(|id| mm_device_id(&id).map(str::to_string))
            };

            infos.push(SessionInfo {
                app_id: app_id.clone(),
                app_name,
                system,
                device_id: device_id.to_string(),
                active: state == AudioSessionStateActive,
                volume: unsafe { volume.GetMasterVolume() }.unwrap_or(1.0),
                muted: unsafe { volume.GetMute() }.map(|b| b.as_bool()).unwrap_or(false),
                persisted_device,
            });
            sessions.push(SessionEntry { app_id, pid, meter: control.cast().ok(), volume });
        }
    }

    fn process_info(&mut self, pid: u32, control: &IAudioSessionControl) -> ProcessInfo {
        if let Some(info) = self.processes.get(&pid) {
            return info.clone();
        }
        let display = display_name(control);
        let info = match process::image_path(pid) {
            Some(path) => ProcessInfo {
                app_id: app_id_from_path(&path),
                name: display.or_else(|| process::file_description(&path)).unwrap_or_else(|| name_from_path(&path)),
            },
            // 受保护的进程读不到路径，按 pid 单独列出
            None => ProcessInfo { app_id: format!("pid-{pid}"), name: display.unwrap_or_else(|| format!("进程 {pid}")) },
        };
        self.processes.insert(pid, info.clone());
        info
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            sources: self.sources.clone(),
            devices: self.devices.iter().map(|d| d.info.clone()).collect(),
            default_device_id: self.default_device_id.clone(),
        }
    }

    /// 各声音流此刻的峰值电平（0–1），静音的记为 0
    pub fn levels(&self) -> HashMap<String, f32> {
        let mut levels: HashMap<String, f32> = HashMap::new();
        for s in &self.sessions {
            let peak = s.meter.as_ref().and_then(|m| unsafe { m.GetPeakValue() }.ok()).unwrap_or(0.0);
            let level = levels.entry(s.app_id.clone()).or_insert(0.0);
            *level = level.max(peak);
        }
        for source in &self.sources {
            if !source.enabled {
                levels.insert(source.id.clone(), 0.0);
            }
        }
        levels
    }

    pub fn set_route(&mut self, source_id: &str, device_id: &str) -> Result<()> {
        let policy = self
            .policy
            .as_ref()
            .ok_or_else(|| AudioError::new("这台电脑的 Windows 版本不支持按应用指定输出设备（需要 Windows 10 1803 或更新）"))?;
        if !self.devices.iter().any(|d| d.info.id == device_id) {
            return Err(AudioError::new("找不到这个输出设备，它可能已经断开"));
        }
        let pids: BTreeSet<u32> = self.sessions.iter().filter(|s| s.app_id == source_id && s.pid != 0).map(|s| s.pid).collect();
        if pids.is_empty() {
            return Err(AudioError::new("这一路声音不能单独指定输出设备"));
        }
        // 连到系统默认设备 = 清除单独指定，让它以后跟着系统默认走
        let target = (device_id != self.default_device_id).then(|| policy_device_id(device_id));
        for pid in pids {
            policy.set(pid, target.as_deref()).map_err(context("切换输出设备失败"))?;
        }
        // 先记下用户的选择，下一次刷新再以系统状态为准
        if let Some(source) = self.sources.iter_mut().find(|s| s.id == source_id) {
            source.device_id = device_id.to_string();
        }
        Ok(())
    }

    pub fn set_source_volume(&mut self, source_id: &str, volume: u8) -> Result<()> {
        let level = from_percent(volume);
        self.for_each_session(source_id, |s| unsafe { s.volume.SetMasterVolume(level, std::ptr::null()) })
            .map_err(context("调整应用音量失败"))?;
        if let Some(source) = self.sources.iter_mut().find(|s| s.id == source_id) {
            source.volume = volume.min(100);
        }
        Ok(())
    }

    pub fn set_source_enabled(&mut self, source_id: &str, enabled: bool) -> Result<()> {
        self.for_each_session(source_id, |s| unsafe { s.volume.SetMute(!enabled, std::ptr::null()) })
            .map_err(context("切换静音失败"))?;
        if let Some(source) = self.sources.iter_mut().find(|s| s.id == source_id) {
            source.enabled = enabled;
        }
        Ok(())
    }

    pub fn set_device_volume(&mut self, device_id: &str, volume: u8) -> Result<()> {
        let entry = self
            .devices
            .iter_mut()
            .find(|d| d.info.id == device_id)
            .ok_or_else(|| AudioError::new("找不到这个输出设备，它可能已经断开"))?;
        let control = entry.volume.as_ref().ok_or_else(|| AudioError::new("这个设备不支持调节音量"))?;
        unsafe { control.SetMasterVolumeLevelScalar(from_percent(volume), std::ptr::null()) }.map_err(context("调整设备音量失败"))?;
        entry.info.volume = volume.min(100);
        Ok(())
    }

    /// 对某一路的每个会话执行操作；只要有一个成功就算成功（有的会话可能刚好失效）
    fn for_each_session(
        &self,
        source_id: &str,
        mut op: impl FnMut(&SessionEntry) -> windows::core::Result<()>,
    ) -> windows::core::Result<()> {
        let mut last_error = None;
        let mut any_ok = false;
        for session in self.sessions.iter().filter(|s| s.app_id == source_id) {
            match op(session) {
                Ok(()) => any_ok = true,
                Err(e) => last_error = Some(e),
            }
        }
        match (any_ok, last_error) {
            (false, Some(e)) => Err(e),
            _ => Ok(()),
        }
    }
}

/// 在真实的 Windows 上跑一遍关键调用并报告结果（CI 和排查问题用）。
///
/// 重点验证按应用指定设备的未公开接口：对本进程写入一个设备再读回来，
/// 读回一致说明方法表的位置没算错。最后会清掉写入的设置。
pub fn diagnostics() -> Vec<String> {
    let mut lines = Vec::new();
    let mut probe_device = None;
    match AudioSystem::new() {
        Ok(system) => {
            let snapshot = system.snapshot();
            probe_device = snapshot.devices.first().map(|d| d.id.clone());
            lines.push(format!("audio: ok, {} device(s), {} source(s), default = {:?}", snapshot.devices.len(), snapshot.sources.len(), snapshot.default_device_id));
            for d in &snapshot.devices {
                lines.push(format!("  device {:?} ({:?}, {:?}, volume {})", d.name, d.detail, d.kind, d.volume));
            }
            for s in &snapshot.sources {
                lines.push(format!("  source {} {:?} -> {} (volume {}, enabled {})", s.id, s.name, s.device_id, s.volume, s.enabled));
            }
        }
        Err(e) => lines.push(format!("audio: failed: {e}")),
    }

    let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok();
    match PolicyConfig::new() {
        Ok(policy) => {
            let pid = unsafe { GetCurrentProcessId() };
            // 有真实设备就用真实设备，免得系统因为设备不存在而拒绝写入
            let probe = policy_device_id(
                probe_device.as_deref().unwrap_or("{0.0.0.00000000}.{00000000-0000-0000-0000-00000000c0de}"),
            );
            lines.push(format!("policy: factory ok ({})", policy.variant));
            lines.push(format!("policy: get before = {:?}", policy.get(pid)));
            lines.push(format!("policy: set probe = {:?}", policy.set(pid, Some(&probe)).map_err(|e| e.message())));
            let read_back = policy.get(pid);
            lines.push(format!("policy: get after = {read_back:?}"));
            lines.push(format!("policy: clear = {:?}", policy.set(pid, None).map_err(|e| e.message())));
            lines.push(format!("policy: get cleared = {:?}", policy.get(pid)));
            let verdict = match read_back {
                Some(id) if id.eq_ignore_ascii_case(&probe) => "ROUND_TRIP_OK",
                Some(_) => "ROUND_TRIP_MISMATCH",
                None => "ROUND_TRIP_EMPTY",
            };
            lines.push(format!("policy: {verdict}"));
        }
        Err(e) => lines.push(format!("policy: unavailable: {}", e.message())),
    }
    if com.is_ok() {
        unsafe { CoUninitialize() };
    }
    lines
}

fn context(what: &'static str) -> impl Fn(windows::core::Error) -> AudioError {
    move |e| AudioError::new(format!("{what}：{}", e.message()))
}

fn take_pwstr(p: PWSTR) -> Option<String> {
    if p.is_null() {
        return None;
    }
    let text = unsafe { p.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    text
}

fn device_id(device: &IMMDevice) -> Option<String> {
    take_pwstr(unsafe { device.GetId() }.ok()?)
}

/// 会话自己报的名字；空的或资源引用（@%SystemRoot%\…）就不用
fn display_name(control: &IAudioSessionControl) -> Option<String> {
    take_pwstr(unsafe { control.GetDisplayName() }.ok()?).filter(|n| !n.trim().is_empty() && !n.starts_with('@'))
}

fn read_device(device: &IMMDevice, id: String) -> (Device, String) {
    let store = unsafe { device.OpenPropertyStore(STGM_READ) }.ok();
    let text = |key: &PROPERTYKEY| store.as_ref().and_then(|s| prop_string(s, key)).unwrap_or_default();
    let interface_name = text(&PKEY_DeviceInterface_FriendlyName);
    let description = text(&PKEY_Device_DeviceDesc);
    let full_name = text(&PKEY_Device_FriendlyName);
    let form_factor = store.as_ref().and_then(|s| prop_u32(s, &PKEY_AudioEndpoint_FormFactor));
    let name = if interface_name.is_empty() { full_name.clone() } else { interface_name };
    let device = Device {
        id,
        kind: device_kind(form_factor, &format!("{name} {full_name}")),
        name,
        detail: description,
        volume: 100,
    };
    (device, full_name)
}

fn prop_string(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<String> {
    unsafe {
        let mut value = store.GetValue(key).ok()?;
        let text = PropVariantToStringAlloc(&value).ok().and_then(take_pwstr);
        let _ = PropVariantClear(&mut value);
        text.filter(|t| !t.is_empty())
    }
}

fn prop_u32(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<u32> {
    unsafe {
        let mut value = store.GetValue(key).ok()?;
        let number = PropVariantToUInt32(&value).ok();
        let _ = PropVariantClear(&mut value);
        number
    }
}
