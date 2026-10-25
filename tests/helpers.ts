import type { ExerciseFrame } from '../src/exercise/types';

export const DT = 1 / 60;

export function frame(over: Partial<ExerciseFrame> = {}): ExerciseFrame {
  return {
    dt: DT,
    speedKmh: 10,
    gear: 'D',
    inZone: false,
    offRoad: false,
    contacts: [],
    s: 20,
    moved: 5,
    indicator: 'none',
    ...over,
  };
}

/** Проганяє `seconds` секунд однакових кадрів, повертає всі події. */
export function run<T extends { step(f: ExerciseFrame): unknown[] }>(ex: T, seconds: number, over: Partial<ExerciseFrame> = {}) {
  const out: unknown[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) out.push(...ex.step(frame(over)));
  return out;
}
