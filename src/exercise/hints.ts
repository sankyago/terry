import type { IndicatorSide } from '../sim/indicators';
import type { Gear } from '../sim/vehicle';
import type { ExercisePhase, Mode } from './types';

export interface HintContext {
  mode: Mode;
  phase: ExercisePhase;
  gear: Gear;
  brake: number;
  speedKmh: number;
  s: number;
  curveStartS: number;
  curveEndS: number;
  zoneStartS: number;
  zoneEndS: number;
  holdTime: number;
  stopHold: number;
  inZone: boolean;
  indicator: IndicatorSide;
  limitKmh: number;
}

export interface Hint {
  step: number;
  total: number;
  title: string;
  text: string;
}

const TOTAL = 5;

export function exerciseHint(c: HintContext): Hint {
  if (c.mode === 'check') {
    return {
      step: 0,
      total: 0,
      title: 'Перевірка',
      text: 'Доїдьте до зони, зупиніться всім корпусом у ній, зачекайте й увімкніть P.',
    };
  }
  const h = (step: number, title: string, text: string): Hint => ({ step, total: TOTAL, title, text });
  if (c.phase === 'finished') return h(5, 'Готово', 'Вправу завершено.');
  if (c.phase === 'waiting') {
    if (c.gear === 'P') {
      return c.brake < 0.1
        ? h(1, 'Підготовка', 'Натисніть і тримайте гальмо, потім перемкніть селектор у D.')
        : h(1, 'Підготовка', 'Тримаючи гальмо, перемкніть селектор у D.');
    }
    if (c.gear !== 'D') return h(1, 'Підготовка', 'Для руху вперед перемкніть селектор у D.');
    return h(2, 'Початок руху', 'Відпустіть гальмо — авто покотиться. Плавно додайте газу.');
  }
  if (c.phase === 'stopping') {
    if (c.holdTime < c.stopHold) {
      return h(4, 'Зупинка', `Тримайте гальмо: ще ${Math.max(0.1, c.stopHold - c.holdTime).toFixed(1)} с.`);
    }
    return c.gear === 'P'
      ? h(5, 'Завершення', 'Авто в P.')
      : h(5, 'Завершення', 'Добре! Тримаючи гальмо, перемкніть селектор у P.');
  }
  // driving
  if (c.gear === 'P') {
    return h(4, 'Зупинка', 'Перемкніть у D з натиснутим гальмом і зупиніться всім корпусом у зоні.');
  }
  if (Math.abs(c.speedKmh) > c.limitKmh) {
    return h(2, 'Швидкість', `Понад ${c.limitKmh} км/год — відпустіть газ і пригальмуйте.`);
  }
  if (c.s > c.zoneEndS + 1) {
    return h(4, 'Зупинка', 'Зону пройдено. Зупиніться, увімкніть R і плавно здайте назад до зони.');
  }
  if (c.s < c.curveStartS - 18) return h(2, 'Рух', `Рухайтеся правою смугою, швидкість до ${c.limitKmh} км/год.`);
  if (c.s < c.curveStartS) {
    return c.indicator === 'right'
      ? h(3, 'Поворот', 'Пригальмуйте перед поворотом і плавно поверніть кермо праворуч.')
      : h(3, 'Поворот', 'Попереду поворот праворуч — увімкніть правий покажчик.');
  }
  if (c.s < c.curveEndS) return h(3, 'Поворот', 'Ведіть авто по дузі плавно, не виїжджаючи за край дороги.');
  if (c.s < c.zoneStartS - 14) return h(4, 'Зона попереду', 'Зона зупинки попереду праворуч. Тримайте помірну швидкість.');
  return h(4, 'Зупинка', 'Плавно гальмуйте і зупиніться так, щоб увесь корпус був у зоні.');
}
