mod eq_stream;
mod policy;
mod process;

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::PathBuf;

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

use crate::dsp;
use crate::model::{
    app_id_from_path, build_sources, device_kind, disambiguate_names, from_percent, is_virtual_cable, mm_device_id,
    name_from_path, policy_device_id, to_percent, AudioError, Device, EqStatus, Result, SessionInfo, Snapshot, Source,
};
use crate::routes_file::{RoutesFile, SavedRoute};
use eq_stream::EqStream;
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

/// 用来接住开了声音曲线的应用原声的虚拟声卡；每个开曲线的应用独占一块
struct Sink {
    id: String,
    name: String,
}

/// 一个开了声音曲线的应用。它在 Windows 里被路由到自己独占的虚拟声卡 sink，
/// 用户听到的是处理流送到 target 的版本；音量和开关也由处理流负责。
struct EqEntry {
    gains: Vec<f32>,
    sink: String,
    target: String,
    volume: u8,
    enabled: bool,
    stream: Option<EqStream>,
    /// 已经转去虚拟声卡的进程
    routed_pids: HashSet<u32>,
}

impl EqEntry {
    fn gain(&self) -> f32 {
        if self.enabled {
            from_percent(self.volume)
        } else {
            0.0
        }
    }

    fn saved(&self) -> SavedRoute {
        SavedRoute { target: self.target.clone(), volume: self.volume, enabled: self.enabled }
    }
}

