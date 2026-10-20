import { describe, expect, it } from 'vitest';
import { abbreviate } from './abbreviate';

describe('abbreviate', () => {
  it.each([
    ['Harman Kardon Aura Studio 4', 'HK'],
    ['Spotify', 'SP'],
    ['Google Chrome', 'GC'],
    ['Realtek(R) Audio', 'RA'],
    ['扬声器 (Realtek(R) Audio)', '扬声'],
    ['系统声音', '系统'],
    ['', '?'],
  ])('%s → %s', (name, code) => {
    expect(abbreviate(name)).toBe(code);
  });
});
