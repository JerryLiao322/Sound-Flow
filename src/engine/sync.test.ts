import { describe, expect, it } from 'vitest';
import { createState, readPrefs } from '../state/persist';
import { reducer } from '../state/reducer';
import type { AudioEngine } from './AudioEngine';
import { MockAudioEngine } from './MockAudioEngine';
import { syncEngine } from './sync';

function recorder() {
  const calls: string[] = [];
  const engine: AudioEngine = {
    label: 'test',
    native: true,
    load: () => new MockAudioEngine().load(),
    onSnapshot: () => () => {},
    onError: () => () => {},
    setRoute: (id, deviceId) => calls.push(`route ${id} ${deviceId}`),
    setSourceEnabled: (id, on) => calls.push(`enabled ${id} ${on}`),
    setSourceVolume: (id, v) => calls.push(`volume ${id} ${v}`),
    setSourceEq: (id) => calls.push(`eq ${id}`),
    setDeviceVolume: (id, v) => calls.push(`device ${id} ${v}`),
    onLevels: () => () => {},
  };
  return { engine, calls };
}

const initial = () => createState(new MockAudioEngine().snapshot(), null, { systemOwned: false });

describe('syncEngine', () => {
  it('首次同步下发全部设置，但不给不能路由的声音流发路由', () => {
    const { engine, calls } = recorder();
    const s = initial();
    syncEngine(engine, null, s);
    const routable = s.sources.filter((x) => x.routable).length;
    expect(calls).toHaveLength(routable + s.sources.length * 3 + s.devices.length);
    expect(calls).not.toContain('route system hk');
  });

  it('之后只下发改变了的字段，并报告哪些字段在等系统确认', () => {
    const { engine, calls } = recorder();
    const before = initial();
    const after = reducer(before, { type: 'route', sourceId: 'game', deviceId: 'hk' });
    const sent: string[] = [];
    syncEngine(engine, before, after, (key) => sent.push(key));
    expect(calls).toEqual(['route game hk']);
    expect(sent).toEqual(['src:game:device']);

    calls.length = 0;
    syncEngine(engine, after, reducer(after, { type: 'select', id: 'chrome' }));
    expect(calls).toEqual([]);
  });

  it('安装版启动时只下发保存过的曲线，路由和音量一概不动', () => {
    const { engine, calls } = recorder();
    // 引擎眼里：全是平直曲线
    const snapshot = new MockAudioEngine().snapshot();
    snapshot.sources = snapshot.sources.map((s) => ({ ...s, eq: Array(10).fill(0), eqPreset: 'flat' }));
    const engineView = createState(snapshot, null, { systemOwned: true });
    const prefs = readPrefs({
      sources: {
        spotify: { eq: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], eqPreset: 'bass', volume: 3, deviceId: 'monitor' },
        game: { eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], eqPreset: 'flat' },
      },
    });
    const ui = createState(snapshot, prefs, { systemOwned: true });
    syncEngine(engine, engineView, ui);
    expect(calls).toEqual(['eq spotify']);
  });
});
