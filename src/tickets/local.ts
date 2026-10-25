import { CITY } from '../config';
import type { Prop, Sign, SignKind } from '../sim/city';
import type { Corner } from '../sim/path';
import type { Vec2 } from '../sim/math';
import type { Arm, LocalCrosswalk, Turn } from './types';

// Допоміжні функції для шаблонів білетів у локальних координатах (учень їде з півдня в +Z).

export const O = CITY.laneOffset;
/** Звідки під'їжджають учасники до перехрестя і скільки їдуть після нього. */
export const FAR = 80;
export const EXIT = 35;
/** Радіуси поворотів на перехрестях. */
export const R_RIGHT = 4.5;
export const R_LEFT = 6;
/** Відстань від центру перехрестя до зебри на його рукаві. */
export const CW = CITY.roadHalfWidth + 2.2;
/** Знаки: зсув від осі дороги до узбіччя й від краю перехрестя. */
const EDGE = CITY.roadHalfWidth + 0.9;
const BACK = EDGE + 3;

export const H: Record<Arm, number> = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 };
const OPPOSITE: Record<Arm, Arm> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Рукав, на який виїжджає учень після маневру. */
export const exitArm = (turn: Turn): Arm => (turn === 'straight' ? 'N' : turn === 'right' ? 'E' : 'W');

/** Точка смуги, що веде до перехрестя з рукава arm, на відстані d від центру. */
function inLane(arm: Arm, d: number): Vec2 {
  switch (arm) {
    case 'S':
      return { x: O, z: -d };
    case 'N':
      return { x: -O, z: d };
    case 'E':
      return { x: d, z: O };
    case 'W':
      return { x: -d, z: -O };
  }
}

/** Точка смуги, що веде від перехрестя на рукав arm. */
function outLane(arm: Arm, d: number): Vec2 {
  switch (arm) {
    case 'N':
      return { x: O, z: d };
    case 'S':
      return { x: -O, z: -d };
    case 'E':
      return { x: d, z: -O };
    case 'W':
      return { x: -d, z: O };
  }
}

/** Траєкторія транспорту через перехрестя: з рукава from на рукав to. */
export function drive(from: Arm, to: Arm, opts: { far?: number; exit?: number; r?: number } = {}): Corner[] {
  const a = inLane(from, opts.far ?? FAR);
  const b = outLane(to, opts.exit ?? EXIT);
  if (OPPOSITE[from] === to) return [a, b];
  const vertical = from === 'N' || from === 'S';
  const corner = vertical ? { x: a.x, z: b.z } : { x: b.x, z: a.z };
  // Напрямок руху з рукава from протилежний до напрямку «на рукав from».
  const turn = Math.sin(H[to] - (H[from] + Math.PI));
  const r = opts.r ?? (turn > 0 ? R_RIGHT : R_LEFT);
  return [a, { ...corner, r }, b];
}

/** Траєкторія пішохода: ламана з плавними кутами. */
export const walk = (...pts: Array<[number, number]>): Corner[] =>
  pts.map(([x, z], i) => (i === 0 || i === pts.length - 1 ? { x, z } : { x, z, r: 0.8 }));

/** Набори знаків і розмітки для типів перехресть. */
export function prioritySigns(egoSecondary: boolean, secondaryKind: 'giveWay' | 'stop'): Sign[] {
  const own: SignKind = egoSecondary ? secondaryKind : 'mainRoad';
  const cross: SignKind = egoSecondary ? 'mainRoad' : secondaryKind;
  return [
    { kind: own, x: EDGE, z: -BACK, facing: H.N },
    { kind: own, x: -EDGE, z: BACK, facing: H.S },
    { kind: cross, x: BACK, z: EDGE, facing: H.W },
    { kind: cross, x: -BACK, z: -EDGE, facing: H.E },
  ];
}

export function priorityLines(egoSecondary: boolean, kind: 'giveWay' | 'stop') {
  const d = CITY.roadHalfWidth + 0.6;
  return egoSecondary
    ? [
        { kind, x: O, z: -d, heading: H.N },
        { kind, x: -O, z: d, heading: H.S },
      ]
    : [
        { kind, x: d, z: O, heading: H.W },
        { kind, x: -d, z: -O, heading: H.E },
      ];
}

/** Зебри на всіх чотирьох рукавах перехрестя. */
export const NODE_CROSSWALKS: LocalCrosswalk[] = [
  { x: 0, z: -CW, acrossEgoRoad: true },
  { x: 0, z: CW, acrossEgoRoad: true },
  { x: CW, z: 0, acrossEgoRoad: false },
  { x: -CW, z: 0, acrossEgoRoad: false },
];

/** Зебра посеред кварталу зі знаками 5.35 з обох боків. */
export function blockCrosswalk(z = 0): { crosswalks: LocalCrosswalk[]; signs: Sign[] } {
  return {
    crosswalks: [{ x: 0, z, acrossEgoRoad: true, width: 4 }],
    signs: [
      { kind: 'crosswalk', x: EDGE, z: z - 3, facing: H.N },
      { kind: 'crosswalk', x: -EDGE, z: z + 3, facing: H.S },
    ],
  };
}

export const prop = (kind: Prop['kind'], x: number, z: number, heading = 0): Prop => ({ kind, x, z, heading });
