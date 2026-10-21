import type { PendingWire } from '../hooks/useConnectDrag';
import type { PortMap } from '../hooks/usePortLayout';
import { wirePath } from '../geometry/wire';
import { cx } from '../lib/cx';
import { hueStyle } from '../lib/theme';
import type { AudioSource } from '../model/types';

interface Props {
  sources: AudioSource[];
  selectedId: string;
  ports: PortMap;
  pending: PendingWire | null;
}

/** 已建立的连线：选中那一路高亮在最上层，正在发声的线上有流动的光点 */
export function Wires({ sources, selectedId, ports, pending }: Props) {
  const wires = sources
    .flatMap((s, index) => {
      const from = ports[`src:${s.id}`];
      const to = ports[`dev:${s.deviceId}`];
      if (!s.enabled || !from || !to) return [];
      return [{ id: s.id, index, d: wirePath(from, to), selected: s.id === selectedId, live: s.active }];
    })
    // 选中的最后画，压在其它线上面
    .sort((a, b) => Number(a.selected) - Number(b.selected));

  return (
    <svg className="wire-layer" aria-hidden>
      {wires.map((w) => (
        <g
          key={w.id}
          style={hueStyle(w.index)}
          className={cx('wire', w.selected && 'is-selected', pending?.sourceId === w.id && 'is-detaching')}
        >
          <path className="wire-base" d={w.d} />
          {w.live && <path className="wire-flow" d={w.d} />}
        </g>
      ))}
    </svg>
  );
}

/** 拖动中的那根线：浮在卡片之上，靠近设备时吸附到它的端口 */
export function PendingWireLayer({ pending, ports, hue }: { pending: PendingWire; ports: PortMap; hue: number }) {
  const from = ports[`src:${pending.sourceId}`];
  if (!from) return null;
  const snapped = pending.overDeviceId ? ports[`dev:${pending.overDeviceId}`] : undefined;
  const to = snapped ?? pending.pointer;
  return (
    <svg className="wire-layer wire-layer--pending" aria-hidden>
      <g className={cx('wire', 'is-pending', snapped && 'is-snapped')} style={hueStyle(hue)}>
        <path className="wire-base" d={wirePath(from, to)} />
        {!snapped && <circle className="wire-tip" cx={to.x} cy={to.y} r={5} />}
      </g>
    </svg>
  );
}
