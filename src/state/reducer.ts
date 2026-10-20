import { EQ_BANDS, clampGain, clampVolume, findPreset, flatGains, type BuiltinPresetId } from '../model/eq';
import type { AudioSource, OutputDevice } from '../model/types';

export interface SoundFlowState {
  sources: AudioSource[];
  devices: OutputDevice[];
  /** 当前在控制单元里编辑的声音流 */
  selectedId: string;
  defaultDeviceId: string;
}

export type Action =
  | { type: 'select'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'route'; sourceId: string; deviceId: string }
  | { type: 'sourceVolume'; id: string; volume: number }
  | { type: 'deviceVolume'; id: string; volume: number }
  | { type: 'eqBand'; id: string; band: number; gain: number }
  | { type: 'eqPreset'; id: string; preset: BuiltinPresetId }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'resetRoutes' };

export function reducer(state: SoundFlowState, action: Action): SoundFlowState {
  switch (action.type) {
    case 'select':
      if (state.selectedId === action.id || !hasSource(state, action.id)) return state;
      return { ...state, selectedId: action.id };

    case 'toggle':
      return patchSource(state, action.id, (s) => ({ enabled: !s.enabled }));

    case 'route': {
      if (!state.devices.some((d) => d.id === action.deviceId) || !hasSource(state, action.sourceId)) return state;
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
          deviceId: state.defaultDeviceId,
          enabled: true,
          eq: flatGains(),
          eqPreset: 'flat',
        })),
      };
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
