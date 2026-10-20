//! 一路声音曲线处理流：从虚拟声卡录下应用的原声 → 均衡 → 送到目标设备。
//!
//! 应用被路由到一块没人听的虚拟声卡（每个开曲线的应用独占一块），
//! 这里对那块声卡做回环录音，所以拿到的正好是这个应用的声音，用户只会听到处理过的版本。
//! 每路流跑在自己的线程上，用 MMCSS「Pro Audio」优先级减少爆音。

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};
use windows::core::w;
use windows::Win32::System::Threading::{AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW};

use crate::dsp::{self, Equalizer, CHANNELS, SAMPLE_RATE};

/// 录音和输出的缓冲都是 100ms，但实际只保持很浅的水位
const BUFFER_HNS: i64 = 1_000_000;
/// 整条处理链（自己手里 + 设备缓冲里）最多积压 80ms，多了就丢最旧的，延迟不会越拖越长
const MAX_LATENCY_FRAMES: usize = SAMPLE_RATE as usize * 80 / 1000;
const POLL: Duration = Duration::from_millis(5);
const BYTES_PER_SAMPLE: usize = 4;
/// 低于这个峰值的数据算作没声音（不计入「已处理」时长）
const AUDIBLE: f32 = 1e-4;

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
    /// 处理过的有声音的帧数
    audible_frames: AtomicU64,
    error: Mutex<Option<String>>,
}

pub struct EqStream {
    pub target_id: String,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl EqStream {
    /// 录 sink_id（虚拟声卡）里的声音，处理后输出到 target_id；volume 为 0–1 的线性音量（静音传 0）
    pub fn start(sink_id: &str, target_id: &str, gains: &[f32], volume: f32) -> Self {
        let shared = Arc::new(Shared {
            params: Mutex::new(Params { gains: gains.to_vec(), volume, revision: 0 }),
            stop: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            level: AtomicU32::new(0),
            audible_frames: AtomicU64::new(0),
            error: Mutex::new(None),
        });
        let worker = shared.clone();
        let (sink, target) = (sink_id.to_string(), target_id.to_string());
        let thread = thread::Builder::new().name("eq".into()).spawn(move || {
            if let Err(message) = run(&sink, &target, &worker) {
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
        Self { target_id: target_id.to_string(), shared, thread }
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

    /// 至今处理过多少秒有声音的音频
    pub fn audible_seconds(&self) -> f32 {
        self.shared.audible_frames.load(Ordering::Relaxed) as f32 / SAMPLE_RATE
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

fn run(sink_id: &str, target_id: &str, shared: &Shared) -> Result<(), String> {
    let _ = wasapi::initialize_mta();
    let mut task_index = 0u32;
    let mmcss = unsafe { AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index) }.ok();
    let result = pump(sink_id, target_id, shared);
    if let Some(handle) = mmcss {
        let _ = unsafe { AvRevertMmThreadCharacteristics(handle) };
    }
    result
}

fn pump(sink_id: &str, target_id: &str, shared: &Shared) -> Result<(), String> {
    // 录音和输出都用 48kHz 双声道 32 位浮点，系统负责和设备格式互转
    let format = WaveFormat::new(32, 32, &SampleType::Float, SAMPLE_RATE as usize, CHANNELS, None);
    let block_align = format.get_blockalign() as usize;
    let enumerator = DeviceEnumerator::new().map_err(context("无法访问系统音频服务"))?;
    let mode = StreamMode::PollingShared { autoconvert: true, buffer_duration_hns: BUFFER_HNS };

    // 对虚拟声卡这个「播放设备」做回环录音（播放设备 + Capture 方向 = 回环）
    let sink = enumerator.get_device(sink_id).map_err(context("找不到虚拟声卡"))?;
    let mut capture = sink.get_iaudioclient().map_err(context("无法录下虚拟声卡里的声音"))?;
    capture.initialize_client(&format, &Direction::Capture, &mode).map_err(context("无法录下虚拟声卡里的声音"))?;
    let capture_client = capture.get_audiocaptureclient().map_err(context("无法录下虚拟声卡里的声音"))?;

    let target = enumerator.get_device(target_id).map_err(context("找不到目标设备"))?;
    let mut render = target.get_iaudioclient().map_err(context("无法打开目标设备"))?;
    render.initialize_client(&format, &Direction::Render, &mode).map_err(context("无法打开目标设备"))?;
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
    capture.start_stream().map_err(context("无法开始录音"))?;

    let outcome = 'outer: loop {
        if shared.stop.load(Ordering::SeqCst) {
            break Ok(());
        }
        thread::sleep(POLL);

        {
            let params = shared.params.lock().unwrap_or_else(|e| e.into_inner());
            if params.revision != revision {
                eq.set_gains(&params.gains);
                eq.set_volume(params.volume);
                revision = params.revision;
            }
        }

        // 把录到的数据全部处理掉；应用没在发声时这里什么都没有
        let mut peak = 0f32;
        loop {
            let frames = match capture_client.get_next_packet_size() {
                Ok(Some(n)) if n > 0 => n as usize,
                Ok(_) => break,
                Err(e) => break 'outer Err(format!("录音中断：{e}")),
            };
            packet.resize(frames * block_align, 0);
            let (read, info) = match capture_client.read_from_device(&mut packet) {
                Ok(result) => result,
                Err(e) => break 'outer Err(format!("录音中断：{e}")),
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
            let packet_peak = eq.process(&mut samples);
            if packet_peak > AUDIBLE {
                shared.audible_frames.fetch_add(read as u64, Ordering::Relaxed);
            }
            peak = peak.max(packet_peak);
            pending.extend(samples.iter().copied());
        }
        level = peak.max(level * 0.85);
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
    let _ = capture.stop_stream();
    let _ = render.stop_stream();
    outcome
}
