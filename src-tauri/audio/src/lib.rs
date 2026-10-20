//! Sound Flow 的音频后端。
//!
//! Windows 上通过 Core Audio 枚举输出设备和各应用的音频会话，
//! 并提供按应用切换输出设备、调应用/设备音量、静音、读实时电平的能力。
//! 其它平台只有一个返回「不支持」的占位实现，方便在任何系统上编译和测试。
//!
//! [`AudioSystem`] 持有 COM 对象，只能在创建它的线程上使用。

// 归并、ID 换算这些辅助函数只有 Windows 实现在用，其它平台上只跑测试
#[cfg_attr(not(windows), allow(dead_code))]
mod model;
pub mod dsp;
#[cfg_attr(not(windows), allow(dead_code))]
mod routes_file;

pub use model::{from_percent, to_percent, AudioError, Device, DeviceKind, EqStatus, Result, Snapshot, Source, SourceKind};

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::{diagnostics, AudioSystem};

#[cfg(not(windows))]
mod unsupported;
#[cfg(not(windows))]
pub use unsupported::AudioSystem;
