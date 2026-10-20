import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Point } from '../model/types';

export type PortMap = Readonly<Record<string, Point>>;

/**
 * 记录每个端口（`src:<id>` / `dev:<id>`）相对容器的中心坐标，供 SVG 连线使用。
 * 端口通过 registerPort(key) 返回的 ref 登记自己。
 */
export function usePortLayout(containerRef: RefObject<HTMLElement>) {
  const elements = useRef(new Map<string, HTMLElement>());
  const refCallbacks = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const [ports, setPorts] = useState<PortMap>({});

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect();
    const next: Record<string, Point> = {};
    elements.current.forEach((el, key) => {
      // 窄屏布局里端口是 display:none，不参与连线
      if (!el.offsetParent) return;
      const r = el.getBoundingClientRect();
      next[key] = { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
    });
    setPorts((prev) => (samePorts(prev, next) ? prev : next));
  }, [containerRef]);

  // ref 回调按 key 缓存，避免每次渲染都触发一次卸载/挂载
  const registerPort = useCallback((key: string) => {
    let callback = refCallbacks.current.get(key);
    if (!callback) {
      callback = (el) => {
        if (el) elements.current.set(key, el);
        else elements.current.delete(key);
      };
      refCallbacks.current.set(key, callback);
    }
    return callback;
  }, []);

  // 每次渲染后都量一遍：选中、开关、排序都可能挪动端口；坐标没变时不会触发重渲染
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [containerRef, measure]);

  // 拖动排序时卡片在做 transform 过渡，期间逐帧跟着量
  const frame = useRef(0);
  const track = useCallback(
    (active: boolean) => {
      cancelAnimationFrame(frame.current);
      if (!active) return;
      const loop = () => {
        measure();
        frame.current = requestAnimationFrame(loop);
      };
      loop();
    },
    [measure],
  );
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return { ports, registerPort, track };
}

function samePorts(a: PortMap, b: PortMap): boolean {
  const keys = Object.keys(b);
  if (keys.length !== Object.keys(a).length) return false;
  return keys.every((k) => {
    const p = a[k];
    const q = b[k]!;
    return p !== undefined && Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  });
}
