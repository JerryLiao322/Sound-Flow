use std::collections::HashMap;

use crate::model::{AudioError, Result, Snapshot};

/// 非 Windows 平台的占位实现：创建即失败，界面会显示提示
pub struct AudioSystem;

impl AudioSystem {
    pub fn new() -> Result<Self> {
        Err(AudioError::new("Sound Flow 目前只支持 Windows 10/11"))
    }

    pub fn refresh(&mut self) -> Result<()> {
        Ok(())
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot::default()
    }

    pub fn levels(&self) -> HashMap<String, f32> {
        HashMap::new()
    }

    pub fn set_route(&mut self, _source_id: &str, _device_id: &str) -> Result<()> {
        Err(unsupported())
    }

    pub fn set_source_volume(&mut self, _source_id: &str, _volume: u8) -> Result<()> {
        Err(unsupported())
    }

    pub fn set_source_enabled(&mut self, _source_id: &str, _enabled: bool) -> Result<()> {
        Err(unsupported())
    }

    pub fn set_device_volume(&mut self, _device_id: &str, _volume: u8) -> Result<()> {
        Err(unsupported())
    }
}

fn unsupported() -> AudioError {
    AudioError::new("当前平台不支持")
}
