import type { EqPresetId } from './types';

/** 十段均衡器的中心频率（Hz） */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

/** 每段可调范围 ±EQ_RANGE dB */
export const EQ_RANGE = 12;

/** 拖动/键盘调节的最小步进（dB） */
export const EQ_STEP = 0.5;

export type BuiltinPresetId = Exclude<EqPresetId, 'custom'>;

export interface EqPreset {
  id: BuiltinPresetId;
  label: string;
  gains: readonly number[];
}

export const EQ_PRESETS: readonly EqPreset[] = [
  { id: 'flat', label: '平直', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', label: '低音增强', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal', label: '人声清晰', gains: [-2, -2, -1, 0, 2, 3, 4, 3, 1, 0] },
  { id: 'footsteps', label: '游戏脚步', gains: [-4, -3, -2, 0, 1, 2, 4, 5, 3, 1] },
  { id: 'night', label: '夜间', gains: [-5, -4, -2, 0, 0, 0, 0, -1, -3, -4] },
];

export function findPreset(id: EqPresetId): EqPreset | undefined {
  return EQ_PRESETS.find((p) => p.id === id);
}

export function presetLabel(id: EqPresetId): string {
  return findPreset(id)?.label ?? '自定义';
}

export function flatGains(): number[] {
  return EQ_BANDS.map(() => 0);
}

export function clampGain(gain: number): number {
  const snapped = Math.round(gain / EQ_STEP) * EQ_STEP;
  // 加 0 把 -0 变成 0，免得界面上出现 "-0 dB"
  return Math.min(EQ_RANGE, Math.max(-EQ_RANGE, snapped)) + 0;
}

export function clampVolume(volume: number): number {
  return Math.min(100, Math.max(0, Math.round(volume)));
}

export function formatGain(gain: number): string {
  if (gain === 0) return '0 dB';
  return `${gain > 0 ? '+' : ''}${gain} dB`;
}

export function formatFreq(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}k` : String(freq);
}
