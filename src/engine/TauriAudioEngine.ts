import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { abbreviate } from '../model/abbreviate';
import { flatGains } from '../model/eq';
import type { DeviceKind } from '../model/types';
import type { AudioEngine, EngineSnapshot, LevelFrame } from './AudioEngine';

/** Rust 端 soundflow_audio::Snapshot 的 JSON 形状 */
interface NativeSnapshot {
  sources: Array<{
    id: string;
    name: string;
    kind: 'app' | 'system';
    active: boolean;
    enabled: boolean;
    volume: number;
    deviceId: string;
    routable: boolean;
    eqActive: boolean;
    eqError: string | null;
    eqSeconds: number;
  }>;
  devices: Array<{ id: string; name: string; detail: string; kind: DeviceKind; volume: number }>;
  defaultDeviceId: string;
  eq: { available: boolean; sinkName: string | null; freeSinks: number };
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function fromNative(native: NativeSnapshot): EngineSnapshot {
  return {
    sources: native.sources.map((s) => ({
      ...s,
      code: abbreviate(s.name),
      eq: flatGains(),
      eqPreset: 'flat',
    })),
    devices: native.devices.map((d) => ({ ...d, code: abbreviate(d.name) })),
    defaultDeviceId: native.defaultDeviceId,
    eq: native.eq,
  };
}

/** 安装版用的引擎：通过 Tauri 命令/事件和 Rust 音频线程通信 */
export class TauriAudioEngine implements AudioEngine {
  readonly label = 'Windows 音频';
  readonly native = true;

  /** 最近一次快照里曲线能否生效；不能时不下发曲线（下发了也只会报错） */
  private eqAvailable = false;
  private levels = new EventHub<LevelFrame>('audio://levels');
  private snapshots = new EventHub<NativeSnapshot>('audio://snapshot');
  private errorListeners = new Set<(message: string) => void>();

  async load(): Promise<EngineSnapshot> {
    const snapshot = fromNative(await invoke<NativeSnapshot>('audio_snapshot'));
    this.eqAvailable = snapshot.eq.available;
    return snapshot;
  }

  onSnapshot(listener: (snapshot: EngineSnapshot) => void): () => void {
    return this.snapshots.subscribe((native) => {
      const snapshot = fromNative(native);
      this.eqAvailable = snapshot.eq.available;
      listener(snapshot);
    });
  }

  onLevels(listener: (frame: LevelFrame) => void): () => void {
    return this.levels.subscribe(listener);
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  setRoute(source: string, device: string): void {
    this.call('audio_set_route', { source, device });
  }

  setSourceEnabled(source: string, enabled: boolean): void {
    this.call('audio_set_source_enabled', { source, enabled });
  }

  setSourceVolume(source: string, volume: number): void {
    this.call('audio_set_source_volume', { source, volume });
  }

  setSourceEq(source: string, gains: readonly number[]): void {
    if (this.eqAvailable) this.call('audio_set_source_eq', { source, gains: [...gains] });
  }

  setDeviceVolume(device: string, volume: number): void {
    this.call('audio_set_device_volume', { device, volume });
  }

  setDefaultDevice(device: string): void {
    this.call('audio_set_default_device', { device });
  }

  private call(command: string, args: Record<string, unknown>): void {
    invoke(command, args).catch((e: unknown) => {
      const message = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
      this.errorListeners.forEach((listener) => listener(message));
    });
  }
}

/** 多个订阅者共用一个 Tauri 事件监听；没人订阅时自动取消 */
class EventHub<T> {
  private listeners = new Set<(payload: T) => void>();
  private unlisten: Promise<UnlistenFn> | null = null;

  constructor(private readonly event: string) {}

  subscribe(listener: (payload: T) => void): () => void {
    this.listeners.add(listener);
    this.unlisten ??= listen<T>(this.event, (e) => this.listeners.forEach((l) => l(e.payload)));
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.unlisten) {
        const pending = this.unlisten;
        this.unlisten = null;
        void pending.then((stop) => stop());
      }
    };
  }
}
