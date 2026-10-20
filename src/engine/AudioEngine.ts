import type { AudioSource, OutputDevice } from '../model/types';

export interface EngineSnapshot {
  sources: AudioSource[];
  devices: OutputDevice[];
  /** 系统默认输出设备：重置路由、或保存的设备已不存在时回落到这里 */
  defaultDeviceId: string;
}

/** 各声音流此刻的电平，0–1，按 source id 索引 */
export type LevelFrame = Readonly<Record<string, number>>;

/**
 * 音频引擎抽象。界面只通过这一层下发路由、音量、均衡指令。
 *
 * 现在用 MockAudioEngine 跑通界面；之后换成原生实现即可，
 * 比如 Tauri + Rust 调 Windows Core Audio（按应用指定输出设备、会话音量），
 * 均衡则交给 APO / 虚拟声卡。
 */
export interface AudioEngine {
  readonly label: string;
  snapshot(): EngineSnapshot;
  setRoute(sourceId: string, deviceId: string): void;
  setSourceEnabled(sourceId: string, enabled: boolean): void;
  setSourceVolume(sourceId: string, volume: number): void;
  setSourceEq(sourceId: string, gains: readonly number[]): void;
  setDeviceVolume(deviceId: string, volume: number): void;
  /** 订阅实时电平，返回取消订阅函数 */
  onLevels(listener: (frame: LevelFrame) => void): () => void;
}
