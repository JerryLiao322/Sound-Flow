import { describe, expect, it } from 'vitest';
import { MockAudioEngine } from '../engine/MockAudioEngine';
import { createState, mergePrefs, placeNewSource, readPrefs, toPrefs } from './persist';
import { reducer } from './reducer';

const snapshot = () => new MockAudioEngine().snapshot();
const mock = { systemOwned: false };
const native = { systemOwned: true };

describe('createState', () => {
  it('没有保存过设置时直接用引擎快照', () => {
    const s = createState(snapshot(), null, mock);
    expect(s.sources.map((x) => x.id)).toEqual(['spotify', 'game', 'discord', 'chrome', 'system']);
    expect(s.selectedId).toBe('spotify');
  });

  it('toPrefs → readPrefs → createState 能还原用户改过的设置', () => {
    let s = createState(snapshot(), null, mock);
    s = reducer(s, { type: 'route', sourceId: 'game', deviceId: 'monitor' });
    s = reducer(s, { type: 'reorder', from: 4, to: 0 });
    s = reducer(s, { type: 'deviceVolume', id: 'headset', volume: 12 });
    s = reducer(s, { type: 'eqBand', id: 'game', band: 2, gain: 4 });

    const restored = createState(snapshot(), readPrefs(JSON.parse(JSON.stringify(toPrefs(s)))), mock);
    expect(restored.sources).toEqual(s.sources);
    expect(restored.devices).toEqual(s.devices);
    expect(restored.selectedId).toBe('game');
  });

  it('系统掌管时只恢复顺序、选中和曲线，不碰路由和音量', () => {
    let s = createState(snapshot(), null, mock);
    s = reducer(s, { type: 'route', sourceId: 'spotify', deviceId: 'monitor' });
    s = reducer(s, { type: 'sourceVolume', id: 'spotify', volume: 5 });
    s = reducer(s, { type: 'toggle', id: 'spotify' });
    s = reducer(s, { type: 'deviceVolume', id: 'hk', volume: 3 });
    s = reducer(s, { type: 'eqPreset', id: 'spotify', preset: 'night' });
    s = reducer(s, { type: 'reorder', from: 0, to: 2 });

    const restored = createState(snapshot(), readPrefs(toPrefs(s)), native);
    const spotify = restored.sources.find((x) => x.id === 'spotify')!;
    expect(spotify).toMatchObject({ deviceId: 'hk', volume: 72, enabled: true, eqPreset: 'night' });
    expect(restored.devices.find((d) => d.id === 'hk')!.volume).toBe(64);
    expect(restored.sources.map((x) => x.id).indexOf('spotify')).toBe(2);
  });

  it('忽略坏掉或过期的字段', () => {
    const s = createState(
      snapshot(),
      readPrefs({
        order: 'oops',
        selectedId: 'gone',
        sources: {
          spotify: { deviceId: 'unplugged', volume: 'loud', eq: [1, 2, 3], enabled: 'yes' },
          game: { volume: 300, eq: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], eqPreset: 'bogus' },
          system: { deviceId: 'headset' },
        },
        devices: { hk: { volume: Number.NaN } },
      }),
      mock,
    );
    const byId = (id: string) => s.sources.find((x) => x.id === id)!;
    expect(byId('spotify')).toMatchObject({ deviceId: 'hk', volume: 72, enabled: true, eqPreset: 'bass' });
    expect(byId('game')).toMatchObject({ volume: 100, eqPreset: 'custom' });
    // 系统声音不能单独路由，保存的设备也不认
    expect(byId('system').deviceId).toBe('hk');
    expect(s.devices.find((d) => d.id === 'hk')!.volume).toBe(64);
    expect(s.selectedId).toBe('spotify');
    expect(readPrefs('nonsense')).toBeNull();
  });

  it('新出现的应用排在已保存顺序之后', () => {
    const s = createState(snapshot(), readPrefs({ order: ['system', 'chrome'] }), mock);
    expect(s.sources.map((x) => x.id)).toEqual(['system', 'chrome', 'spotify', 'game', 'discord']);
  });
});

describe('mergePrefs', () => {
  it('保留眼下不在场的应用，并放回它原来的位置', () => {
    const previous = readPrefs({
      order: ['a', 'game', 'b'],
      sources: { game: { eqPreset: 'footsteps', eq: [-4, -3, -2, 0, 1, 2, 4, 5, 3, 1] }, a: {} },
    })!;
    const current = readPrefs({ order: ['b', 'a'], sources: { a: { volume: 10 } } })!;
    const merged = mergePrefs(previous, current);
    expect(merged.order).toEqual(['b', 'a', 'game']);
    expect(merged.sources.game?.eqPreset).toBe('footsteps');
    expect(merged.sources.a?.volume).toBe(10);
  });
});

describe('placeNewSource', () => {
  it('按保存的顺序插回原位，没保存过就放最后', () => {
    const list = ['spotify', 'discord'];
    placeNewSource(list, 'game', ['spotify', 'game', 'discord']);
    expect(list).toEqual(['spotify', 'game', 'discord']);
    placeNewSource(list, 'new', ['spotify']);
    expect(list).toEqual(['spotify', 'game', 'discord', 'new']);
    placeNewSource(list, 'first', ['first', 'spotify']);
    expect(list[0]).toBe('first');
  });
});
