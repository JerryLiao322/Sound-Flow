import { describe, expect, it } from 'vitest';
import { MockAudioEngine } from '../engine/MockAudioEngine';
import { EQ_RANGE } from '../model/eq';
import { createState } from './persist';
import { reducer, type SoundFlowState } from './reducer';

const initial = (): SoundFlowState => createState(new MockAudioEngine().snapshot(), null, { systemOwned: false });
const source = (s: SoundFlowState, id: string) => s.sources.find((x) => x.id === id)!;

describe('reducer', () => {
  it('route 改设备、打开输出并选中这一路', () => {
    let s = reducer(initial(), { type: 'toggle', id: 'chrome' });
    s = reducer(s, { type: 'route', sourceId: 'chrome', deviceId: 'headset' });
    expect(source(s, 'chrome')).toMatchObject({ deviceId: 'headset', enabled: true });
    expect(s.selectedId).toBe('chrome');
  });

  it('route 到不存在的设备、或路由系统声音时什么都不做', () => {
    const before = initial();
    expect(reducer(before, { type: 'route', sourceId: 'spotify', deviceId: 'nope' })).toBe(before);
    expect(reducer(before, { type: 'route', sourceId: 'system', deviceId: 'headset' })).toBe(before);
  });

  it('toggle 翻转输出开关', () => {
    const s = reducer(initial(), { type: 'toggle', id: 'spotify' });
    expect(source(s, 'spotify').enabled).toBe(false);
  });

  it('eqBand 限幅、按步进吸附，并把预设标成自定义', () => {
    let s = reducer(initial(), { type: 'eqBand', id: 'spotify', band: 5, gain: 99 });
    expect(source(s, 'spotify').eq[5]).toBe(EQ_RANGE);
    expect(source(s, 'spotify').eqPreset).toBe('custom');
    s = reducer(s, { type: 'eqBand', id: 'spotify', band: 5, gain: 2.26 });
    expect(source(s, 'spotify').eq[5]).toBe(2.5);
  });

  it('eqBand 只生成新数组，不改旧状态', () => {
    const before = initial();
    const oldEq = source(before, 'spotify').eq;
    const after = reducer(before, { type: 'eqBand', id: 'spotify', band: 0, gain: -3 });
    expect(source(after, 'spotify').eq).not.toBe(oldEq);
    expect(oldEq[0]).toBe(source(before, 'spotify').eq[0]);
  });

  it('eqPreset 套用预设增益', () => {
    const s = reducer(initial(), { type: 'eqPreset', id: 'chrome', preset: 'night' });
    expect(source(s, 'chrome')).toMatchObject({ eqPreset: 'night', eq: [-5, -4, -2, 0, 0, 0, 0, -1, -3, -4] });
  });

  it('音量限制在 0–100 并取整', () => {
    let s = reducer(initial(), { type: 'sourceVolume', id: 'game', volume: 140 });
    expect(source(s, 'game').volume).toBe(100);
    s = reducer(s, { type: 'deviceVolume', id: 'hk', volume: -4.2 });
    expect(s.devices.find((d) => d.id === 'hk')!.volume).toBe(0);
  });

  it('reorder 移动卡片，越界时忽略', () => {
    const before = initial();
    const s = reducer(before, { type: 'reorder', from: 3, to: 0 });
    expect(s.sources.map((x) => x.id)).toEqual(['chrome', 'spotify', 'game', 'discord', 'system']);
    expect(reducer(before, { type: 'reorder', from: 0, to: 9 })).toBe(before);
  });

  it('resetRoutes 全部回到默认设备、平直曲线，但保留音量', () => {
    const s = reducer(initial(), { type: 'resetRoutes' });
    for (const x of s.sources) {
      expect(x).toMatchObject({ deviceId: 'hk', enabled: true, eqPreset: 'flat' });
      expect(x.eq.every((g) => g === 0)).toBe(true);
    }
    expect(source(s, 'game').volume).toBe(85);
  });
});
