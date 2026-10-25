import { describe, expect, it } from 'vitest';
import type { AnswerRecord } from '../src/storage/storage';
import { DEFAULT_SETTINGS, buildResult, load, recordResult, save } from '../src/storage/storage';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const answers = (mistakes: number, total = 7): AnswerRecord[] =>
  Array.from({ length: total }, (_, i) => ({ ticket: i, option: 0, correct: i >= mistakes }));

describe('результати й прогрес', () => {
  it('іспит складено лише з не більше ніж однією помилкою', () => {
    expect(buildResult('exam', answers(0), 7, 90).passed).toBe(true);
    expect(buildResult('exam', answers(1), 7, 90).passed).toBe(true);
    expect(buildResult('exam', answers(2), 7, 90).passed).toBe(false);
    expect(buildResult('exam', answers(2), 7, 90).correct).toBe(5);
  });

  it('рахує спроби, складені іспити й найкращий результат за режимом', () => {
    let p = load(mem()).progress;
    p = recordResult(p, buildResult('exam', answers(3), 7, 90));
    p = recordResult(p, buildResult('exam', answers(0), 7, 90));
    p = recordResult(p, buildResult('exam', answers(1), 7, 90));
    expect(p.exam).toEqual({ attempts: 3, passes: 2, bestScore: 7 });
    expect(p.training.attempts).toBe(0);
  });

  it('пошкоджені дані не ламають застосунок', () => {
    const s = mem();
    s.setItem('cruise.v2', '{not json');
    expect(load(s).settings).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trip налаштувань', () => {
    const s = mem();
    const d = load(s);
    save({ ...d, settings: { ...d.settings, sound: false, mode: 'exam', camera: 'north' } }, s);
    expect(load(s).settings).toMatchObject({ sound: false, mode: 'exam', camera: 'north' });
  });
});
