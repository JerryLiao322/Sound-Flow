import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { freqToX, gainToY, nearestBand, smoothPath, yToGain, type PlotBox } from '../geometry/eqPlot';
import { EQ_BANDS, EQ_RANGE, EQ_STEP, formatFreq, formatGain } from '../model/eq';
import { cx } from '../lib/cx';

const VIEW_W = 320;
const VIEW_H = 172;
const BOX: PlotBox = { left: 30, right: 308, top: 16, bottom: 142 };
const DB_TICKS = [EQ_RANGE, EQ_RANGE / 2, 0, -EQ_RANGE / 2, -EQ_RANGE];
const BAND_XS = EQ_BANDS.map((f) => freqToX(f, BOX));

interface Props {
  gains: readonly number[];
  onChange: (band: number, gain: number) => void;
}

/**
 * 十段声音曲线：在图上任意位置按下会抓住最近的频段，上下拖动调增益；
 * 每个节点也能用键盘聚焦后按 ↑ ↓ / PageUp PageDown 调整。
 */
export function EqEditor({ gains, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragBand = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const fillId = `eq-fill-${useId().replace(/:/g, '')}`;

  const points = gains.map((g, i) => ({ x: BAND_XS[i]!, y: gainToY(g, BOX) }));
  const firstY = points[0]?.y ?? gainToY(0, BOX);
  const lastY = points[points.length - 1]?.y ?? gainToY(0, BOX);
  const curve = smoothPath([{ x: BOX.left, y: firstY }, ...points, { x: BOX.right, y: lastY }]);
  const zeroY = gainToY(0, BOX);
  const area = `${curve} L ${BOX.right} ${zeroY} L ${BOX.left} ${zeroY} Z`;
  const highlighted = dragging ?? focused;

  const toView = (e: PointerEvent): { x: number; y: number } | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toView(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const band = nearestBand(p.x, BAND_XS);
    dragBand.current = band;
    setDragging(band);
    onChange(band, yToGain(p.y, BOX));
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const band = dragBand.current;
    const p = band === null ? null : toView(e);
    if (band === null || !p) return;
    onChange(band, yToGain(p.y, BOX));
  };

  const endDrag = () => {
    dragBand.current = null;
    setDragging(null);
  };

  const onNodeKey = (band: number) => (e: KeyboardEvent<SVGGElement>) => {
    const gain = gains[band] ?? 0;
    const next =
      e.key === 'ArrowUp' || e.key === 'ArrowRight' ? gain + EQ_STEP
      : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? gain - EQ_STEP
      : e.key === 'PageUp' ? gain + 3
      : e.key === 'PageDown' ? gain - 3
      : e.key === 'Home' ? -EQ_RANGE
      : e.key === 'End' ? EQ_RANGE
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(band, next);
  };

  return (
    <div className={cx('eq', dragging !== null && 'is-dragging')}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="group"
        aria-label="声音曲线（十段均衡）"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1={BOX.top} x2="0" y2={BOX.bottom} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f3d68f" stopOpacity="0.32" />
            <stop offset="0.5" stopColor="#f3d68f" stopOpacity="0.04" />
            <stop offset="1" stopColor="#f3d68f" stopOpacity="0.32" />
          </linearGradient>
        </defs>

        <g className="eq-grid" aria-hidden>
          {DB_TICKS.map((db) => {
            const y = gainToY(db, BOX);
            return (
              <g key={db}>
                <line x1={BOX.left} x2={BOX.right} y1={y} y2={y} className={db === 0 ? 'eq-zero' : undefined} />
                {db % EQ_RANGE === 0 && (
                  <text x={BOX.left - 6} y={y + 3} textAnchor="end" className="eq-label">
                    {db > 0 ? `+${db}` : db}
                  </text>
                )}
              </g>
            );
          })}
          {BAND_XS.map((x, i) => (
            <g key={i}>
              <line x1={x} x2={x} y1={BOX.top} y2={BOX.bottom} className={cx(highlighted === i && 'is-hot')} />
              <text x={x} y={VIEW_H - 12} textAnchor="middle" className={cx('eq-label', highlighted === i && 'is-hot')}>
                {formatFreq(EQ_BANDS[i]!)}
              </text>
            </g>
          ))}
        </g>

        <path d={area} fill={`url(#${fillId})`} className="eq-area" />
        <path d={curve} className="eq-curve" />

        {points.map((p, i) => {
          const gain = gains[i] ?? 0;
          return (
            <g
              key={i}
              className={cx('eq-node', highlighted === i && 'is-hot')}
              tabIndex={0}
              role="slider"
              aria-label={`${formatFreq(EQ_BANDS[i]!)}Hz`}
              aria-valuemin={-EQ_RANGE}
              aria-valuemax={EQ_RANGE}
              aria-valuenow={gain}
              aria-valuetext={formatGain(gain)}
              onKeyDown={onNodeKey(i)}
              onFocus={() => setFocused(i)}
              onBlur={() => setFocused((f) => (f === i ? null : f))}
            >
              <circle cx={p.x} cy={p.y} r={9} className="eq-node-ring" />
              <circle cx={p.x} cy={p.y} r={4.5} className="eq-node-dot" />
              {highlighted === i && (
                <text x={p.x} y={p.y - 14 < 10 ? p.y + 22 : p.y - 14} textAnchor="middle" className="eq-tip">
                  {formatGain(gain)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
