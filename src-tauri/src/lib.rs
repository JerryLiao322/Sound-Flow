mod worker;

use soundflow_audio::Snapshot;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use worker::{AudioHandle, Command};

/// 开机自启时带上这个参数：只在托盘里运行，不弹窗口
const BACKGROUND_ARG: &str = "--background";

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

#[tauri::command]
async fn audio_set_default_device(audio: State<'_, AudioHandle>, device: String) -> Result<(), String> {
    audio.request(|reply| Command::SetDefaultDevice { device, reply }).await
}

#[tauri::command]
async fn audio_set_source_eq(audio: State<'_, AudioHandle>, source: String, gains: Vec<f32>) -> Result<(), String> {
    audio.request(|reply| Command::SetSourceEq { source, gains, reply }).await
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "打开 Sound Flow", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Sound Flow", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Sound Flow · 正在后台管理声音")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        // 已经开着时再双击图标，就把现有窗口提到前面
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_autostart::Builder::new().arg(BACKGROUND_ARG).build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state_file = app.path().app_data_dir().ok().map(|dir| dir.join("eq-routes.json"));
            app.manage(worker::spawn(app.handle().clone(), state_file));
            build_tray(app.handle())?;
            if !std::env::args().any(|arg| arg == BACKGROUND_ARG) {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗口只是收进托盘：开了声音曲线的应用要靠 Sound Flow 一直处理着
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            audio_snapshot,
            audio_set_route,
            audio_set_source_volume,
            audio_set_source_enabled,
            audio_set_device_volume,
            audio_set_default_device,
            audio_set_source_eq,
        ])
        .build(tauri::generate_context!())
        .expect("Sound Flow 启动失败");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // 真正退出前，把为声音曲线临时改过路由的应用切回原设备
            app.state::<AudioHandle>().shutdown_blocking();
        }
    });
}
