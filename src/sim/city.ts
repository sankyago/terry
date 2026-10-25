import { CITY } from '../config';
import type { Vec2 } from './math';

/** flash — миготливий жовтий (світлофор працює як нерегульоване перехрестя). */
export type LightColor = 'red' | 'redYellow' | 'yellow' | 'green' | 'flash';
/** ns — сигнал для руху вздовж осі Z (північ–південь), ew — уздовж осі X. */
export interface LightState {
  ns: LightColor;
  ew: LightColor;
}

export interface SignalizedIntersection {
  id: string;
  x: number;
  z: number;
  initial: LightState;
}

/**
 * giveWay — 2.1 «Дати дорогу», stop — 2.2 «Проїзд без зупинки заборонено», mainRoad — 2.3 «Головна дорога»,
 * crosswalk — 5.35 «Пішохідний перехід», yieldOncoming — 2.6 «Перевага зустрічного руху»,
 * priorityOncoming — 2.7 «Перевага перед зустрічним рухом», roadworks — 1.37 «Дорожні роботи»,
 * busStop — 5.41 «Пункт зупинки автобуса».
 */
export type SignKind =
  | 'giveWay'
  | 'stop'
  | 'mainRoad'
  | 'crosswalk'
  | 'yieldOncoming'
  | 'priorityOncoming'
  | 'roadworks'
  | 'busStop';

/** Дорожній знак: стоїть у точці (x, z) і дивиться назустріч транспорту, що рухається з heading. */
export interface Sign {
  kind: SignKind;
  x: number;
  z: number;
  /** Напрямок руху транспорту, для якого призначений знак. */
  facing: number;
}

/** Зебра: center — центр, roadAlongX — дорога під зеброю йде вздовж осі X. */
export interface Crosswalk {
  x: number;
  z: number;
  roadAlongX: boolean;
  width: number;
}

/** Поперечна лінія перед перехрестям: зубці «Дати дорогу» або суцільна стоп-лінія. */
export interface RoadLine {
  kind: 'giveWay' | 'stop';
  x: number;
  z: number;
  heading: number;
}

/** Статичний антураж ситуації: огородження робіт, конус, знак аварійної зупинки, павільйон зупинки. */
export interface Prop {
  kind: 'barrier' | 'cone' | 'triangle' | 'shelter' | 'kiosk';
  x: number;
  z: number;
  heading: number;
}

/** Усе, що місто має показати для конкретного маршруту: світлофори, знаки, розмітка, антураж. */
export interface WorldFeatures {
  signals: SignalizedIntersection[];
  signs: Sign[];
  crosswalks: Crosswalk[];
  lines: RoadLine[];
  props: Prop[];
  /** Місця ситуацій: тут не ставимо високих будинків, щоб камера бачила учасників. */
  open: Array<{ x: number; z: number; r: number }>;
  /** Місця, де не можна садити дерева й ставити ліхтарі (стежки пішоходів ситуацій). */
  avoid: Array<{ x: number; z: number; r: number }>;
  /** Перехрестя з переходами на всіх рукавах — осьова лінія перед ними коротша. */
  wideNodes: Vec2[];
}

/** Виїзд із двору: розрив у тротуарі й бордюрі. */
export const DRIVEWAYS: Array<{ x: number; z: number; width: number; alongZ: boolean }> = [
  { x: 20, z: 90 - CITY.roadHalfWidth - CITY.sidewalk / 2, width: 7, alongZ: true },
];

/** Двір зі стоянкою, з якого стартує учень. */
export const YARD = { minX: 8, maxX: 62, minZ: 28, maxZ: 83.5 };
