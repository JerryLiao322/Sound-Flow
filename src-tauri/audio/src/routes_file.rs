//! 记录「为了声音曲线被临时转到虚拟声卡的应用，本来要去哪个设备、原来的音量是多少」。
//!
//! 正常退出时会把这些应用切回原设备并清空记录；如果程序崩溃或关机没来得及切回，
//! 下次看到这个应用时就按这份记录把它送回去，免得它一直在虚拟声卡里「没声」。

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct SavedRoute {
    /// 用户选的输出设备（MMDevice ID）
    pub target: String,
    /// 转去虚拟声卡之前的应用音量 0–100 和开关
    pub volume: u8,
    pub enabled: bool,
}

pub(crate) struct RoutesFile {
    path: Option<PathBuf>,
    routes: BTreeMap<String, SavedRoute>,
}

impl RoutesFile {
    /// path 为 None 时只在内存里记，不落盘
    pub fn load(path: Option<PathBuf>) -> Self {
        let routes = path
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self { path, routes }
    }

    pub fn get(&self, app_id: &str) -> Option<&SavedRoute> {
        self.routes.get(app_id)
    }

    pub fn set(&mut self, app_id: &str, route: SavedRoute) {
        if self.routes.get(app_id) != Some(&route) {
            self.routes.insert(app_id.to_string(), route);
            self.save();
        }
    }

    pub fn remove(&mut self, app_id: &str) {
        if self.routes.remove(app_id).is_some() {
            self.save();
        }
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(&self.routes) {
            // 先写临时文件再改名，写到一半断电也不会留下坏文件
            let tmp = path.with_extension("tmp");
            if fs::write(&tmp, text).is_ok() {
                let _ = fs::rename(&tmp, path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(target: &str) -> SavedRoute {
        SavedRoute { target: target.into(), volume: 70, enabled: true }
    }

    #[test]
    fn survives_a_restart_and_tolerates_garbage() {
        let dir = std::env::temp_dir().join(format!("soundflow-routes-{}", std::process::id()));
        let path = dir.join("eq-routes.json");

        let mut file = RoutesFile::load(Some(path.clone()));
        file.set("spotify.exe", route("{hk}"));
        file.set("game.exe", route("{headset}"));
        file.remove("game.exe");

        let reloaded = RoutesFile::load(Some(path.clone()));
        assert_eq!(reloaded.get("spotify.exe"), Some(&route("{hk}")));
        assert_eq!(reloaded.get("game.exe"), None);

        fs::write(&path, "not json").unwrap();
        assert!(RoutesFile::load(Some(path)).get("spotify.exe").is_none());
        let _ = fs::remove_dir_all(dir);
    }
}
