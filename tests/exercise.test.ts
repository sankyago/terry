import { describe, expect, it } from 'vitest';
import { Exercise } from '../src/exercise/exercise';
import type { ExerciseEvent } from '../src/exercise/types';
import { frame, run } from './helpers';

const make = (mode: 'training' | 'check' = 'check') => new Exercise({ mode, curveStartS: 50 });
const faultsOf = (ev: unknown[], kind?: string) =>
  (ev as ExerciseEvent[]).filter((e) => e.type === 'fault' && (!kind || e.fault.kind === kind));
const finished = (ev: unknown[]) => (ev as ExerciseEvent[]).find((e) => e.type === 'finished');

/** Доїхати і стояти в зоні `hold` секунд, потім перемкнути в P. */
function stopAndPark(ex: Exercise, hold: number, inZone = true) {
  run(ex, 1, { speedKmh: 12, s: 30 });
  run(ex, 1, { speedKmh: 12, s: 60, indicator: 'right' });
  run(ex, hold, { speedKmh: 0, inZone, s: 102 });
  return ex.step(frame({ speedKmh: 0, inZone, s: 102, gear: 'P' }));
}

describe('стани вправи', () => {
  it('чекає старту, доки авто не рушило', () => {
    const ex = make();
    run(ex, 3, { speedKmh: 0, moved: 0, gear: 'P' });
    expect(ex.phase).toBe('waiting');
    expect(ex.elapsed).toBe(0);
    ex.step(frame({ moved: 1, speedKmh: 3 }));
    expect(ex.phase).toBe('driving');
  });

  it('переходить у «зупинку в зоні» лише при майже нульовій швидкості', () => {
    const ex = make();
    run(ex, 0.5, { speedKmh: 5, inZone: true });
    expect(ex.phase).toBe('driving');
    run(ex, 0.5, { speedKmh: 0.2, inZone: true });
    expect(ex.phase).toBe('stopping');
    run(ex, 0.1, { speedKmh: 2, inZone: true });
    expect(ex.phase).toBe('driving');
    expect(ex.holdTime).toBe(0);
  });
});

describe('умови завершення', () => {
  it('успіх: увесь корпус у зоні, ≥2 с стоянки, потім P', () => {
    const ex = make();
    const ev = stopAndPark(ex, 2.1);
    const f = finished(ev);
    expect(f && f.type === 'finished' && f.result.success).toBe(true);
    expect(ex.phase).toBe('finished');
    expect(ex.result?.status).toBe('passed');
  });

  it('P раніше ніж через 2 с у режимі перевірки — невдача «holdShort»', () => {
    const ex = make('check');
    stopAndPark(ex, 1.2);
    expect(ex.result?.success).toBe(false);
    expect(ex.result?.failReasons).toEqual(['holdShort']);
  });

  it('частково поза зоною — невдача «notInZone»', () => {
    const ex = make('check');
    stopAndPark(ex, 3, false);
    expect(ex.result?.failReasons).toEqual(['notInZone']);
  });

  it('у навчанні передчасне P не завершує вправу, а дає пояснення один раз', () => {
    const ex = make('training');
    const ev1 = stopAndPark(ex, 0.5);
    expect(ex.phase).not.toBe('finished');
    expect(faultsOf(ev1, 'earlyPark')).toHaveLength(1);
    // Повторне смикання P→D→P протягом 3 с не нараховує нову помилку.
    ex.step(frame({ speedKmh: 0, inZone: true, s: 102, gear: 'D' }));
    const ev2 = ex.step(frame({ speedKmh: 0, inZone: true, s: 102, gear: 'P' }));
    expect(faultsOf(ev2, 'earlyPark')).toHaveLength(0);
    // Після достатньої паузи — D і знову P: успіх.
    run(ex, 2.2, { speedKmh: 0, inZone: true, s: 102, gear: 'D' });
    ex.step(frame({ speedKmh: 0, inZone: true, s: 102, gear: 'P' }));
    expect(ex.result?.success).toBe(true);
    expect(ex.result?.status).toBe('passedWithRemarks');
  });

  it('зіткнення робить вправу невиконаною навіть при правильній зупинці', () => {
    const ex = make();
    run(ex, 0.2, { contacts: [{ id: 'cone-1', label: 'конус' }] });
    stopAndPark(ex, 2.5);
    expect(ex.result?.success).toBe(false);
    expect(ex.result?.failReasons).toContain('collision');
  });

  it('після завершення кадри ігноруються', () => {
    const ex = make();
    stopAndPark(ex, 2.1);
    const n = ex.faults.length;
    run(ex, 2, { speedKmh: 40, offRoad: true });
    expect(ex.faults.length).toBe(n);
  });

  it('reset повністю скидає стан', () => {
    const ex = make();
    run(ex, 1, { speedKmh: 30 });
    stopAndPark(ex, 2.1);
    ex.reset();
    expect(ex.phase).toBe('waiting');
    expect(ex.faults).toHaveLength(0);
    expect(ex.result).toBeNull();
    expect(ex.elapsed).toBe(0);
  });
});

