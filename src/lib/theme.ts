import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useState, type CSSProperties } from 'react';
import { isTauri } from '../engine/TauriAudioEngine';

export type ThemeId = 'jade' | 'neon' | 'daylight' | 'console' | 'mono';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  /** 选择器里的小色块：底色 + 点缀色 */
  swatch: [string, string];
}

export const THEMES: ThemeInfo[] = [
  { id: 'jade', label: '墨玉', swatch: ['#10201d', '#e3bd6b'] },
  { id: 'neon', label: '霓虹', swatch: ['#120f2e', '#22d3ee'] },
  { id: 'daylight', label: '晴空', swatch: ['#f4f6fa', '#0067c0'] },
  { id: 'console', label: '调音台', swatch: ['#1d1d1f', '#ff8a1f'] },
  { id: 'mono', label: '极简', swatch: ['#0a0a0a', '#f5f5f5'] },
];

export const DEFAULT_THEME: ThemeId = 'jade';

const STORAGE_KEY = 'sound-flow:theme';

function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function readTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemeId(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** 浅色主题时窗口标题栏也跟着变浅 */
const LIGHT_THEMES: ThemeId[] = ['daylight'];

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  if (!isTauri()) return;
  try {
    getCurrentWindow()
      .setTheme(LIGHT_THEMES.includes(id) ? 'light' : 'dark')
      .catch(() => {});
  } catch {
    // 标题栏颜色只是锦上添花，失败了不影响界面
  }
}

export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setThemeState] = useState<ThemeId>(readTheme);
  const setTheme = useCallback((id: ThemeId) => {
    applyTheme(id);
    setThemeState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // 存不下也不影响本次使用
    }
  }, []);
  return [theme, setTheme];
}

/** 每一路声音流的专属颜色（由主题定义 --c0…--c5）；没定义的主题会回落到统一的线色 */
export function hueStyle(index: number): CSSProperties {
  return { '--src': `var(--c${index % 6})` } as CSSProperties;
}
