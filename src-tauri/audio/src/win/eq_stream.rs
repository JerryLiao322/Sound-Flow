//! 一路声音曲线处理流：抓取某个进程（连同子进程）发出的声音 → 均衡 → 送到目标设备。
//!
//! 应用本身被路由到一块没人听的虚拟声卡，所以用户只会听到这里处理过的版本。
//! 每路流跑在自己的线程上，用 MMCSS「Pro Audio」优先级减少爆音。

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use wasapi::{AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};
use windows::core::w;
use windows::Win32::System::Threading::{AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW};

use crate::dsp::{self, Equalizer, CHANNELS, SAMPLE_RATE};

/// 抓取缓冲 20ms；输出缓冲 100ms，但实际只保持很浅的水位
const CAPTURE_BUFFER_HNS: i64 = 200_000;
const RENDER_BUFFER_HNS: i64 = 1_000_000;
/// 整条处理链（自己手里 + 设备缓冲里）最多积压 80ms，多了就丢最旧的，延迟不会越拖越长
const MAX_LATENCY_FRAMES: usize = SAMPLE_RATE as usize * 80 / 1000;
const WAIT_MS: u32 = 20;
const BYTES_PER_SAMPLE: usize = 4;

#[derive(Clone)]
struct Params {
    gains: Vec<f32>,
    volume: f32,
    revision: u64,
}

struct Shared {
    params: Mutex<Params>,
    stop: AtomicBool,
    finished: AtomicBool,
    /// f32 的位模式
    level: AtomicU32,
    error: Mutex<Option<String>>,
}

