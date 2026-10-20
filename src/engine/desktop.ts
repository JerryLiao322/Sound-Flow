import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useCallback, useEffect, useState } from 'react';
import { isTauri } from './TauriAudioEngine';

export const VB_CABLE_URL = 'https://vb-audio.com/Cable/';

/** 用默认浏览器打开链接（浏览器里开发时就开新标签） */
export function openExternal(url: string): void {
  if (isTauri()) {
    openUrl(url).catch(() => window.open(url, '_blank', 'noopener'));
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/**
 * 开机自启开关。只有安装版有；浏览器里 enabled 恒为 null。
 * 开了声音曲线的应用要靠 Sound Flow 一直运行，所以这个开关很重要。
 */
export function useAutostart() {
  const [enabled, setState] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    isEnabled().then(setState, () => setState(null));
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    (on ? enable() : disable())
      .then(() => isEnabled())
      .then(setState)
      .catch(() => {});
  }, []);

  return { enabled, setEnabled };
}
