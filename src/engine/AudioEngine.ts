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
 * - MockAudioEngine：浏览器里开发界面用，数据是假的
 * - TauriAudioEngine：安装版里用，经 Rust 后端调用 Windows Core Audio
 *
 * 下发指令都是「发出即返回」，失败通过 onError 报告。
 */
export interface AudioEngine {
  readonly label: string;
  /**
   * 是否在驱动真实的系统音频。为 true 时路由、音量、静音以系统为准：
   * 启动时不会用保存的值覆盖系统，系统那边的变化会通过 onSnapshot 推过来。
   */
  readonly native: boolean;
  /** 声音曲线是否真的作用到声音上 */
  readonly supportsEq: boolean;
  load(): Promise<EngineSnapshot>;
  /** 系统里的应用、设备、音量发生变化时推送新快照 */
  onSnapshot(listener: (snapshot: EngineSnapshot) => void): () => void;
  onError(listener: (message: string) => void): () => void;
  setRoute(sourceId: string, deviceId: string): void;
  setSourceEnabled(sourceId: string, enabled: boolean): void;
  setSourceVolume(sourceId: string, volume: number): void;
  setSourceEq(sourceId: string, gains: readonly number[]): void;
  setDeviceVolume(deviceId: string, volume: number): void;
  /** 订阅实时电平，返回取消订阅函数 */
  onLevels(listener: (frame: LevelFrame) => void): () => void;
}
