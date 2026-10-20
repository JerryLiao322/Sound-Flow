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
    snapshot: () => new MockAudioEngine().snapshot(),
    setRoute: (id, deviceId) => calls.push(`route ${id} ${deviceId}`),
    setSourceEnabled: (id, on) => calls.push(`enabled ${id} ${on}`),
    setSourceVolume: (id, v) => calls.push(`volume ${id} ${v}`),
    setSourceEq: (id) => calls.push(`eq ${id}`),
    setDeviceVolume: (id, v) => calls.push(`device ${id} ${v}`),
    onLevels: () => () => {},
  };
  return { engine, calls };
}

describe('syncEngine', () => {
  it('首次同步下发全部设置', () => {
    const { engine, calls } = recorder();
    const s = createState(engine.snapshot(), null);
    syncEngine(engine, null, s);
    expect(calls).toHaveLength(s.sources.length * 4 + s.devices.length);
  });

  it('之后只下发改变了的字段', () => {
    const { engine, calls } = recorder();
    const before = createState(engine.snapshot(), null);
    const after = reducer(before, { type: 'route', sourceId: 'game', deviceId: 'hk' });
    syncEngine(engine, before, after);
    expect(calls).toEqual(['route game hk']);

    calls.length = 0;
    syncEngine(engine, after, reducer(after, { type: 'select', id: 'chrome' }));
    expect(calls).toEqual([]);
  });
});
