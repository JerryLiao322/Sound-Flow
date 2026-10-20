import { EQ_RANGE, clampGain } from '../model/eq';
import type { Point } from '../model/types';

/** 曲线绘图区在 SVG viewBox 里的范围 */
export interface PlotBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const LOG_MIN = Math.log10(20);
const LOG_MAX = Math.log10(20000);

/** 频率按对数刻度映射到横坐标（20 Hz – 20 kHz） */
export function freqToX(freq: number, box: PlotBox): number {
  const t = (Math.log10(freq) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return box.left + t * (box.right - box.left);
}

export function gainToY(gain: number, box: PlotBox): number {
  const mid = (box.top + box.bottom) / 2;
  return mid - (gain / EQ_RANGE) * ((box.bottom - box.top) / 2);
}

/** gainToY 的反函数，结果按步进吸附并限制在 ±EQ_RANGE */
export function yToGain(y: number, box: PlotBox): number {
  const mid = (box.top + box.bottom) / 2;
  return clampGain(((mid - y) / ((box.bottom - box.top) / 2)) * EQ_RANGE);
}

/** 用 Catmull-Rom 样条穿过所有点，转成一串三次贝塞尔 */
export function smoothPath(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return '';
  let d = `M ${r(first.x)} ${r(first.y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${r(c1x)} ${r(c1y)}, ${r(c2x)} ${r(c2y)}, ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

/** 离横坐标 x 最近的频段下标 */
export function nearestBand(x: number, bandXs: readonly number[]): number {
  let best = 0;
  let bestDist = Infinity;
  bandXs.forEach((bx, i) => {
    const dist = Math.abs(bx - x);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  });
  return best;
}

function r(n: number): number {
  return Math.round(n * 10) / 10;
}
