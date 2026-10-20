//! 音频线程：独占 [`AudioSystem`]（COM 对象不能跨线程），
//! 处理界面发来的命令，并定时把电平和设备/应用变化推给界面。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use soundflow_audio::{AudioSystem, Snapshot};
use tauri::{AppHandle, Emitter};

pub const SNAPSHOT_EVENT: &str = "audio://snapshot";
pub const LEVELS_EVENT: &str = "audio://levels";

const LEVEL_INTERVAL: Duration = Duration::from_millis(50);
const REFRESH_INTERVAL: Duration = Duration::from_millis(1000);
/// 切换设备后会话会搬到新设备上，早点刷新让界面尽快对上
const REFRESH_AFTER_ROUTE: Duration = Duration::from_millis(300);
/// 没变化也定期推一次完整快照，界面因此能自愈（比如某条指令失败、界面已经先改了）
const RESYNC_INTERVAL: Duration = Duration::from_secs(4);
/// 指令失败后多久推一次快照：要晚于界面「等系统确认」的 1.5 秒，否则会被当成旧值忽略
const RESYNC_AFTER_FAILURE: Duration = Duration::from_millis(1700);
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

type Reply<T> = Sender<Result<T, String>>;

pub enum Command {
    Snapshot { reply: Reply<Snapshot> },
    SetRoute { source: String, device: String, reply: Reply<()> },
    SetSourceVolume { source: String, volume: u8, reply: Reply<()> },
    SetSourceEnabled { source: String, enabled: bool, reply: Reply<()> },
    SetDeviceVolume { device: String, volume: u8, reply: Reply<()> },
    SetSourceEq { source: String, gains: Vec<f32>, reply: Reply<()> },
    /// 退出前：把为声音曲线改过路由的应用切回去，然后结束音频线程
    Shutdown { reply: Reply<()> },
}

impl Command {
    fn fail(self, message: &str) {
        // 界面那头可能已经不等了，发送失败无所谓
        match self {
            Command::Snapshot { reply } => {
                let _ = reply.send(Err(message.to_string()));
            }
            Command::SetRoute { reply, .. }
            | Command::SetSourceVolume { reply, .. }
            | Command::SetSourceEnabled { reply, .. }
            | Command::SetDeviceVolume { reply, .. }
            | Command::SetSourceEq { reply, .. }
            | Command::Shutdown { reply } => {
                let _ = reply.send(Err(message.to_string()));
            }
        }
    }
}

/// 放进 Tauri 托管状态，命令处理函数通过它和音频线程通信
pub struct AudioHandle(Sender<Command>);

impl AudioHandle {
    pub async fn request<T: Send + 'static>(&self, make: impl FnOnce(Reply<T>) -> Command + Send) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        self.0.send(make(tx)).map_err(|_| "音频服务已停止".to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(REPLY_TIMEOUT))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "音频服务没有响应".to_string())?
    }

    /// 在退出流程里同步调用：等音频线程把应用都切回原设备（最多等几秒）
    pub fn shutdown_blocking(&self) {
        let (tx, rx) = mpsc::channel();
        if self.0.send(Command::Shutdown { reply: tx }).is_ok() {
            let _ = rx.recv_timeout(REPLY_TIMEOUT);
        }
    }
}

/// state_file：记录为声音曲线临时改过路由的应用，崩溃后靠它恢复
pub fn spawn(app: AppHandle, state_file: Option<PathBuf>) -> AudioHandle {
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("audio".into())
        .spawn(move || run(app, rx, state_file))
        .expect("无法启动音频线程");
    AudioHandle(tx)
}

fn run(app: AppHandle, rx: Receiver<Command>, state_file: Option<PathBuf>) {
    let mut system = match AudioSystem::new(state_file) {
        Ok(system) => system,
        Err(e) => {
            let message = e.to_string();
            eprintln!("[audio] {message}");
            for command in rx {
                command.fail(&message);
            }
            return;
        }
    };

    let mut last_snapshot = system.snapshot();
    let mut levels_were_silent = false;
    let mut next_levels = Instant::now();
    let mut next_refresh = Instant::now() + REFRESH_INTERVAL;
    let mut next_resync = Instant::now() + RESYNC_INTERVAL;

    loop {
        let wait = next_levels.min(next_refresh).min(next_resync).saturating_duration_since(Instant::now());
        match rx.recv_timeout(wait) {
            Ok(Command::Shutdown { reply }) => {
                system.shutdown();
                let _ = reply.send(Ok(()));
                return;
            }
            Ok(command) => {
                let now = Instant::now();
                if matches!(command, Command::SetRoute { .. } | Command::SetSourceEq { .. }) {
                    next_refresh = next_refresh.min(now + REFRESH_AFTER_ROUTE);
                }
                if !handle(&mut system, command) {
                    next_resync = next_resync.min(now + RESYNC_AFTER_FAILURE);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        let now = Instant::now();
        let resync_due = now >= next_resync;
        if now >= next_refresh || resync_due {
            if let Err(e) = system.refresh() {
                eprintln!("[audio] {e}");
            }
            let snapshot = system.snapshot();
            if snapshot != last_snapshot || resync_due {
                let _ = app.emit(SNAPSHOT_EVENT, &snapshot);
                last_snapshot = snapshot;
                next_resync = now + RESYNC_INTERVAL;
            }
            next_refresh = now + REFRESH_INTERVAL;
        }
        if now >= next_levels {
            let levels: HashMap<String, f32> = system.levels();
            let silent = levels.values().all(|l| *l == 0.0);
            // 一直没声音时不用每 50ms 推一遍全零
            if !(silent && levels_were_silent) {
                let _ = app.emit(LEVELS_EVENT, &levels);
            }
            levels_were_silent = silent;
            next_levels = now + LEVEL_INTERVAL;
        }
    }
}

/// 执行一条指令并回复；返回是否成功
fn handle(system: &mut AudioSystem, command: Command) -> bool {
    let text = |e: soundflow_audio::AudioError| e.to_string();
    let result = match command {
        Command::Snapshot { reply } => {
            let _ = reply.send(Ok(system.snapshot()));
            return true;
        }
        Command::SetRoute { source, device, reply } => (reply, system.set_route(&source, &device)),
        Command::SetSourceVolume { source, volume, reply } => (reply, system.set_source_volume(&source, volume)),
        Command::SetSourceEnabled { source, enabled, reply } => (reply, system.set_source_enabled(&source, enabled)),
        Command::SetDeviceVolume { device, volume, reply } => (reply, system.set_device_volume(&device, volume)),
        Command::SetSourceEq { source, gains, reply } => (reply, system.set_source_eq(&source, &gains)),
        Command::Shutdown { reply } => {
            system.shutdown();
            let _ = reply.send(Ok(()));
            return true;
        }
    };
    let (reply, outcome) = result;
    let ok = outcome.is_ok();
    let _ = reply.send(outcome.map_err(text));
    ok
}
