mod worker;

use soundflow_audio::Snapshot;
use tauri::{Manager, State};
use worker::{AudioHandle, Command};

#[tauri::command]
async fn audio_snapshot(audio: State<'_, AudioHandle>) -> Result<Snapshot, String> {
    audio.request(|reply| Command::Snapshot { reply }).await
}

#[tauri::command]
async fn audio_set_route(audio: State<'_, AudioHandle>, source: String, device: String) -> Result<(), String> {
    audio.request(|reply| Command::SetRoute { source, device, reply }).await
}

#[tauri::command]
async fn audio_set_source_volume(audio: State<'_, AudioHandle>, source: String, volume: u8) -> Result<(), String> {
    audio.request(|reply| Command::SetSourceVolume { source, volume, reply }).await
}

#[tauri::command]
async fn audio_set_source_enabled(audio: State<'_, AudioHandle>, source: String, enabled: bool) -> Result<(), String> {
    audio.request(|reply| Command::SetSourceEnabled { source, enabled, reply }).await
}

#[tauri::command]
async fn audio_set_device_volume(audio: State<'_, AudioHandle>, device: String, volume: u8) -> Result<(), String> {
    audio.request(|reply| Command::SetDeviceVolume { device, volume, reply }).await
}

pub fn run() {
    tauri::Builder::default()
        // 已经开着时再双击图标，就把现有窗口提到前面
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            app.manage(worker::spawn(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio_snapshot,
            audio_set_route,
            audio_set_source_volume,
            audio_set_source_enabled,
            audio_set_device_volume,
        ])
        .run(tauri::generate_context!())
        .expect("Sound Flow 启动失败");
}
