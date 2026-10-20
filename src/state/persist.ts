import type { EngineSnapshot } from '../engine/AudioEngine';
import { EQ_BANDS, EQ_PRESETS, clampGain, clampVolume } from '../model/eq';
import type { AudioSource, EqPresetId } from '../model/types';
import type { SoundFlowState } from './reducer';

const STORAGE_KEY = 'sound-flow:v1';

type SourcePrefs = Pick<AudioSource, 'enabled' | 'volume' | 'deviceId' | 'eq' | 'eqPreset'>;

/** 只保存用户自己的设置；应用列表、是否在发声这些以引擎为准 */
export interface StoredPrefs {
  order: string[];
  selectedId: string;
  sources: Record<string, SourcePrefs>;
  devices: Record<string, { volume: number }>;
}

export function toPrefs(state: SoundFlowState): StoredPrefs {
  return {
    order: state.sources.map((s) => s.id),
    selectedId: state.selectedId,
    sources: Object.fromEntries(
      state.sources.map((s) => [s.id, { enabled: s.enabled, volume: s.volume, deviceId: s.deviceId, eq: s.eq, eqPreset: s.eqPreset }]),
    ),
    devices: Object.fromEntries(state.devices.map((d) => [d.id, { volume: d.volume }])),
  };
}

/**
 * 用引擎快照 + 保存的偏好拼出初始状态。偏好里每个字段都单独校验，
 * 坏掉或过期的值（比如设备已拔掉）直接沿用引擎给的值。
 */
export function createState(snapshot: EngineSnapshot, prefs: unknown): SoundFlowState {
  const p = isRecord(prefs) ? prefs : {};
  const sourcePrefs = isRecord(p.sources) ? p.sources : {};
  const devicePrefs = isRecord(p.devices) ? p.devices : {};
  const deviceIds = new Set(snapshot.devices.map((d) => d.id));

  const devices = snapshot.devices.map((d) => {
    const saved = devicePrefs[d.id];
    return isRecord(saved) && isNumber(saved.volume) ? { ...d, volume: clampVolume(saved.volume) } : d;
  });

  let sources = snapshot.sources.map((s) => {
    const saved = sourcePrefs[s.id];
    if (!isRecord(saved)) return s;
    const next = { ...s };
    if (typeof saved.enabled === 'boolean') next.enabled = saved.enabled;
    if (isNumber(saved.volume)) next.volume = clampVolume(saved.volume);
    if (typeof saved.deviceId === 'string' && deviceIds.has(saved.deviceId)) next.deviceId = saved.deviceId;
    if (Array.isArray(saved.eq) && saved.eq.length === EQ_BANDS.length && saved.eq.every(isNumber)) {
      next.eq = saved.eq.map(clampGain);
      next.eqPreset = isPresetId(saved.eqPreset) ? saved.eqPreset : 'custom';
    }
    return next;
  });

  const order = p.order;
  if (Array.isArray(order)) {
    const rank = new Map(order.map((id: unknown, i) => [id, i]));
    // 新出现的应用排在已保存的后面，保持引擎给的相对顺序
    sources = sources
      .map((s, i) => ({ s, key: rank.get(s.id) ?? order.length + i }))
      .sort((a, b) => a.key - b.key)
      .map(({ s }) => s);
  }

  const selectedId =
    typeof p.selectedId === 'string' && sources.some((s) => s.id === p.selectedId)
      ? p.selectedId
      : (sources[0]?.id ?? '');

  return { sources, devices, selectedId, defaultDeviceId: snapshot.defaultDeviceId };
}

export function loadPrefs(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePrefs(state: SoundFlowState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toPrefs(state)));
  } catch {
    // 隐私模式或存储被禁用时只是不记住设置，不影响使用
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPresetId(v: unknown): v is EqPresetId {
  return v === 'custom' || EQ_PRESETS.some((preset) => preset.id === v);
}
