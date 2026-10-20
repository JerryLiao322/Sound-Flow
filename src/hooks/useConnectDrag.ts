import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Point } from '../model/types';

export interface PendingWire {
  sourceId: string;
  /** 指针位置，相对连线容器 */
  pointer: Point;
  /** 指针下方的设备；松手就连到它 */
  overDeviceId: string | null;
}

/**
 * 从应用端口拖出一根线，松手在某个设备行上就完成路由。
 * 设备行用 data-device-id 标记自己。按 Esc 取消。
 */
export function useConnectDrag(
  containerRef: RefObject<HTMLElement>,
  onStart: (sourceId: string) => void,
  onConnect: (sourceId: string, deviceId: string) => void,
) {
  const [pending, setPendingState] = useState<PendingWire | null>(null);
  const pendingRef = useRef<PendingWire | null>(null);
  const setPending = (next: PendingWire | null) => {
    pendingRef.current = next;
    setPendingState(next);
  };

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  const toLocal = (e: ReactPointerEvent): Point => {
    const base = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (base?.left ?? 0), y: e.clientY - (base?.top ?? 0) };
  };

  const portHandlers = (sourceId: string) => ({
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      onStart(sourceId);
      setPending({ sourceId, pointer: toLocal(e), overDeviceId: null });
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const current = pendingRef.current;
      if (!current) return;
      setPending({ ...current, pointer: toLocal(e), overDeviceId: deviceAt(e.clientX, e.clientY) });
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const current = pendingRef.current;
      if (!current) return;
      setPending(null);
      const deviceId = deviceAt(e.clientX, e.clientY);
      if (deviceId) onConnect(current.sourceId, deviceId);
    },
    onPointerCancel() {
      setPending(null);
    },
  });

  return { pending, portHandlers };
}

function deviceAt(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-device-id]');
  return el?.dataset.deviceId ?? null;
}
