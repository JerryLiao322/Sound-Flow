import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

interface ReorderDrag {
  from: number;
  to: number;
  /** 被拖卡片当前的垂直位移 */
  dy: number;
  /** 一张卡片加间距的高度 */
  slot: number;
  startY: number;
  count: number;
}

/**
 * 按住把手上下拖动列表项排序；把手获得焦点时也可以用 ↑ ↓ 键移动。
 * listRef 指向直接包含各项的列表元素。
 */
export function useReorder(
  listRef: RefObject<HTMLElement>,
  onCommit: (from: number, to: number, viaKeyboard: boolean) => void,
  onActiveChange?: (active: boolean) => void,
) {
  const [drag, setDragState] = useState<ReorderDrag | null>(null);
  const dragRef = useRef<ReorderDrag | null>(null);
  const setDrag = (next: ReorderDrag | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  const end = (commit: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    onActiveChange?.(false);
    if (commit && d.to !== d.from) onCommit(d.from, d.to, false);
  };

  const handleProps = (index: number) => ({
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      const items = listRef.current?.children;
      const first = items?.[0] as HTMLElement | undefined;
      if (!items || !first) return;
      const second = items[1] as HTMLElement | undefined;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({
        from: index,
        to: index,
        dy: 0,
        slot: second ? second.offsetTop - first.offsetTop : first.offsetHeight,
        startY: e.clientY,
        count: items.length,
      });
      onActiveChange?.(true);
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = dragRef.current;
      if (!d) return;
      const dy = clamp(e.clientY - d.startY, -d.from * d.slot, (d.count - 1 - d.from) * d.slot);
      setDrag({ ...d, dy, to: clamp(d.from + Math.round(dy / d.slot), 0, d.count - 1) });
    },
    onPointerUp() {
      end(true);
    },
    onPointerCancel() {
      end(false);
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      if (!delta) return;
      e.preventDefault();
      const to = index + delta;
      if (to >= 0 && to < (listRef.current?.children.length ?? 0)) onCommit(index, to, true);
    },
  });

  /** 第 index 项此刻应有的位移：被拖的跟手，被越过的让出一格 */
  const offsetFor = (index: number): number => {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.slot;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.slot;
    return 0;
  };

  return { draggingIndex: drag?.from ?? null, handleProps, offsetFor };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
