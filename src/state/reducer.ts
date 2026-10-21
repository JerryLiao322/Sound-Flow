import type { EngineSnapshot } from '../engine/AudioEngine';
import { EQ_BANDS, clampGain, clampVolume, findPreset, flatGains, type BuiltinPresetId } from '../model/eq';
import type { AudioSource, EqStatus, OutputDevice } from '../model/types';
import { mergeSnapshot, type PendingKeys } from './merge';
import type { StoredPrefs } from './persist';

export interface SoundFlowState {
  sources: AudioSource[];
  devices: OutputDevice[];
  /** 当前在控制单元里编辑的声音流 */
  selectedId: string;
  defaultDeviceId: string;
  eq: EqStatus;
}

export type Action =
  | { type: 'select'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'route'; sourceId: string; deviceId: string }
  | { type: 'sourceVolume'; id: string; volume: number }
  | { type: 'deviceVolume'; id: string; volume: number }
  /** 设为系统默认输出设备：连在原默认设备上的（跟随默认的）一起搬过去 */
  | { type: 'setDefaultDevice'; id: string }
  | { type: 'eqBand'; id: string; band: number; gain: number }
  | { type: 'eqPreset'; id: string; preset: BuiltinPresetId }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'resetRoutes' }
  /** 系统那边有变化（应用开关、设备插拔、在别处调了音量） */
  | { type: 'engineSnapshot'; snapshot: EngineSnapshot; pending: PendingKeys; prefs: StoredPrefs | null };

export function reducer(state: SoundFlowState, action: Action): SoundFlowState {
  switch (action.type) {
    case 'select':
      if (state.selectedId === action.id || !hasSource(state, action.id)) return state;
      return { ...state, selectedId: action.id };

    case 'toggle':
      return patchSource(state, action.id, (s) => ({ enabled: !s.enabled }));

    case 'route': {
      const source = state.sources.find((s) => s.id === action.sourceId);
      if (!source?.routable || !state.devices.some((d) => d.id === action.deviceId)) return state;
      // 连上线就意味着要听到它：顺便打开输出，并切到这一路
      const next = patchSource(state, action.sourceId, () => ({ deviceId: action.deviceId, enabled: true }));
      return { ...next, selectedId: action.sourceId };
    }

    case 'sourceVolume':
      return patchSource(state, action.id, () => ({ volume: clampVolume(action.volume) }));

    case 'deviceVolume':
      return {
        ...state,
        devices: state.devices.map((d) => (d.id === action.id ? { ...d, volume: clampVolume(action.volume) } : d)),
      };

    case 'setDefaultDevice': {
      const previous = state.defaultDeviceId;
      if (action.id === previous || !state.devices.some((d) => d.id === action.id)) return state;
      return {
        ...state,
        defaultDeviceId: action.id,
        sources: state.sources.map((s) => (s.deviceId === previous ? { ...s, deviceId: action.id } : s)),
      };
    }

    case 'eqBand':
      if (action.band < 0 || action.band >= EQ_BANDS.length) return state;
      return patchSource(state, action.id, (s) => {
        const eq = s.eq.slice();
        eq[action.band] = clampGain(action.gain);
        return { eq, eqPreset: 'custom' };
      });

    case 'eqPreset': {
      const preset = findPreset(action.preset);
      if (!preset) return state;
      return patchSource(state, action.id, () => ({ eq: [...preset.gains], eqPreset: preset.id }));
    }

    case 'reorder': {
      const { from, to } = action;
      const n = state.sources.length;
      if (from === to || from < 0 || to < 0 || from >= n || to >= n) return state;
      const sources = state.sources.slice();
      const [moved] = sources.splice(from, 1);
      sources.splice(to, 0, moved!);
      return { ...state, sources };
    }

    case 'resetRoutes':
      return {
        ...state,
        sources: state.sources.map((s) => ({
          ...s,
          deviceId: s.routable ? state.defaultDeviceId : s.deviceId,
          enabled: true,
          eq: flatGains(),
          eqPreset: 'flat',
        })),
      };

    case 'engineSnapshot':
      return mergeSnapshot(state, action.snapshot, action.pending, action.prefs);
  }
}

function hasSource(state: SoundFlowState, id: string): boolean {
  return state.sources.some((s) => s.id === id);
}

function patchSource(
  state: SoundFlowState,
  id: string,
  patch: (s: AudioSource) => Partial<AudioSource>,
): SoundFlowState {
  if (!hasSource(state, id)) return state;
  return {
    ...state,
    sources: state.sources.map((s) => (s.id === id ? { ...s, ...patch(s) } : s)),
  };
}
