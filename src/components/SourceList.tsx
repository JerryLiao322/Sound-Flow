import { useLayoutEffect, useRef, type PointerEvent } from 'react';
import { useReorder } from '../hooks/useReorder';
import { cx } from '../lib/cx';
import type { AudioSource, OutputDevice } from '../model/types';
import { GripIcon } from './Icons';
import { LiveBadge } from './Meters';
import { Toggle } from './Toggle';

type PortHandlers = {
  onPointerDown(e: PointerEvent<HTMLElement>): void;
  onPointerMove(e: PointerEvent<HTMLElement>): void;
  onPointerUp(e: PointerEvent<HTMLElement>): void;
  onPointerCancel(): void;
};

interface Props {
  sources: AudioSource[];
  devices: OutputDevice[];
  selectedId: string;
  /** 正在从哪一路拖新连线 */
  connectingId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onReorderActive: (active: boolean) => void;
  registerPort: (key: string) => (el: HTMLElement | null) => void;
  portHandlers: (sourceId: string) => PortHandlers;
}

/** 左列：每个应用一张卡片，右侧的端口可以拖出连线 */
export function SourceList(props: Props) {
  const { sources, devices, selectedId, connectingId, onSelect, onToggle, registerPort, portHandlers } = props;
  const listRef = useRef<HTMLOListElement>(null);
  const refocus = useRef<string | null>(null);

  const { draggingIndex, handleProps, offsetFor } = useReorder(
    listRef,
    (from, to, viaKeyboard) => {
      if (viaKeyboard) refocus.current = sources[from]?.id ?? null;
      props.onReorder(from, to);
    },
    props.onReorderActive,
  );

  // 键盘排序后 DOM 节点被挪动会丢焦点，挪完再把焦点放回把手上
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-handle-for="${id}"]`)?.focus();
  });

  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? '未知设备';

  return (
    <ol className={cx('source-list', draggingIndex !== null && 'is-reordering')} ref={listRef} aria-label="声音来源">
      {sources.map((s, i) => {
        const selected = s.id === selectedId;
        const offset = offsetFor(i);
        return (
          <li
            key={s.id}
            className={cx(
              'source-card',
              selected && 'is-selected',
              !s.enabled && 'is-off',
              draggingIndex === i && 'is-lifted',
            )}
            style={offset ? { transform: `translateY(${offset}px)` } : undefined}
            onClick={() => onSelect(s.id)}
          >
            <button
              type="button"
              className="drag-handle"
              data-handle-for={s.id}
              aria-label={`拖动或按方向键调整 ${s.name} 的顺序`}
              {...handleProps(i)}
              onClick={(e) => e.stopPropagation()}
            >
              <GripIcon />
            </button>

            <button type="button" className="source-main" aria-pressed={selected}>
              <span className="tile">{s.code}</span>
              <span className="source-text">
                <span className="source-name">{s.name}</span>
                <span className="source-route">{s.enabled ? `→ ${deviceName(s.deviceId)}` : '输出已关闭'}</span>
              </span>
            </button>

            {s.active && s.enabled && <LiveBadge sourceId={s.id} />}

            <Toggle checked={s.enabled} label="输出" ariaLabel={`${s.name} 输出`} onChange={() => onToggle(s.id)} />

            <span
              className={cx(
                'port port--out',
                s.enabled && 'is-linked',
                selected && s.enabled && 'is-hot',
                connectingId === s.id && 'is-hot',
              )}
              ref={registerPort(`src:${s.id}`)}
              title={`拖动连线，把 ${s.name} 输出到某个设备`}
              {...portHandlers(s.id)}
            />
          </li>
        );
      })}
    </ol>
  );
}
