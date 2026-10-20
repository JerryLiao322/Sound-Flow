import { pendingKey } from '../state/merge';
import type { SoundFlowState } from '../state/reducer';
import type { AudioEngine } from './AudioEngine';

/**
 * 把界面状态的变化同步到引擎：只下发真正改变了的字段。
 * prev 是引擎目前（我们认为）的状态；为 null 时全部下发一次。
 * 每下发一个系统掌管的字段就调用 onSent，调用方据此把它标成「等系统确认」。
 */
export function syncEngine(
  engine: AudioEngine,
  prev: SoundFlowState | null,
  next: SoundFlowState,
  onSent: (key: string) => void = () => {},
): void {
  const prevSources = new Map(prev?.sources.map((s) => [s.id, s]));
  for (const s of next.sources) {
    const p = prevSources.get(s.id);
    if (s.routable && (!p || p.deviceId !== s.deviceId)) {
      engine.setRoute(s.id, s.deviceId);
      onSent(pendingKey.sourceDevice(s.id));
    }
    if (!p || p.enabled !== s.enabled) {
      engine.setSourceEnabled(s.id, s.enabled);
      onSent(pendingKey.sourceEnabled(s.id));
    }
    if (!p || p.volume !== s.volume) {
      engine.setSourceVolume(s.id, s.volume);
      onSent(pendingKey.sourceVolume(s.id));
    }
    if (!p || !sameGains(p.eq, s.eq)) engine.setSourceEq(s.id, s.eq);
  }

  const prevDevices = new Map(prev?.devices.map((d) => [d.id, d]));
  for (const d of next.devices) {
    const p = prevDevices.get(d.id);
    if (!p || p.volume !== d.volume) {
      engine.setDeviceVolume(d.id, d.volume);
      onSent(pendingKey.deviceVolume(d.id));
    }
  }
}

/** 曲线按值比较：恢复保存的设置会生成新数组，内容没变就不必再下发 */
function sameGains(a: readonly number[], b: readonly number[]): boolean {
  return a === b || (a.length === b.length && a.every((g, i) => g === b[i]));
}
