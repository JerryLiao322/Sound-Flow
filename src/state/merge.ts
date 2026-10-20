import type { EngineSnapshot } from '../engine/AudioEngine';
import { applySourcePrefs, placeNewSource, type StoredPrefs } from './persist';
import type { SoundFlowState } from './reducer';

/**
 * 「用户刚改过、系统还没确认」的字段。系统推来的快照可能是改动生效前采的，
 * 这些字段先以界面为准，免得滑块被旧值拽回去。
 */
export type PendingKeys = ReadonlySet<string>;

export const pendingKey = {
  sourceVolume: (id: string) => `src:${id}:volume`,
  sourceEnabled: (id: string) => `src:${id}:enabled`,
  sourceDevice: (id: string) => `src:${id}:device`,
  deviceVolume: (id: string) => `dev:${id}:volume`,
};

/**
 * 把系统推来的新快照并进界面状态：
 * - 应用列表、设备列表、是否在发声、名字：以系统为准
 * - 路由、音量、静音：以系统为准，除非在 pending 里
 * - 顺序、声音曲线、选中：保留界面的；新出现的应用按保存的设置放回原位
 */
export function mergeSnapshot(
  state: SoundFlowState,
  snapshot: EngineSnapshot,
  pending: PendingKeys,
  prefs: StoredPrefs | null,
): SoundFlowState {
  const current = new Map(state.sources.map((s) => [s.id, s]));
  const incoming = new Map(snapshot.sources.map((s) => [s.id, s]));
  const deviceIds = new Set(snapshot.devices.map((d) => d.id));

  const order = state.sources.filter((s) => incoming.has(s.id)).map((s) => s.id);
  for (const s of snapshot.sources) {
    if (!current.has(s.id)) placeNewSource(order, s.id, prefs?.order ?? []);
  }

  const sources = order.map((id) => {
    const fresh = incoming.get(id)!;
    const old = current.get(id);
    if (!old) return applySourcePrefs(fresh, prefs?.sources[id], deviceIds, { systemOwned: true });
    return {
      ...fresh,
      eq: old.eq,
      eqPreset: old.eqPreset,
      volume: pending.has(pendingKey.sourceVolume(id)) ? old.volume : fresh.volume,
      enabled: pending.has(pendingKey.sourceEnabled(id)) ? old.enabled : fresh.enabled,
      deviceId:
        pending.has(pendingKey.sourceDevice(id)) && deviceIds.has(old.deviceId) ? old.deviceId : fresh.deviceId,
    };
  });

  const oldDevices = new Map(state.devices.map((d) => [d.id, d]));
  const devices = snapshot.devices.map((d) => {
    const old = oldDevices.get(d.id);
    return old && pending.has(pendingKey.deviceVolume(d.id)) ? { ...d, volume: old.volume } : d;
  });

  const selectedId = sources.some((s) => s.id === state.selectedId) ? state.selectedId : (sources[0]?.id ?? '');
  return { sources, devices, selectedId, defaultDeviceId: snapshot.defaultDeviceId };
}
