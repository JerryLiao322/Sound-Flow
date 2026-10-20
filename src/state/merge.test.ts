import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from '../engine/AudioEngine';
import { MockAudioEngine } from '../engine/MockAudioEngine';
import { mergeSnapshot, pendingKey } from './merge';
import { createState, readPrefs } from './persist';
import { reducer } from './reducer';

const snapshot = () => new MockAudioEngine().snapshot();
const initial = () => createState(snapshot(), null, { systemOwned: true });
const none = new Set<string>();

function systemSays(edit: (s: EngineSnapshot) => void): EngineSnapshot {
  const s = snapshot();
  edit(s);
  return s;
}

describe('mergeSnapshot', () => {
  it('路由、音量、静音、设备音量以系统为准', () => {
    const next = systemSays((s) => {
      s.sources[0]!.volume = 10;
      s.sources[0]!.enabled = false;
      s.sources[0]!.deviceId = 'monitor';
      s.devices[0]!.volume = 5;
    });
    const merged = mergeSnapshot(initial(), next, none, null);
    expect(merged.sources[0]).toMatchObject({ id: 'spotify', volume: 10, enabled: false, deviceId: 'monitor' });
    expect(merged.devices[0]!.volume).toBe(5);
  });

  it('用户刚改过、系统还没确认的字段保留界面上的值', () => {
    const state = reducer(initial(), { type: 'sourceVolume', id: 'spotify', volume: 30 });
    const stale = snapshot(); // 系统那边还是 72
    const merged = mergeSnapshot(state, stale, new Set([pendingKey.sourceVolume('spotify')]), null);
    expect(merged.sources[0]!.volume).toBe(30);
  });

  it('保留界面的顺序和声音曲线', () => {
    let state = reducer(initial(), { type: 'reorder', from: 0, to: 3 });
    state = reducer(state, { type: 'eqPreset', id: 'spotify', preset: 'night' });
    const merged = mergeSnapshot(state, snapshot(), none, null);
    expect(merged.sources.map((s) => s.id)).toEqual(state.sources.map((s) => s.id));
    expect(merged.sources.find((s) => s.id === 'spotify')!.eqPreset).toBe('night');
  });

  it('应用关掉就移除；选中的被移除时改选第一个', () => {
    const state = reducer(initial(), { type: 'select', id: 'discord' });
    const merged = mergeSnapshot(state, systemSays((s) => s.sources.splice(2, 1)), none, null);
    expect(merged.sources.map((s) => s.id)).not.toContain('discord');
    expect(merged.selectedId).toBe('spotify');
  });

  it('重新出现的应用接上保存的曲线和位置', () => {
    const state = mergeSnapshot(initial(), systemSays((s) => s.sources.splice(1, 1)), none, null);
    expect(state.sources.map((s) => s.id)).not.toContain('game');

    const prefs = readPrefs({
      order: ['spotify', 'game', 'discord', 'chrome', 'system'],
      sources: { game: { eq: [-4, -3, -2, 0, 1, 2, 4, 5, 3, 1], eqPreset: 'footsteps', volume: 1 } },
    });
    const back = mergeSnapshot(state, snapshot(), none, prefs);
    const game = back.sources.find((s) => s.id === 'game')!;
    expect(back.sources.map((s) => s.id).indexOf('game')).toBe(1);
    expect(game.eqPreset).toBe('footsteps');
    // 音量仍以系统为准
    expect(game.volume).toBe(85);
  });
});