pub struct EqStream {
    pub pid: u32,
    pub device_id: String,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl EqStream {
    /// 开始处理进程 pid 的声音，输出到 device_id；volume 为 0–1 的线性音量（静音传 0）
    pub fn start(pid: u32, device_id: &str, gains: &[f32], volume: f32) -> Self {
        let shared = Arc::new(Shared {
            params: Mutex::new(Params { gains: gains.to_vec(), volume, revision: 0 }),
            stop: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            level: AtomicU32::new(0),
            error: Mutex::new(None),
        });
        let worker = shared.clone();
        let device = device_id.to_string();
        let thread = thread::Builder::new()
            .name(format!("eq-{pid}"))
            .spawn(move || {
                if let Err(message) = run(pid, &device, &worker) {
                    *worker.error.lock().unwrap_or_else(|e| e.into_inner()) = Some(message);
                }
                worker.finished.store(true, Ordering::SeqCst);
            });
        let thread = match thread {
            Ok(handle) => Some(handle),
            Err(e) => {
                *shared.error.lock().unwrap_or_else(|e| e.into_inner()) = Some(format!("无法启动处理线程：{e}"));
                shared.finished.store(true, Ordering::SeqCst);
                None
            }
        };
        Self { pid, device_id: device_id.to_string(), shared, thread }
    }

    pub fn update(&self, gains: &[f32], volume: f32) {
        let mut params = self.shared.params.lock().unwrap_or_else(|e| e.into_inner());
        if params.gains != gains || params.volume != volume {
            params.gains = gains.to_vec();
            params.volume = volume;
            params.revision += 1;
        }
    }

    pub fn level(&self) -> f32 {
        f32::from_bits(self.shared.level.load(Ordering::Relaxed))
    }

    /// 线程已经退出（出错或被停止）
    pub fn is_finished(&self) -> bool {
        self.shared.finished.load(Ordering::SeqCst)
    }

    pub fn error(&self) -> Option<String> {
        self.shared.error.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

impl Drop for EqStream {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

fn context<E: std::fmt::Display>(what: &'static str) -> impl Fn(E) -> String {
    move |e| format!("{what}：{e}")
}

fn run(pid: u32, device_id: &str, shared: &Shared) -> Result<(), String> {
    let _ = wasapi::initialize_mta();
    let mut task_index = 0u32;
    let mmcss = unsafe { AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index) }.ok();
    let result = pump(pid, device_id, shared);
    if let Some(handle) = mmcss {
        let _ = unsafe { AvRevertMmThreadCharacteristics(handle) };
    }
    result
}

fn pump(pid: u32, device_id: &str, shared: &Shared) -> Result<(), String> {
    // 抓取和输出都用 48kHz 双声道 32 位浮点，系统负责和设备格式互转
    let format = WaveFormat::new(32, 32, &SampleType::Float, SAMPLE_RATE as usize, CHANNELS, None);
    let block_align = format.get_blockalign() as usize;

    let mut capture = AudioClient::new_application_loopback_client(pid, true).map_err(context("无法抓取应用的声音"))?;
    capture
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: CAPTURE_BUFFER_HNS },
        )
        .map_err(context("无法抓取应用的声音"))?;
    let capture_event = capture.set_get_eventhandle().map_err(context("无法抓取应用的声音"))?;
    let capture_client = capture.get_audiocaptureclient().map_err(context("无法抓取应用的声音"))?;

    let device = DeviceEnumerator::new()
        .and_then(|e| e.get_device(device_id))
        .map_err(context("找不到目标设备"))?;
    let mut render = device.get_iaudioclient().map_err(context("无法打开目标设备"))?;
    render
        .initialize_client(
            &format,
            &Direction::Render,
            &StreamMode::PollingShared { autoconvert: true, buffer_duration_hns: RENDER_BUFFER_HNS },
        )
        .map_err(context("无法打开目标设备"))?;
    let render_client = render.get_audiorenderclient().map_err(context("无法打开目标设备"))?;

    let initial = shared.params.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let mut eq = Equalizer::new(&initial.gains, initial.volume);
    let mut revision = initial.revision;

    let mut pending: VecDeque<f32> = VecDeque::with_capacity(MAX_LATENCY_FRAMES * CHANNELS * 2);
    let mut packet: Vec<u8> = Vec::new();
    let mut samples: Vec<f32> = Vec::new();
    let mut out: Vec<u8> = Vec::new();
    let mut level = 0f32;

    render.start_stream().map_err(context("无法开始播放"))?;
    capture.start_stream().map_err(context("无法开始抓取"))?;

    let outcome = loop {
        if shared.stop.load(Ordering::SeqCst) {
            break Ok(());
        }
        // 应用暂停时不会有新数据，超时属于正常情况
        let _ = capture_event.wait_for_event(WAIT_MS);

        {
            let params = shared.params.lock().unwrap_or_else(|e| e.into_inner());
            if params.revision != revision {
                eq.set_gains(&params.gains);
                eq.set_volume(params.volume);
                revision = params.revision;
            }
        }

        // 把抓到的所有数据处理掉
        let mut peak = 0f32;
        loop {
            let frames = match capture_client.get_next_packet_size() {
                Ok(Some(n)) if n > 0 => n as usize,
                Ok(_) => break,
                Err(e) => return finish(&capture, &render, Err(format!("抓取中断：{e}"))),
            };
            packet.resize(frames * block_align, 0);
            let (read, info) = match capture_client.read_from_device(&mut packet) {
                Ok(result) => result,
                Err(e) => return finish(&capture, &render, Err(format!("抓取中断：{e}"))),
            };
            let read = read as usize;
            samples.clear();
            if info.flags.silent {
                samples.resize(read * CHANNELS, 0.0);
            } else {
                samples.extend(
                    packet[..read * block_align]
                        .chunks_exact(BYTES_PER_SAMPLE)
                        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
                );
            }
            peak = peak.max(eq.process(&mut samples));
            pending.extend(samples.iter().copied());
        }
        level = peak.max(level * 0.8);
        shared.level.store(level.to_bits(), Ordering::Relaxed);

        // 写给目标设备，延迟超过上限就丢掉最旧的
        let queued = match render.get_current_padding() {
            Ok(n) => n as usize,
            Err(e) => break Err(format!("目标设备不可用：{e}")),
        };
        let drop = dsp::frames_to_drop(queued, pending.len() / CHANNELS, MAX_LATENCY_FRAMES);
        pending.drain(..drop * CHANNELS);
        let space = match render.get_available_space_in_frames() {
            Ok(n) => n as usize,
            Err(e) => break Err(format!("目标设备不可用：{e}")),
        };
        let frames = space.min(pending.len() / CHANNELS);
        if frames > 0 {
            out.clear();
            for sample in pending.drain(..frames * CHANNELS) {
                out.extend_from_slice(&sample.to_le_bytes());
            }
            if let Err(e) = render_client.write_to_device(frames, &out, None) {
                break Err(format!("目标设备不可用：{e}"));
            }
        }
    };
    finish(&capture, &render, outcome)
}

fn finish(capture: &AudioClient, render: &AudioClient, outcome: Result<(), String>) -> Result<(), String> {
    let _ = capture.stop_stream();
    let _ = render.stop_stream();
    outcome
}
