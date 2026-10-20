import { useEffect, useReducer, useRef } from 'react';
import type { AudioEngine } from '../engine/AudioEngine';
import { syncEngine } from '../engine/sync';
import { createState, loadPrefs, savePrefs } from './persist';
import { reducer, type SoundFlowState } from './reducer';

const SAVE_DELAY_MS = 250;

/** 界面状态的唯一来源：变化会同步给引擎，并（防抖后）记到本地 */
export function useSoundFlow(engine: AudioEngine) {
  const [state, dispatch] = useReducer(reducer, engine, (e) => createState(e.snapshot(), loadPrefs()));

  const synced = useRef<SoundFlowState | null>(null);
  useEffect(() => {
    syncEngine(engine, synced.current, state);
    synced.current = state;
  }, [engine, state]);

  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const timer = setTimeout(() => savePrefs(state), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    // 防抖期间关掉窗口也别丢掉最后一下改动
    const flush = () => savePrefs(latest.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  return [state, dispatch] as const;
}
