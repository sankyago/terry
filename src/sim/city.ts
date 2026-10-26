import { CITY } from '../config';
import type { Vec2 } from './math';

/** Кількість смуг у кожен бік на дорозі вздовж осі Z (x = const) і вздовж осі X (z = const). */
export const lanesAtX = (x: number) => CITY.avenuesX[x] ?? 1;
export const lanesAtZ = (z: number) => CITY.avenuesZ[z] ?? 1;
/** Половина ширини проїзної частини з lanes смугами в кожен бік (у проспектів — разом із велосмугою). */
export const halfWidthOf = (lanes: number) => lanes * CITY.laneWidth + (lanes > 1 ? CITY.bikeLane : 0);
export const halfAtX = (x: number) => halfWidthOf(lanesAtX(x));
export const halfAtZ = (z: number) => halfWidthOf(lanesAtZ(z));
/** Зсув осі смуги i (0 — найближча до осьової) від осі дороги. */
export const laneOff = (i: number) => CITY.laneOffset + i * CITY.laneWidth;
/** Зсув осі велосмуги проспекту від осі дороги. */
export const bikeOff = (lanes: number) => lanes * CITY.laneWidth + CITY.bikeLane / 2;
/** Чи точка на проїзній частині будь-якої дороги. */
export const onRoad = (x: number, z: number) =>
  CITY.roadsX.some((v) => Math.abs(v - x) <= halfAtX(v)) || CITY.roadsZ.some((v) => Math.abs(v - z) <= halfAtZ(v));

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
 * busStop — 5.41 «Пункт зупинки автобуса», bikePath — 4.12 «Доріжка для велосипедистів»,
 * children — 1.33 «Діти».
 */
export type SignKind =
  | 'giveWay'
  | 'stop'
  | 'mainRoad'
  | 'crosswalk'
  | 'yieldOncoming'
  | 'priorityOncoming'
  | 'roadworks'
  | 'busStop'
  | 'bikePath'
  | 'children';

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
  /** Половина ширини дороги під зеброю. */
  span: number;
}

/** Велодоріжка або велопереїзд: відрізок від a до b завширшки width. */
export interface BikePath {
  a: Vec2;
  b: Vec2;
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
  /** Велодоріжки ситуацій (на тротуарах і переїзди через дорогу). */
  bikePaths: BikePath[];
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
