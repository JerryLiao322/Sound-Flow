import type { SoundFlowState } from '../state/reducer';
import type { AudioEngine } from './AudioEngine';

/**
 * 把界面状态的变化同步到引擎：只下发真正改变了的字段。
 * prev 为 null 时（刚启动）全部下发一次，让引擎跟保存的偏好对齐。
 */
export function syncEngine(engine: AudioEngine, prev: SoundFlowState | null, next: SoundFlowState): void {
  const prevSources = new Map(prev?.sources.map((s) => [s.id, s]));
  for (const s of next.sources) {
    const p = prevSources.get(s.id);
    if (!p || p.deviceId !== s.deviceId) engine.setRoute(s.id, s.deviceId);
    if (!p || p.enabled !== s.enabled) engine.setSourceEnabled(s.id, s.enabled);
    if (!p || p.volume !== s.volume) engine.setSourceVolume(s.id, s.volume);
    if (!p || p.eq !== s.eq) engine.setSourceEq(s.id, s.eq);
  }

  const prevDevices = new Map(prev?.devices.map((d) => [d.id, d]));
  for (const d of next.devices) {
    const p = prevDevices.get(d.id);
    if (!p || p.volume !== d.volume) engine.setDeviceVolume(d.id, d.volume);
  }
}