/// Windows Core Audio 的入口。持有 COM 对象，只能在创建它的线程上使用。
pub struct AudioSystem {
    enumerator: IMMDeviceEnumerator,
    policy: Option<PolicyConfig>,
    devices: Vec<DeviceEntry>,
    sessions: Vec<SessionEntry>,
    sources: Vec<Source>,
    default_device_id: String,
    /// 每个应用在 Windows 里被单独指定的输出设备
    persisted: HashMap<String, String>,
    sinks: Vec<Sink>,
    eq: HashMap<String, EqEntry>,
    /// 曲线没能生效的应用和原因（出错后已经恢复直接输出）
    eq_failures: HashMap<String, String>,
    routes: RoutesFile,
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
    /// state_file：记录「为声音曲线临时改过路由的应用」的文件，用来在崩溃后恢复
    pub fn new(state_file: Option<PathBuf>) -> Result<Self> {
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
            persisted: HashMap::new(),
            sinks: Vec::new(),
            eq: HashMap::new(),
            eq_failures: HashMap::new(),
            routes: RoutesFile::load(state_file),
            processes: HashMap::new(),
            own_pid: unsafe { GetCurrentProcessId() },
            _com: com,
        };
        system.refresh()?;
        Ok(system)
    }

    /// 重新枚举设备和音频会话，并让声音曲线的处理流跟上变化
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
        let mut sinks = Vec::new();

        for i in 0..count {
            let Ok(device) = (unsafe { collection.Item(i) }) else { continue };
            let Some(id) = device_id(&device) else { continue };
            let (info, full_name) = read_device(&device, id.clone());
            // 虚拟声卡里的会话也要枚举（开了曲线的应用就在那里），但它本身不作为可选的输出设备
            self.collect_sessions(&device, &id, &mut sessions, &mut infos, &mut seen_pids);
            if is_virtual_cable(&full_name) {
                sinks.push(Sink { id, name: full_name });
                continue;
            }
            let volume = unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }.ok();
            let info = Device {
                volume: volume
                    .as_ref()
                    .and_then(|v| unsafe { v.GetMasterVolumeLevelScalar() }.ok())
                    .map(to_percent)
                    .unwrap_or(100),
                ..info
            };
            devices.push(DeviceEntry { info, volume });
            full_names.push(full_name);
        }

        let mut device_infos: Vec<Device> = devices.iter().map(|d| d.info.clone()).collect();
        disambiguate_names(&mut device_infos, &full_names);
        for (entry, info) in devices.iter_mut().zip(device_infos) {
            entry.info = info;
        }

        let device_ids: Vec<String> = devices.iter().map(|d| d.info.id.clone()).collect();
        self.persisted = HashMap::new();
        for info in &infos {
            if let Some(device) = &info.persisted_device {
                self.persisted.entry(info.app_id.clone()).or_insert_with(|| device.clone());
            }
        }
        self.sources = build_sources(&infos, &device_ids, &self.default_device_id);
        self.devices = devices;
        self.sessions = sessions;
        self.sinks = sinks;
        self.processes.retain(|pid, _| seen_pids.contains(pid));

        self.recover_stranded();
        self.maintain_eq();
        self.apply_eq_overrides();
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
            // 自己的会话（声音曲线的处理流）不列出来
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

    fn app_pids(&self, app_id: &str) -> Vec<u32> {
        let set: BTreeSet<u32> = self.sessions.iter().filter(|s| s.app_id == app_id && s.pid != 0).map(|s| s.pid).collect();
        set.into_iter().collect()
    }

    /// 让某个应用回到 target（等于系统默认时就恢复「跟随默认」），并还原它的音量和开关
    fn release_app(&self, app_id: &str, target: &str, volume: u8, enabled: bool) {
        let target = if self.devices.iter().any(|d| d.info.id == target) { target } else { &self.default_device_id };
        let policy_target = (target != self.default_device_id).then(|| policy_device_id(target));
        if let Some(policy) = &self.policy {
            for pid in self.app_pids(app_id) {
                let _ = policy.set(pid, policy_target.as_deref());
            }
        }
        for session in self.sessions.iter().filter(|s| s.app_id == app_id) {
            unsafe {
                let _ = session.volume.SetMasterVolume(from_percent(volume), std::ptr::null());
                let _ = session.volume.SetMute(!enabled, std::ptr::null());
            }
        }
    }

    /// 上次没来得及切回（崩溃、直接关机）而留在虚拟声卡里的应用，按记录送回原设备
    fn recover_stranded(&mut self) {
        let stranded: Vec<(String, SavedRoute)> = self
            .sources
            .iter()
            .filter(|s| !self.eq.contains_key(&s.id))
            .filter_map(|s| self.routes.get(&s.id).map(|saved| (s.id.clone(), saved.clone())))
            .collect();
        for (app_id, saved) in stranded {
            let on_sink = self.persisted.get(&app_id).is_some_and(|d| self.sinks.iter().any(|s| &s.id == d));
            if on_sink {
                self.release_app(&app_id, &saved.target, saved.volume, saved.enabled);
                if let Some(source) = self.sources.iter_mut().find(|s| s.id == app_id) {
                    source.device_id = saved.target.clone();
                    source.volume = saved.volume;
                    source.enabled = saved.enabled;
                }
            }
            // 不在虚拟声卡里了（用户在别处改过），记录也就没用了
            self.routes.remove(&app_id);
        }
    }

    /// 让每个开了曲线的应用：都在自己的虚拟声卡里、都有一路在跑的处理流。
    /// 处理流出错就立刻恢复直接输出，绝不让应用一直没声音。
    fn maintain_eq(&mut self) {
        let mut failed: Vec<(String, String)> = Vec::new();
        {
            let Self { eq, sessions, policy, persisted, sinks, .. } = self;
            for (app_id, entry) in eq.iter_mut() {
                if !sinks.iter().any(|s| s.id == entry.sink) {
                    failed.push((app_id.clone(), "虚拟声卡不见了，已恢复直接输出".into()));
                    continue;
                }
                if let Some(stream) = &entry.stream {
                    if stream.is_finished() {
                        let reason = stream.error().unwrap_or_else(|| "处理意外停止".into());
                        failed.push((app_id.clone(), format!("{reason}，已恢复直接输出")));
                        continue;
                    }
                }

                let pids: BTreeSet<u32> =
                    sessions.iter().filter(|s| &s.app_id == app_id && s.pid != 0).map(|s| s.pid).collect();
                // 用户在 Windows 设置里把它改走了：重新转回虚拟声卡，否则会听到两遍
                if persisted.get(app_id).is_some_and(|d| *d != entry.sink) {
                    entry.routed_pids.clear();
                }
                entry.routed_pids.retain(|pid| pids.contains(pid));
                let sink_route = policy_device_id(&entry.sink);
                if let Some(policy) = policy {
                    for &pid in &pids {
                        if !entry.routed_pids.contains(&pid) && policy.set(pid, Some(&sink_route)).is_ok() {
                            entry.routed_pids.insert(pid);
                        }
                    }
                }
                // 原声在虚拟声卡里保持满音量，真正的音量在处理流里控制
                for session in sessions.iter().filter(|s| &s.app_id == app_id) {
                    unsafe {
                        if session.volume.GetMasterVolume().is_ok_and(|v| v < 0.999) {
                            let _ = session.volume.SetMasterVolume(1.0, std::ptr::null());
                        }
                        if session.volume.GetMute().is_ok_and(|m| m.as_bool()) {
                            let _ = session.volume.SetMute(false, std::ptr::null());
                        }
                    }
                }

                if entry.stream.as_ref().is_some_and(|s| s.target_id != entry.target) {
                    entry.stream = None;
                }
                if entry.stream.is_none() {
                    entry.stream = Some(EqStream::start(&entry.sink, &entry.target, &entry.gains, entry.gain()));
                }
            }
        }
        for (app_id, reason) in failed {
            self.disengage(&app_id);
            self.eq_failures.insert(app_id, reason);
        }
    }

    /// 开了曲线的应用，界面上显示的是用户选的设备、处理流里的音量
    fn apply_eq_overrides(&mut self) {
        for source in &mut self.sources {
            if let Some(entry) = self.eq.get(&source.id) {
                source.device_id = entry.target.clone();
                source.volume = entry.volume;
                source.enabled = entry.enabled;
                source.eq_active = entry.stream.as_ref().is_some_and(|s| !s.is_finished());
                // 精确到 0.1 秒，避免快照每次都变
                source.eq_seconds = entry.stream.as_ref().map_or(0.0, |s| (s.audible_seconds() * 10.0).floor() / 10.0);
            }
            source.eq_error = self.eq_failures.get(&source.id).cloned();
        }
    }

    fn disengage(&mut self, app_id: &str) {
        let Some(entry) = self.eq.remove(app_id) else { return };
        let saved = entry.saved();
        // 先停处理流（drop 时会等线程退出），再把应用切回去
        drop(entry);
        self.release_app(app_id, &saved.target, saved.volume, saved.enabled);
        self.routes.remove(app_id);
        if let Some(source) = self.sources.iter_mut().find(|s| s.id == app_id) {
            source.device_id = saved.target;
            source.volume = saved.volume;
            source.enabled = saved.enabled;
            source.eq_active = false;
            source.eq_seconds = 0.0;
        }
    }

    fn free_sink(&self) -> Option<&Sink> {
        self.sinks.iter().find(|s| !self.eq.values().any(|e| e.sink == s.id))
    }

    /// 退出前调用：所有开了曲线的应用都切回原设备、还原音量
    pub fn shutdown(&mut self) {
        let apps: Vec<String> = self.eq.keys().cloned().collect();
        for app_id in apps {
            self.disengage(&app_id);
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            sources: self.sources.clone(),
            devices: self.devices.iter().map(|d| d.info.clone()).collect(),
            default_device_id: self.default_device_id.clone(),
            eq: EqStatus {
                available: !self.sinks.is_empty() && self.policy.is_some(),
                sink_name: self.sinks.first().map(|s| s.name.clone()),
                free_sinks: self.sinks.iter().filter(|s| !self.eq.values().any(|e| e.sink == s.id)).count(),
            },
        }
    }

    /// 各声音流此刻的峰值电平（0–1），静音的记为 0；开了曲线的取处理后的电平
    pub fn levels(&self) -> HashMap<String, f32> {
        let mut levels: HashMap<String, f32> = HashMap::new();
        for s in self.sessions.iter().filter(|s| !self.eq.contains_key(&s.app_id)) {
            let peak = s.meter.as_ref().and_then(|m| unsafe { m.GetPeakValue() }.ok()).unwrap_or(0.0);
            let level = levels.entry(s.app_id.clone()).or_insert(0.0);
            *level = level.max(peak);
        }
        for source in &self.sources {
            if !source.enabled {
                levels.insert(source.id.clone(), 0.0);
            }
        }
        for (app_id, entry) in &self.eq {
            levels.insert(app_id.clone(), entry.stream.as_ref().map_or(0.0, EqStream::level));
        }
        levels
    }

    pub fn set_route(&mut self, source_id: &str, device_id: &str) -> Result<()> {
        if !self.devices.iter().any(|d| d.info.id == device_id) {
            return Err(AudioError::new("找不到这个输出设备，它可能已经断开"));
        }
        // 开了曲线的应用仍留在虚拟声卡里，只是把处理流改送到新设备
        if let Some(entry) = self.eq.get_mut(source_id) {
            entry.target = device_id.to_string();
            let saved = entry.saved();
            self.routes.set(source_id, saved);
            self.maintain_eq();
            self.apply_eq_overrides();
            return Ok(());
        }
        let policy = self
            .policy
            .as_ref()
            .ok_or_else(|| AudioError::new("这台电脑的 Windows 版本不支持按应用指定输出设备（需要 Windows 10 1803 或更新）"))?;
        let pids = self.app_pids(source_id);
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
        let volume = volume.min(100);
        if let Some(entry) = self.eq.get_mut(source_id) {
            entry.volume = volume;
            if let Some(stream) = &entry.stream {
                stream.update(&entry.gains, entry.gain());
            }
            let saved = entry.saved();
            self.routes.set(source_id, saved);
        } else {
            let level = from_percent(volume);
            self.for_each_session(source_id, |s| unsafe { s.volume.SetMasterVolume(level, std::ptr::null()) })
                .map_err(context("调整应用音量失败"))?;
        }
        if let Some(source) = self.sources.iter_mut().find(|s| s.id == source_id) {
            source.volume = volume;
        }
        Ok(())
    }

    pub fn set_source_enabled(&mut self, source_id: &str, enabled: bool) -> Result<()> {
        if let Some(entry) = self.eq.get_mut(source_id) {
            entry.enabled = enabled;
            if let Some(stream) = &entry.stream {
                stream.update(&entry.gains, entry.gain());
            }
            let saved = entry.saved();
            self.routes.set(source_id, saved);
        } else {
            self.for_each_session(source_id, |s| unsafe { s.volume.SetMute(!enabled, std::ptr::null()) })
                .map_err(context("切换静音失败"))?;
        }
        if let Some(source) = self.sources.iter_mut().find(|s| s.id == source_id) {
            source.enabled = enabled;
        }
        Ok(())
    }

    /// 设置某个应用的声音曲线（十段增益，dB）。平直的曲线不做任何处理，应用直接输出。
    pub fn set_source_eq(&mut self, source_id: &str, gains: &[f32]) -> Result<()> {
        if gains.len() != dsp::BANDS.len() {
            return Err(AudioError::new("声音曲线的频段数量不对"));
        }
        if dsp::is_flat(gains) {
            self.disengage(source_id);
            self.eq_failures.remove(source_id);
            self.apply_eq_overrides();
            return Ok(());
        }
        if let Some(entry) = self.eq.get_mut(source_id) {
            entry.gains = gains.to_vec();
            if let Some(stream) = &entry.stream {
                stream.update(gains, entry.gain());
            }
            return Ok(());
        }

        if self.sinks.is_empty() {
            return Err(AudioError::new("没有找到虚拟声卡，声音曲线暂时只能保存。装好 VB-CABLE 后就能生效"));
        }
        // 已经因为同样的原因失败过：等用户把曲线调回平直再重来，免得拖动曲线时反复失败
        if self.eq_failures.contains_key(source_id) {
            return Ok(());
        }
        let Some(sink) = self.free_sink().map(|s| s.id.clone()) else {
            let message = "每块虚拟声卡同时只能给一个应用用，现在都被占用了。要同时给更多应用开曲线，可以再装一块（如 VB-CABLE A+B）";
            self.eq_failures.insert(source_id.to_string(), message.into());
            self.apply_eq_overrides();
            return Ok(());
        };
        if self.policy.is_none() {
            return Err(AudioError::new("这台电脑的 Windows 版本不支持按应用处理声音"));
        }
        let source = self
            .sources
            .iter()
            .find(|s| s.id == source_id)
            .ok_or_else(|| AudioError::new("这个应用已经不在使用声音了"))?;
        if !source.routable {
            return Err(AudioError::new("系统声音不能单独加声音曲线"));
        }
        let entry = EqEntry {
            gains: gains.to_vec(),
            sink,
            target: source.device_id.clone(),
            volume: source.volume,
            enabled: source.enabled,
            stream: None,
            routed_pids: HashSet::new(),
        };
        // 先记下原来的去向再改路由，崩溃了也能恢复
        self.routes.set(source_id, entry.saved());
        self.eq.insert(source_id.to_string(), entry);
        self.maintain_eq();
        self.apply_eq_overrides();
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

impl Drop for AudioSystem {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// 在真实的 Windows 上跑一遍关键调用并报告结果（CI 和排查问题用）。
///
/// 重点验证按应用指定设备的未公开接口：对本进程写入一个设备再读回来，
/// 读回一致说明方法表的位置没算错。最后会清掉写入的设置。
pub fn diagnostics() -> Vec<String> {
    let mut lines = Vec::new();
    let mut probe_device = None;
    match AudioSystem::new(None) {
        Ok(system) => {
            let snapshot = system.snapshot();
            probe_device = snapshot.devices.first().map(|d| d.id.clone());
            lines.push(format!(
                "audio: ok, {} device(s), {} source(s), default = {:?}, eq sink = {:?}",
                snapshot.devices.len(),
                snapshot.sources.len(),
                snapshot.default_device_id,
                snapshot.eq.sink_name
            ));
            lines.push(format!("  eq: available {}, free sinks {}", snapshot.eq.available, snapshot.eq.free_sinks));
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
