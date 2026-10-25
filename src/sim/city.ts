import { CITY } from '../config';
import type { Vec2 } from './math';

export type LightColor = 'red' | 'redYellow' | 'yellow' | 'green';
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

/** Перехрестя зі світлофорами. Усі інші — нерегульовані. */
export const SIGNALS: SignalizedIntersection[] = [
  { id: 'A', x: 180, z: 180, initial: { ns: 'green', ew: 'red' } },
  { id: 'B', x: 90, z: 180, initial: { ns: 'green', ew: 'red' } },
  { id: 'C', x: 0, z: 180, initial: { ns: 'red', ew: 'green' } },
];

export type SignKind = 'giveWay' | 'mainRoad' | 'crosswalk';

/** Дорожній знак: стоїть у точці (x, z) і дивиться назустріч транспорту, що рухається з heading. */
export interface Sign {
  kind: SignKind;
  x: number;
  z: number;
  /** Напрямок руху транспорту, для якого призначений знак. */
  facing: number;
}

const E = Math.PI / 2;
const N = 0;
const S = Math.PI;
const W = -Math.PI / 2;
const edge = CITY.roadHalfWidth + 0.9;

export const SIGNS: Sign[] = [
  // Перехрестя (180, 90): Z=90 — другорядна, X=180 — головна.
  { kind: 'giveWay', x: 180 - edge - 3, z: 90 - edge, facing: E },
  { kind: 'giveWay', x: 180 + edge + 3, z: 90 + edge, facing: W },
  { kind: 'mainRoad', x: 180 + edge, z: 90 - edge - 3, facing: N },
  { kind: 'mainRoad', x: 180 - edge, z: 90 + edge + 3, facing: S },
  // Нерегульований пішохідний перехід на Z=90, x=62.
  { kind: 'crosswalk', x: 62 - 3, z: 90 - edge, facing: E },
  { kind: 'crosswalk', x: 62 + 3, z: 90 + edge, facing: W },
];

/** Зебра: center — центр, alongX — смуги переходу перпендикулярні осі X (дорога йде вздовж X). */
export interface Crosswalk {
  x: number;
  z: number;
  /** true — дорога вздовж осі X (перехід перетинає її з півдня на північ). */
  roadAlongX: boolean;
  width: number;
}

const crosswalks: Crosswalk[] = [{ x: 62, z: 90, roadAlongX: true, width: 4 }];
// На регульованих перехрестях — зебри на всіх чотирьох підходах.
for (const s of SIGNALS) {
  const d = CITY.roadHalfWidth + 2.2;
  crosswalks.push(
    { x: s.x - d, z: s.z, roadAlongX: true, width: 3 },
    { x: s.x + d, z: s.z, roadAlongX: true, width: 3 },
    { x: s.x, z: s.z - d, roadAlongX: false, width: 3 },
    { x: s.x, z: s.z + d, roadAlongX: false, width: 3 },
  );
}
export const CROSSWALKS = crosswalks;

/** Лінія «Дати дорогу» (зубці) перед головною дорогою. */
export const GIVE_WAY_LINES: Array<{ x: number; z: number; heading: number }> = [
  { x: 180 - CITY.roadHalfWidth - 0.6, z: 90 - CITY.laneOffset, heading: E },
  { x: 180 + CITY.roadHalfWidth + 0.6, z: 90 + CITY.laneOffset, heading: W },
];

/** Виїзд із двору: розрив у тротуарі й бордюрі. */
export const DRIVEWAYS: Array<{ x: number; z: number; width: number; alongZ: boolean }> = [
  { x: 20, z: 90 - CITY.roadHalfWidth - CITY.sidewalk / 2, width: 7, alongZ: true },
];

/** Двір зі стоянкою, з якого стартує учень. */
export const YARD = { minX: 8, maxX: 62, minZ: 28, maxZ: 83.5 };

export const isRoadX = (x: number) => CITY.roadsX.some((r) => Math.abs(r - x) <= CITY.roadHalfWidth);
export const isRoadZ = (z: number) => CITY.roadsZ.some((r) => Math.abs(r - z) <= CITY.roadHalfWidth);

/** Точка в правій смузі дороги для заданого напрямку руху. */
export function lane(heading: 'N' | 'S' | 'E' | 'W', along: number, road: number): Vec2 {
  const o = CITY.laneOffset;
  switch (heading) {
    case 'N':
      return { x: road + o, z: along };
    case 'S':
      return { x: road - o, z: along };
    case 'E':
      return { x: along, z: road - o };
    case 'W':
      return { x: along, z: road + o };
  }
}

export const MAP_BOUNDS = { minX: -90, maxX: 270, minZ: -90, maxZ: 270 };
