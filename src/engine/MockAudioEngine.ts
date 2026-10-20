import { EQ_PRESETS } from '../model/eq';
import type { AudioSource, OutputDevice } from '../model/types';
import type { AudioEngine, EngineSnapshot, LevelFrame } from './AudioEngine';

const gains = (id: string): number[] => [...(EQ_PRESETS.find((p) => p.id === id)?.gains ?? [])];

const MOCK_DEVICES: OutputDevice[] = [
  { id: 'hk', name: 'Harman Kardon 音响', code: 'HK', kind: 'speaker', detail: '蓝牙 · 立体声', volume: 64 },
  { id: 'headset', name: '游戏耳机', code: 'HS', kind: 'headphones', detail: 'USB · 7.1 虚拟环绕', volume: 78 },
  { id: 'monitor', name: '显示器扬声器', code: 'MN', kind: 'monitor', detail: 'HDMI · 立体声', volume: 40 },
  { id: 'stream', name: '直播声卡', code: 'VB', kind: 'virtual', detail: '虚拟设备 · OBS 采集', volume: 100 },
];

const MOCK_SOURCES: AudioSource[] = [
  { id: 'spotify', name: 'Spotify', code: 'SP', kind: 'music', active: true, enabled: true, volume: 72, deviceId: 'hk', routable: true, eq: gains('bass'), eqPreset: 'bass' },
  { id: 'game', name: '游戏', code: 'GM', kind: 'game', active: true, enabled: true, volume: 85, deviceId: 'headset', routable: true, eq: gains('footsteps'), eqPreset: 'footsteps' },
  { id: 'discord', name: 'Discord', code: 'DC', kind: 'voice', active: true, enabled: true, volume: 60, deviceId: 'headset', routable: true, eq: gains('vocal'), eqPreset: 'vocal' },
  { id: 'chrome', name: 'Chrome', code: 'CR', kind: 'browser', active: false, enabled: true, volume: 50, deviceId: 'hk', routable: true, eq: gains('flat'), eqPreset: 'flat' },
  { id: 'system', name: '系统声音', code: 'SY', kind: 'system', active: false, enabled: false, volume: 35, deviceId: 'hk', routable: false, eq: gains('flat'), eqPreset: 'flat' },
];

/**
 * 模拟引擎：假装有几路应用在发声，按音量算出会跳动的电平。
 * 只用于开发界面，不会真的改动系统音频。
 */
export class MockAudioEngine implements AudioEngine {
  readonly label = '模拟引擎';
  readonly native = false;

  private sources = structuredClone(MOCK_SOURCES);
  private devices = structuredClone(MOCK_DEVICES);
  private listeners = new Set<(frame: LevelFrame) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  snapshot(): EngineSnapshot {
    return {
      sources: structuredClone(this.sources),
      devices: structuredClone(this.devices),
      defaultDeviceId: 'hk',
      // 模拟引擎假装曲线一直生效
      eq: { available: true, sinkName: null },
    };
  }

  load(): Promise<EngineSnapshot> {
    return Promise.resolve(this.snapshot());
  }

  onSnapshot(): () => void {
    // 模拟数据不会自己变化
    return () => {};
  }

  onError(): () => void {
    return () => {};
  }

  setRoute(sourceId: string, deviceId: string): void {
    this.patchSource(sourceId, { deviceId });
  }

  setSourceEnabled(sourceId: string, enabled: boolean): void {
    this.patchSource(sourceId, { enabled });
  }

  setSourceVolume(sourceId: string, volume: number): void {
    this.patchSource(sourceId, { volume });
  }

  setSourceEq(sourceId: string, eq: readonly number[]): void {
    this.patchSource(sourceId, { eq: [...eq] });
  }

  setDeviceVolume(deviceId: string, volume: number): void {
    const device = this.devices.find((d) => d.id === deviceId);
    if (device) device.volume = volume;
  }

  onLevels(listener: (frame: LevelFrame) => void): () => void {
    this.listeners.add(listener);
    this.timer ??= setInterval(() => this.tick(), 50);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private patchSource(id: string, patch: Partial<AudioSource>): void {
    const source = this.sources.find((s) => s.id === id);
    if (source) Object.assign(source, patch);
  }

  private tick(): void {
    const t = performance.now() / 1000;
    const frame: Record<string, number> = {};
    for (const s of this.sources) {
      if (!s.active || !s.enabled) {
        frame[s.id] = 0;
        continue;
      }
      const device = this.devices.find((d) => d.id === s.deviceId);
      const gain = Math.sqrt((s.volume / 100) * ((device?.volume ?? 100) / 100));
      const seed = seedOf(s.id);
      const beat = 0.5 + 0.5 * Math.sin(t * (3 + seed * 4) + seed * 10);
      frame[s.id] = Math.min(1, gain * (0.35 + 0.4 * beat + 0.25 * Math.random()));
    }
    this.listeners.forEach((listener) => listener(frame));
  }
}

function seedOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h / 997;
}
