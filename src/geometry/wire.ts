import type { Point } from '../model/types';

/**
 * 两个端口之间的连线：水平出、水平进的三次贝塞尔曲线，
 * 和参考图里从左侧卡片端口弯到右侧设备端口的那条线一致。
 */
export function wirePath(from: Point, to: Point): string {
  const dx = Math.max(36, Math.abs(to.x - from.x) * 0.5);
  return `M ${r(from.x)} ${r(from.y)} C ${r(from.x + dx)} ${r(from.y)}, ${r(to.x - dx)} ${r(to.y)}, ${r(to.x)} ${r(to.y)}`;
}

function r(n: number): number {
  return Math.round(n * 10) / 10;
}
