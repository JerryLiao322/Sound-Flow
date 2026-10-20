import { describe, expect, it } from 'vitest';
import { EQ_BANDS, EQ_RANGE } from '../model/eq';
import { freqToX, gainToY, nearestBand, smoothPath, yToGain, type PlotBox } from './eqPlot';
import { wirePath } from './wire';

const box: PlotBox = { left: 0, right: 300, top: 0, bottom: 120 };

describe('eqPlot', () => {
  it('频率按对数刻度从左到右排列', () => {
    expect(freqToX(20, box)).toBeCloseTo(0);
    expect(freqToX(20000, box)).toBeCloseTo(300);
    const xs = EQ_BANDS.map((f) => freqToX(f, box));
    xs.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(xs[i]!));
  });

  it('增益和纵坐标互逆，超出范围会被限住', () => {
    expect(gainToY(0, box)).toBe(60);
    expect(gainToY(EQ_RANGE, box)).toBe(0);
    for (const g of [-12, -6.5, 0, 3, 12]) expect(yToGain(gainToY(g, box), box)).toBe(g);
    expect(yToGain(-50, box)).toBe(EQ_RANGE);
    expect(Object.is(yToGain(60.1, box), -0)).toBe(false);
  });

  it('smoothPath 每两个点之间一段三次贝塞尔', () => {
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
    expect(d.endsWith('20 0')).toBe(true);
    expect(smoothPath([])).toBe('');
  });

  it('nearestBand 选最近的频段', () => {
    expect(nearestBand(11, [0, 10, 20])).toBe(1);
    expect(nearestBand(-100, [0, 10, 20])).toBe(0);
  });
});

describe('wirePath', () => {
  it('从起点水平出、水平进到终点', () => {
    expect(wirePath({ x: 0, y: 0 }, { x: 100, y: 40 })).toBe('M 0 0 C 50 0, 50 40, 100 40');
  });

  it('距离很近时也保留最小弯度', () => {
    expect(wirePath({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe('M 0 0 C 36 0, -26 0, 10 0');
  });
});