describe('захист від повторного нарахування', () => {
  it('тривале перевищення швидкості — одна помилка', () => {
    const ex = make();
    const ev = run(ex, 5, { speedKmh: 26 });
    expect(faultsOf(ev, 'speeding')).toHaveLength(1);
  });

  it('гістерезис: падіння до 19 км/год не «зводить» тригер знову', () => {
    const ex = make();
    run(ex, 1, { speedKmh: 22 });
    run(ex, 3, { speedKmh: 19 });
    run(ex, 1, { speedKmh: 22 });
    expect(ex.countOf('speeding')).toBe(1);
  });

  it('новий епізод перевищення після нормальної їзди — друга помилка', () => {
    const ex = make();
    run(ex, 1, { speedKmh: 25 });
    run(ex, 4, { speedKmh: 12 });
    run(ex, 1, { speedKmh: 25 });
    expect(ex.countOf('speeding')).toBe(2);
  });

  it('безперервний контакт з перешкодою — одна подія; інша перешкода — окрема', () => {
    const ex = make();
    run(ex, 2, { contacts: [{ id: 'cone-1', label: 'конус' }] });
    expect(ex.countOf('collision')).toBe(1);
    run(ex, 0.2, { contacts: [{ id: 'cone-1', label: 'конус' }, { id: 'cone-2', label: 'конус' }] });
    expect(ex.countOf('collision')).toBe(2);
  });

  it('коротке «тремтіння» контакту не нараховує нову помилку', () => {
    const ex = make();
    for (let i = 0; i < 10; i++) {
      run(ex, 0.1, { contacts: [{ id: 'barrier', label: 'бетонний блок' }] });
      run(ex, 0.1);
    }
    expect(ex.countOf('collision')).toBe(1);
  });

  it('виїзд за дорогу: одна помилка за епізод', () => {
    const ex = make();
    run(ex, 3, { offRoad: true });
    run(ex, 0.3, { offRoad: false });
    run(ex, 1, { offRoad: true });
    expect(ex.countOf('offroad')).toBe(1);
    run(ex, 2, { offRoad: false });
    run(ex, 0.5, { offRoad: true });
    expect(ex.countOf('offroad')).toBe(2);
  });

  it('покажчик повороту перевіряється один раз на вході в поворот', () => {
    const ex = make();
    run(ex, 1, { s: 49 });
    run(ex, 2, { s: 55 });
    expect(ex.countOf('noSignal')).toBe(1);
    const ok = make();
    run(ok, 1, { s: 49, indicator: 'right' });
    run(ok, 1, { s: 55, indicator: 'right' });
    expect(ok.countOf('noSignal')).toBe(0);
  });
});
