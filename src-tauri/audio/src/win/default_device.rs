//! 设置系统默认输出设备。
//!
//! Windows 没有公开的接口，「声音」控制面板里的「设为默认值」用的是未公开的
//! `IPolicyConfig`（CPolicyConfigClient）。Windows 7 起方法布局没变，EarTrumpet、
//! SoundSwitch、AudioDeviceCmdlets 都是这么做的。

use std::ffi::c_void;
use std::ptr::null_mut;

use windows::core::{Interface, GUID, HRESULT, HSTRING, IUnknown, PCWSTR};
use windows::Win32::Media::Audio::{eConsole, eMultimedia, ERole};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

const CLSID_POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
const IID_POLICY_CONFIG: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);

/// IUnknown(3) + 10 个用不到的方法（混音格式、处理周期、共享模式、属性读写），之后是 SetDefaultEndpoint
#[repr(C)]
struct Vtbl {
    _preceding: [usize; 13],
    set_default_endpoint: unsafe extern "system" fn(this: *mut c_void, device_id: PCWSTR, role: ERole) -> HRESULT,
}

/// 把 `device_id`（MMDevice ID）设为系统默认输出设备。
///
/// 和控制面板的「设为默认设备」一样，只改「默认设备」（多媒体 + 控制台），
/// 不动「默认通信设备」，免得语音软件被一起切走。
pub fn set_default_endpoint(device_id: &str) -> windows::core::Result<()> {
    let client: IUnknown = unsafe { CoCreateInstance(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL) }?;
    let mut raw = null_mut();
    unsafe { client.query(&IID_POLICY_CONFIG, &mut raw) }.ok()?;
    let config = unsafe { IUnknown::from_raw(raw) };
    let vtbl = unsafe { &**(config.as_raw() as *const *const Vtbl) };
    let id = HSTRING::from(device_id);
    for role in [eConsole, eMultimedia] {
        unsafe { (vtbl.set_default_endpoint)(config.as_raw(), PCWSTR(id.as_ptr()), role) }.ok()?;
    }
    Ok(())
}
