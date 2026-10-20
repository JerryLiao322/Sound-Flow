import { describe, expect, it } from 'vitest';
import { MockAudioEngine } from '../engine/MockAudioEngine';
import { createState, toPrefs } from './persist';
import { reducer } from './reducer';

const snapshot = () => new MockAudioEngine().snapshot();

describe('createState', () => {
  it('没有保存过偏好时直接用引擎快照', () => {
    const s = createState(snapshot(), null);
    expect(s.sources.map((x) => x.id)).toEqual(['spotify', 'game', 'discord', 'chrome', 'system']);
    expect(s.selectedId).toBe('spotify');
  });

  it('toPrefs → createState 能还原用户改过的设置', () => {
    let s = createState(snapshot(), null);
    s = reducer(s, { type: 'route', sourceId: 'game', deviceId: 'monitor' });
    s = reducer(s, { type: 'reorder', from: 4, to: 0 });
    s = reducer(s, { type: 'deviceVolume', id: 'headset', volume: 12 });
    s = reducer(s, { type: 'eqBand', id: 'game', band: 2, gain: 4 });

    const restored = createState(snapshot(), JSON.parse(JSON.stringify(toPrefs(s))));
    expect(restored.sources).toEqual(s.sources);
    expect(restored.devices).toEqual(s.devices);
    expect(restored.selectedId).toBe('game');
  });

  it('忽略坏掉或过期的字段', () => {
    const s = createState(snapshot(), {
      order: 'oops',
      selectedId: 'gone',
      sources: {
        spotify: { deviceId: 'unplugged', volume: 'loud', eq: [1, 2, 3], enabled: 'yes' },
        game: { volume: 300, eq: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], eqPreset: 'bogus' },
      },
      devices: { hk: { volume: Number.NaN } },
    });
    const spotify = s.sources.find((x) => x.id === 'spotify')!;
    expect(spotify).toMatchObject({ deviceId: 'hk', volume: 72, enabled: true, eqPreset: 'bass' });
    expect(s.sources.find((x) => x.id === 'game')).toMatchObject({ volume: 100, eqPreset: 'custom' });
    expect(s.devices.find((d) => d.id === 'hk')!.volume).toBe(64);
    expect(s.selectedId).toBe('spotify');
  });

  it('新出现的应用排在已保存顺序之后', () => {
    const s = createState(snapshot(), { order: ['system', 'chrome'] });
    expect(s.sources.map((x) => x.id)).toEqual(['system', 'chrome', 'spotify', 'game', 'discord']);
  });
});
