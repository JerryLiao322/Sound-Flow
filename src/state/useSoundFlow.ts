import { useEffect, useReducer, useRef, useState } from 'react';
import type { AudioEngine, EngineSnapshot } from '../engine/AudioEngine';
import { syncEngine } from '../engine/sync';
import { mergeSnapshot } from './merge';
import { createState, loadPrefs, mergePrefs, savePrefs, toPrefs, type StoredPrefs } from './persist';
import { reducer, type SoundFlowState } from './reducer';

const SAVE_DELAY_MS = 250;
/** 下发后多久内，系统快照里的旧值不许覆盖界面上的新值 */
const PENDING_MS = 1500;

/**
 * 界面状态的唯一来源。
 * - 用户改动 → 只把变化的字段下发给引擎
 * - 系统推来的变化 → 并进界面，但不会原样再发回去
 * - 顺序、声音曲线等（防抖后）记到本地
 */
export function useSoundFlow(engine: AudioEngine, snapshot: EngineSnapshot) {
  const prefs = useRef<StoredPrefs | null>(null);
  const [initial] = useState(() => {
    prefs.current = loadPrefs();
    return createState(snapshot, prefs.current, { systemOwned: engine.native });
  });
  const [state, dispatch] = useReducer(reducer, initial);

  // 引擎此刻（我们认为）的状态，和界面状态的差异就是要下发的指令。
  // 真实引擎的初始状态就是从它读来的，不用再下发；模拟引擎要先对齐一次。
  const synced = useRef<SoundFlowState | null>(engine.native ? initial : null);
  const pending = useRef(new Map<string, number>());

  useEffect(() => {
    syncEngine(engine, synced.current, state, (key) => pending.current.set(key, Date.now() + PENDING_MS));
    synced.current = state;
  }, [engine, state]);

  useEffect(
    () =>
      engine.onSnapshot((next) => {
        const now = Date.now();
        const keep = new Set<string>();
        pending.current.forEach((until, key) => {
          if (until > now) keep.add(key);
          else pending.current.delete(key);
        });
        // 快照就是系统的真实状态：先记为已同步，这样只有用户还没被确认的改动会再发一次
        if (synced.current) synced.current = mergeSnapshot(synced.current, next, new Set(), prefs.current);
        dispatch({ type: 'engineSnapshot', snapshot: next, pending: keep, prefs: prefs.current });
      }),
    [engine],
  );

  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const persist = () => {
      prefs.current = mergePrefs(prefs.current, toPrefs(latest.current));
      savePrefs(prefs.current);
    };
    const timer = setTimeout(persist, SAVE_DELAY_MS);
    // 防抖期间关掉窗口也别丢掉最后一下改动
    window.addEventListener('pagehide', persist);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', persist);
    };
  }, [state]);

  return [state, dispatch] as const;
}
