import type { EngineSnapshot } from '../engine/AudioEngine';
import { EQ_BANDS, EQ_PRESETS, clampGain, clampVolume } from '../model/eq';
import type { AudioSource, EqPresetId } from '../model/types';
import type { SoundFlowState } from './reducer';

const STORAGE_KEY = 'sound-flow:v1';

export interface SourcePrefs {
  enabled?: boolean;
  volume?: number;
  deviceId?: string;
  eq?: number[];
  eqPreset?: EqPresetId;
}

/**
 * 保存在本地的用户设置。也会记着眼下没在运行的应用（比如关掉的游戏），
 * 它下次出现时顺序和声音曲线还能接上。
 */
export interface StoredPrefs {
  order: string[];
  selectedId?: string;
  sources: Record<string, SourcePrefs>;
  devices: Record<string, { volume?: number }>;
}

export interface CreateOptions {
  /**
   * 路由、音量、静音由系统掌管（安装版）。这时只恢复顺序、选中和声音曲线，
   * 绝不用保存的旧值覆盖系统当前的状态。
   */
  systemOwned: boolean;
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

/** 用当前设置覆盖旧设置，但保留旧设置里眼下不在场的应用和设备 */
export function mergePrefs(previous: StoredPrefs | null, current: StoredPrefs): StoredPrefs {
  if (!previous) return current;
  const order = [...current.order];
  previous.order.forEach((id, i) => {
    if (!order.includes(id)) insertAfterNeighbour(order, id, previous.order.slice(0, i));
  });
  return {
    order,
    selectedId: current.selectedId ?? previous.selectedId,
    sources: { ...previous.sources, ...current.sources },
    devices: { ...previous.devices, ...current.devices },
  };
}

/** 把 id 插到 `before` 里离它最近、且已在 list 中的那一项后面；都不在就放到最前 */
export function insertAfterNeighbour(list: string[], id: string, before: readonly string[]): void {
  for (let j = before.length - 1; j >= 0; j--) {
    const at = list.indexOf(before[j]!);
    if (at !== -1) {
      list.splice(at + 1, 0, id);
      return;
    }
  }
  list.unshift(id);
}

/** 把一路新出现的声音流放到它在保存顺序里的位置；没保存过就放最后 */
export function placeNewSource(list: string[], id: string, savedOrder: readonly string[]): void {
  const rank = savedOrder.indexOf(id);
  if (rank === -1) list.push(id);
  else insertAfterNeighbour(list, id, savedOrder.slice(0, rank));
}

/** 把本地存储里读到的任意 JSON 清洗成 StoredPrefs，坏字段直接丢掉 */
export function readPrefs(raw: unknown): StoredPrefs | null {
  if (!isRecord(raw)) return null;
  const sources: Record<string, SourcePrefs> = {};
  if (isRecord(raw.sources)) {
    for (const [id, value] of Object.entries(raw.sources)) {
      if (!isRecord(value)) continue;
      const p: SourcePrefs = {};
      if (typeof value.enabled === 'boolean') p.enabled = value.enabled;
      if (isNumber(value.volume)) p.volume = clampVolume(value.volume);
      if (typeof value.deviceId === 'string') p.deviceId = value.deviceId;
      if (Array.isArray(value.eq) && value.eq.length === EQ_BANDS.length && value.eq.every(isNumber)) {
        p.eq = value.eq.map(clampGain);
        p.eqPreset = isPresetId(value.eqPreset) ? value.eqPreset : 'custom';
      }
      sources[id] = p;
    }
  }
  const devices: Record<string, { volume?: number }> = {};
  if (isRecord(raw.devices)) {
    for (const [id, value] of Object.entries(raw.devices)) {
      if (isRecord(value) && isNumber(value.volume)) devices[id] = { volume: clampVolume(value.volume) };
    }
  }
  return {
    order: Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string') : [],
    selectedId: typeof raw.selectedId === 'string' ? raw.selectedId : undefined,
    sources,
    devices,
  };
}

/** 一路声音流套上保存的设置 */
export function applySourcePrefs(source: AudioSource, saved: SourcePrefs | undefined, deviceIds: ReadonlySet<string>, options: CreateOptions): AudioSource {
  if (!saved) return source;
  const next = { ...source };
  if (saved.eq) {
    next.eq = [...saved.eq];
    next.eqPreset = saved.eqPreset ?? 'custom';
  }
  if (!options.systemOwned) {
    if (saved.enabled !== undefined) next.enabled = saved.enabled;
    if (saved.volume !== undefined) next.volume = saved.volume;
    if (saved.deviceId !== undefined && source.routable && deviceIds.has(saved.deviceId)) next.deviceId = saved.deviceId;
  }
  return next;
}

/** 用引擎快照 + 保存的设置拼出初始状态 */
export function createState(snapshot: EngineSnapshot, prefs: StoredPrefs | null, options: CreateOptions): SoundFlowState {
  const deviceIds = new Set(snapshot.devices.map((d) => d.id));

  const devices = snapshot.devices.map((d) => {
    const volume = prefs?.devices[d.id]?.volume;
    return !options.systemOwned && volume !== undefined ? { ...d, volume } : d;
  });

  let sources = snapshot.sources.map((s) => applySourcePrefs(s, prefs?.sources[s.id], deviceIds, options));

  if (prefs && prefs.order.length > 0) {
    const rank = new Map(prefs.order.map((id, i) => [id, i]));
    // 没保存过的应用排在后面，保持引擎给的相对顺序
    sources = sources
      .map((s, i) => ({ s, key: rank.get(s.id) ?? prefs.order.length + i }))
      .sort((a, b) => a.key - b.key)
      .map(({ s }) => s);
  }

  const selectedId =
    prefs?.selectedId && sources.some((s) => s.id === prefs.selectedId) ? prefs.selectedId : (sources[0]?.id ?? '');

  return { sources, devices, selectedId, defaultDeviceId: snapshot.defaultDeviceId, eq: snapshot.eq };
}

export function loadPrefs(): StoredPrefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? readPrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePrefs(prefs: StoredPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
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
