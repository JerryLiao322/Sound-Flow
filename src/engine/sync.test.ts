import { describe, expect, it } from 'vitest';
import { createState } from '../state/persist';
import { reducer } from '../state/reducer';
import type { AudioEngine } from './AudioEngine';
import { MockAudioEngine } from './MockAudioEngine';
import { syncEngine } from './sync';

function recorder() {
  const calls: string[] = [];
  const engine: AudioEngine = {
    label: 'test',
    native: true,
    supportsEq: false,
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
});
