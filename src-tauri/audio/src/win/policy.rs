//! 按应用指定输出设备。
//!
//! Windows「设置 → 声音 → 应用音量和设备首选项」背后用的是未公开的
//! `Windows.Media.Internal.AudioPolicyConfig` 激活工厂。接口在 Windows 11（build 21390）
//! 换过一次 IID，方法布局没变，所以两个 IID 依次试。EarTrumpet、SoundSwitch 也是这么做的。
//! 设置是按可执行文件持久化的，应用重启后依然生效。

use std::ffi::c_void;
use std::ptr::null_mut;

use windows::core::{Interface, GUID, HRESULT, HSTRING, IInspectable, IUnknown};
use windows::Win32::Foundation::E_NOINTERFACE;
use windows::Win32::Media::Audio::{eConsole, eMultimedia, eRender, EDataFlow, ERole};
use windows::Win32::System::WinRT::RoGetActivationFactory;

const CLASS_NAME: &str = "Windows.Media.Internal.AudioPolicyConfig";
const IID_21H2: GUID = GUID::from_u128(0xab3d4648_e242_459f_b02f_541c70306324);
const IID_DOWNLEVEL: GUID = GUID::from_u128(0x2a59116d_6c4f_45e0_a74f_707e3fef9258);

/// IUnknown(3) + IInspectable(3) + 19 个用不到的方法，之后才是我们要的三个
#[repr(C)]
struct Vtbl {
    _preceding: [usize; 25],
    set_persisted_default_audio_endpoint:
        unsafe extern "system" fn(this: *mut c_void, pid: u32, flow: EDataFlow, role: ERole, device_id: *mut c_void) -> HRESULT,
    get_persisted_default_audio_endpoint:
        unsafe extern "system" fn(this: *mut c_void, pid: u32, flow: EDataFlow, role: ERole, device_id: *mut *mut c_void) -> HRESULT,
}

pub struct PolicyConfig {
    factory: IUnknown,
    /// 拿到的是哪一版接口，诊断时用
    pub variant: &'static str,
}

impl PolicyConfig {
    pub fn new() -> windows::core::Result<Self> {
        let inspectable: IInspectable = unsafe { RoGetActivationFactory(&HSTRING::from(CLASS_NAME)) }?;
        for (iid, variant) in [(IID_21H2, "21H2+"), (IID_DOWNLEVEL, "downlevel")] {
            let mut raw = null_mut();
            if unsafe { inspectable.query(&iid, &mut raw) }.is_ok() && !raw.is_null() {
                return Ok(Self { factory: unsafe { IUnknown::from_raw(raw) }, variant });
            }
        }
        Err(E_NOINTERFACE.into())
    }

    fn vtbl(&self) -> &Vtbl {
        unsafe { &**(self.factory.as_raw() as *const *const Vtbl) }
    }

    /// 把进程的输出设备设为 `policy_device_id`（设备接口路径）；传 None 则恢复跟随系统默认
    pub fn set(&self, pid: u32, policy_device_id: Option<&str>) -> windows::core::Result<()> {
        let id = policy_device_id.map(HSTRING::from).unwrap_or_default();
        // HSTRING 是 #[repr(transparent)] 的句柄；按值借给 ABI，所有权仍在 `id`
        let raw_id: *mut c_void = unsafe { std::mem::transmute_copy(&id) };
        for role in [eMultimedia, eConsole] {
            unsafe { (self.vtbl().set_persisted_default_audio_endpoint)(self.factory.as_raw(), pid, eRender, role, raw_id) }
                .ok()?;
        }
        Ok(())
    }

    /// 读进程被指定的输出设备（设备接口路径）；没有指定时为 None
    pub fn get(&self, pid: u32) -> Option<String> {
        let mut out = HSTRING::new();
        let hr = unsafe {
            (self.vtbl().get_persisted_default_audio_endpoint)(
                self.factory.as_raw(),
                pid,
                eRender,
                eMultimedia,
                &mut out as *mut HSTRING as *mut *mut c_void,
            )
        };
        (hr.is_ok() && !out.is_empty()).then(|| out.to_string_lossy())
    }
}
