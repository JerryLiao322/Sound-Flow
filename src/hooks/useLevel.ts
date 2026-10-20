import { useEffect, useRef } from 'react';
import { useEngine } from '../engine/EngineContext';

/**
 * 订阅某一路声音流的实时电平，直接写到 DOM 上（不走 React 渲染，避免整树 20fps 重绘）。
 * apply 收到的是平滑过的电平：上升立刻跟上，下降慢慢回落。
 */
export function useLevel<T extends HTMLElement>(sourceId: string, apply: (el: T, level: number) => void) {
  const engine = useEngine();
  const ref = useRef<T>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    let shown = 0;
    if (ref.current) applyRef.current(ref.current, 0);
    return engine.onLevels((frame) => {
      const el = ref.current;
      if (!el) return;
      const level = frame[sourceId] ?? 0;
      shown = level > shown ? level : shown * 0.8 + level * 0.2;
      applyRef.current(el, shown);
    });
  }, [engine, sourceId]);

  return ref;
}
