import { describe, expect, it } from 'vitest';
import type { ExerciseResult } from '../src/exercise/types';
import { DEFAULT_SETTINGS, load, recordResult, save } from '../src/storage/storage';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const res = (success: boolean, time: number): ExerciseResult => ({
  mode: 'check',
  status: success ? 'passed' : 'failed',
  success,
  time,
  faults: [],
  failReasons: success ? [] : ['notInZone'],
  recommendations: [],
});

describe('збереження прогресу', () => {
  it('рахує спроби та найкращий час лише для успішних', () => {
    let p = load(mem()).progress;
    p = recordResult(p, res(true, 40));
    p = recordResult(p, res(false, 20));
    p = recordResult(p, res(true, 35));
    expect(p.check).toEqual({ attempts: 3, successes: 2, bestTime: 35 });
    expect(p.training.attempts).toBe(0);
  });

  it('пошкоджені дані не ламають застосунок', () => {
    const s = mem();
    s.setItem('cruise.v1', '{not json');
    expect(load(s).settings).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trip налаштувань', () => {
    const s = mem();
    const d = load(s);
    save({ ...d, settings: { ...d.settings, sound: false, mode: 'check' } }, s);
    expect(load(s).settings.sound).toBe(false);
    expect(load(s).settings.mode).toBe('check');
  });
});
