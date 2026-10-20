//! 声音曲线的信号处理：十段峰值均衡（与界面上的频段一一对应）、
//! 自动前级衰减防削波、平滑的音量/静音增益、峰值电平。
//!
//! 只依赖标准库，任何平台上都能测试。

use std::f32::consts::PI;

pub const SAMPLE_RATE: f32 = 48_000.0;
pub const CHANNELS: usize = 2;
/// 与界面 EQ_BANDS 相同
pub const BANDS: [f32; 10] = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
/// 一个倍频程宽的峰值滤波器，适合十段图示均衡
const Q: f32 = 1.41;
/// 增益小于这个值（dB）的频段直接跳过
const NEGLIGIBLE_DB: f32 = 0.05;
/// 音量变化的平滑时间常数（秒），避免拖动音量时出现「咔哒」声
const GAIN_SMOOTHING_S: f32 = 0.01;

/// 曲线是否等于平直（不需要处理）
pub fn is_flat(gains_db: &[f32]) -> bool {
    gains_db.iter().all(|g| g.abs() < NEGLIGIBLE_DB)
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl Biquad {
    /// RBJ Audio EQ Cookbook 的峰值滤波器
    fn peaking(freq: f32, gain_db: f32, q: f32, fs: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / fs;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        let a0 = 1.0 + alpha / a;
        Self {
            b0: (1.0 + alpha * a) / a0,
            b1: (-2.0 * cos) / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: (-2.0 * cos) / a0,
            a2: (1.0 - alpha / a) / a0,
        }
    }

    /// 在频率 freq 处的幅度响应（dB）
    fn response_db(&self, freq: f32, fs: f32) -> f32 {
        let w = 2.0 * PI * freq / fs;
        // H(e^jw) = (b0 + b1 e^-jw + b2 e^-2jw) / (1 + a1 e^-jw + a2 e^-2jw)
        let (c1, s1) = (w.cos(), -w.sin());
        let (c2, s2) = ((2.0 * w).cos(), -(2.0 * w).sin());
        let num_re = self.b0 + self.b1 * c1 + self.b2 * c2;
        let num_im = self.b1 * s1 + self.b2 * s2;
        let den_re = 1.0 + self.a1 * c1 + self.a2 * c2;
        let den_im = self.a1 * s1 + self.a2 * s2;
        let magnitude = ((num_re * num_re + num_im * num_im) / (den_re * den_re + den_im * den_im)).sqrt();
        20.0 * magnitude.log10()
    }
}

/// 转置直接 II 型的两个状态量
#[derive(Debug, Clone, Copy, Default)]
struct State {
    z1: f32,
    z2: f32,
}

/// 一路立体声声音流的均衡器
pub struct Equalizer {
    filters: Vec<Biquad>,
    /// [声道][滤波器]
    state: Vec<Vec<State>>,
    preamp: f32,
    target_gain: f32,
    current_gain: f32,
    smoothing: f32,
}

impl Equalizer {
    pub fn new(gains_db: &[f32], volume: f32) -> Self {
        let mut eq = Self {
            filters: Vec::new(),
            state: vec![Vec::new(); CHANNELS],
            preamp: 1.0,
            target_gain: volume,
            current_gain: volume,
            smoothing: 1.0 - (-1.0 / (SAMPLE_RATE * GAIN_SMOOTHING_S)).exp(),
        };
        eq.set_gains(gains_db);
        eq
    }

    /// 更新各频段增益（dB）。前级衰减按整条曲线的最高点自动计算，提升不会削波。
    pub fn set_gains(&mut self, gains_db: &[f32]) {
        let filters: Vec<Biquad> = BANDS
            .iter()
            .zip(gains_db)
            .filter(|(_, g)| g.abs() >= NEGLIGIBLE_DB)
            .map(|(&f, &g)| Biquad::peaking(f, g, Q, SAMPLE_RATE))
            .collect();
        // 滤波器数量不变时保留状态，拖动曲线时声音连续
        if filters.len() != self.filters.len() {
            self.state = vec![vec![State::default(); filters.len()]; CHANNELS];
        }
        self.filters = filters;
        self.preamp = 10f32.powf(-self.peak_response_db().max(0.0) / 20.0);
    }

    /// 线性音量 0–1；静音就是 0。变化会在约 10ms 内平滑过渡
    pub fn set_volume(&mut self, volume: f32) {
        self.target_gain = volume.clamp(0.0, 1.0);
    }

    /// 整条曲线在 20Hz–20kHz 内的最高点（dB）
    pub fn peak_response_db(&self) -> f32 {
        (0..=96)
            .map(|i| 20.0 * 1000f32.powf(i as f32 / 96.0))
            .map(|f| self.response_db(f))
            .fold(f32::MIN, f32::max)
    }

    /// 曲线在某个频率的总响应（dB），不含前级衰减和音量
    pub fn response_db(&self, freq: f32) -> f32 {
        self.filters.iter().map(|f| f.response_db(freq, SAMPLE_RATE)).sum()
    }

    /// 原地处理交错的立体声采样，返回处理后的峰值电平（0–1）
    pub fn process(&mut self, samples: &mut [f32]) -> f32 {
        let mut peak = 0f32;
        for frame in samples.chunks_exact_mut(CHANNELS) {
            self.current_gain += (self.target_gain - self.current_gain) * self.smoothing;
            let gain = self.preamp * self.current_gain;
            for (channel, sample) in frame.iter_mut().enumerate() {
                let mut x = *sample;
                for (filter, state) in self.filters.iter().zip(self.state[channel].iter_mut()) {
                    let y = filter.b0 * x + state.z1;
                    state.z1 = filter.b1 * x - filter.a1 * y + state.z2;
                    state.z2 = filter.b2 * x - filter.a2 * y;
                    x = y;
                }
                let out = (x * gain).clamp(-1.0, 1.0);
                peak = peak.max(out.abs());
                *sample = out;
            }
        }
        // 防止极小值（非正规数）拖慢处理
        for channel in &mut self.state {
            for s in channel {
                if s.z1.abs() < 1e-20 {
                    s.z1 = 0.0;
                }
                if s.z2.abs() < 1e-20 {
                    s.z2 = 0.0;
                }
            }
        }
        peak
    }
}

/// 为了把延迟控制在上限内，应当从待播放队列前端丢掉多少帧
pub fn frames_to_drop(queued_in_device: usize, queued_here: usize, max_total: usize) -> usize {
    (queued_in_device + queued_here).saturating_sub(max_total).min(queued_here)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, frames: usize, amplitude: f32) -> Vec<f32> {
        (0..frames)
            .flat_map(|i| {
                let v = amplitude * (2.0 * PI * freq * i as f32 / SAMPLE_RATE).sin();
                [v, v]
            })
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn flat_curve_is_bit_exact_passthrough() {
        let mut eq = Equalizer::new(&[0.0; 10], 1.0);
        let input = sine(440.0, 4800, 0.5);
        let mut output = input.clone();
        eq.process(&mut output);
        assert_eq!(input, output);
        assert!(is_flat(&[0.0, 0.01, -0.02, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
        assert!(!is_flat(&[0.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0]));
    }

    #[test]
    fn single_band_hits_its_gain_at_the_center_frequency() {
        for (band, &freq) in BANDS.iter().enumerate() {
            for gain in [-12.0, -6.0, 6.0, 12.0] {
                let mut gains = [0.0; 10];
                gains[band] = gain;
                let eq = Equalizer::new(&gains, 1.0);
                let measured = eq.response_db(freq);
                assert!((measured - gain).abs() < 0.05, "{freq} Hz @ {gain} dB → {measured}");
                // 离开三个倍频程以上基本不受影响
                let far = if freq < 1000.0 { freq * 8.0 } else { freq / 8.0 };
                assert!(eq.response_db(far).abs() < 0.6, "{freq} Hz band leaks {} dB at {far}", eq.response_db(far));
            }
        }
    }

    #[test]
    fn boosting_lowers_the_preamp_so_output_never_clips() {
        let mut gains = [0.0; 10];
        gains[5] = 12.0;
        let mut eq = Equalizer::new(&gains, 1.0);
        assert!((eq.peak_response_db() - 12.0).abs() < 0.1);
        // 满幅 1kHz 正弦经过 +12dB 后仍然不超过满幅
        let mut samples = sine(1000.0, 48_000, 1.0);
        let peak = eq.process(&mut samples);
        assert!(peak <= 1.0);
        assert!(peak > 0.9, "preamp should only remove the boost, peak was {peak}");
    }

    #[test]
    fn cuts_attenuate_and_boosts_amplify_relative_to_other_bands() {
        let mut gains = [0.0; 10];
        gains[0] = 12.0; // 31 Hz +12
        gains[7] = -12.0; // 4 kHz -12
        let mut eq = Equalizer::new(&gains, 1.0);
        let mut bass = sine(31.0, 48_000, 0.25);
        let mut presence = sine(4000.0, 48_000, 0.25);
        eq.process(&mut bass);
        let mut eq = Equalizer::new(&gains, 1.0);
        eq.process(&mut presence);
        // 跳过开头的瞬态，比较稳态响度：相差应约 24 dB
        let diff = 20.0 * (rms(&bass[9600..]) / rms(&presence[9600..])).log10();
        assert!((diff - 24.0).abs() < 1.0, "difference was {diff} dB");
    }

    #[test]
    fn volume_ramps_smoothly_and_mutes() {
        let mut eq = Equalizer::new(&[0.0; 10], 1.0);
        eq.set_volume(0.0);
        let mut first_block = vec![0.5; 2 * 48];
        eq.process(&mut first_block);
        // 1ms 后还没完全静音（平滑过渡）
        assert!(first_block[first_block.len() - 1] > 0.0);
        let mut later = vec![0.5; 2 * 4800];
        eq.process(&mut later);
        assert!(later[later.len() - 1].abs() < 1e-3);
    }

    #[test]
    fn changing_gains_keeps_output_finite() {
        let mut eq = Equalizer::new(&[6.0, 5.0, 4.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 0.8);
        let mut samples = sine(100.0, 4800, 0.9);
        for step in 0..20 {
            let mut gains = [0.0; 10];
            gains[step % 10] = (step as f32 - 10.0) * 1.2;
            eq.set_gains(&gains);
            eq.process(&mut samples);
            assert!(samples.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
        }
    }

    #[test]
    fn latency_bound_drops_only_what_is_needed() {
        assert_eq!(frames_to_drop(1000, 2000, 5760), 0);
        assert_eq!(frames_to_drop(4000, 3000, 5760), 1240);
        // 设备里已经堆太多时，最多只能丢掉自己手里的
        assert_eq!(frames_to_drop(9000, 100, 5760), 100);
    }
}
