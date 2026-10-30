import { CITY } from '../config';
import type { Prop, Sign, SignKind } from '../sim/city';
import type { Corner } from '../sim/path';
import type { Vec2 } from '../sim/math';
import type { Arm, LocalCrosswalk, TicketOption, Turn } from './types';

// Допоміжні функції для шаблонів білетів у локальних координатах (учень їде з півдня в +Z).

export const O: number = CITY.laneOffset;
/** Звідки під'їжджають учасники до перехрестя і скільки їдуть після нього. */
export const FAR = 80;
export const EXIT = 35;
/** Радіуси поворотів на перехрестях. */
export const R_RIGHT = 4.5;
export const R_LEFT = 6;
/** Відстань від центру перехрестя до зебри на його рукаві. */
export const CW = CITY.roadHalfWidth + 2.2;
const HW: number = CITY.roadHalfWidth;

/** Варіанти відповіді; correct — індекс правильного. */
export const ask = (texts: string[], correct: number): TicketOption[] => texts.map((text, i) => ({ text, correct: i === correct }));

/** Стоп-лінії перед перехрестям: звичайна, перед поворотом праворуч і перед світлофором. */
export const STOP = { x: O, z: -4.4 };
export const STOP_RIGHT = { x: O, z: -6.3 };
export const STOP_SIGNAL = { x: O, z: -8 };

/** Сигнали для «зеленого щойно ввімкнувся»: поперечна дорога завершує фазу. */
export const GREEN_JUST_NOW = {
  initial: { along: 'red', cross: 'green' } as const,
  lights: [
    { t: -3, state: { cross: 'yellow' } as const },
    { t: -1.2, state: { cross: 'red', along: 'redYellow' } as const },
    { t: 0, state: { along: 'green' } as const },
  ],
};

export const H: Record<Arm, number> = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 };
const OPPOSITE: Record<Arm, Arm> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Рукав, на який виїжджає учень після маневру. */
export const exitArm = (turn: Turn): Arm => (turn === 'straight' ? 'N' : turn === 'right' ? 'E' : turn === 'left' ? 'W' : 'S');

/** Радіус дуг розвороту: найменший, з яким траєкторія ще плавна. */
export const R_UTURN = 4;

/**
 * Кути траєкторії розвороту на перехресті зі смуги x у зустрічну (−x) — «крапля»: трохи праворуч,
 * велика петля ліворуч навколо центру перехрестя і знову праворуч. Уся петля — в межах перехрестя
 * й рукавів, без заїзду на тротуари. Після розвороту учень їде на південь.
 */
export function uTurnCorners(x: number = O): Corner[] {
  const r = R_UTURN;
  // Кут бічних дуг: кінець петлі має припасти на смугу −x (центр петлі — на осі дороги).
  const phi = Math.acos((2 * r + 2 * x) / (4 * r));
  const turns = [phi, ...Array<number>(3).fill(-(Math.PI + 2 * phi) / 3), phi];
  const corners: Corner[] = [];
  let p = { x, z: -2 * r * Math.sin(phi) };
  let heading = 0;
  let back = 0;
  for (const a of turns) {
    const t = r * Math.tan(Math.abs(a) / 2);
    p = { x: p.x + Math.sin(heading) * (back + t), z: p.z + Math.cos(heading) * (back + t) };
    corners.push({ ...p, r });
    heading += a;
    back = t;
  }
  return corners;
}

/** Точка смуги, що веде до перехрестя з рукава arm, на відстані d від центру; off — зсув смуги від осі. */
function inLane(arm: Arm, d: number, off: number = O): Vec2 {
  switch (arm) {
    case 'S':
      return { x: off, z: -d };
    case 'N':
      return { x: -off, z: d };
    case 'E':
      return { x: d, z: off };
    case 'W':
      return { x: -d, z: -off };
  }
}

/** Точка смуги, що веде від перехрестя на рукав arm. */
function outLane(arm: Arm, d: number, off: number = O): Vec2 {
  switch (arm) {
    case 'N':
      return { x: off, z: d };
    case 'S':
      return { x: -off, z: -d };
    case 'E':
      return { x: d, z: -off };
    case 'W':
      return { x: -d, z: off };
  }
}

export interface DriveOpts {
  far?: number;
  exit?: number;
  r?: number;
  /** Зсув смуги від осі дороги до перехрестя і після нього (велосипедист біля краю, смуги проспекту). */
  offIn?: number;
  offOut?: number;
}

/** Траєкторія транспорту через перехрестя: з рукава from на рукав to. */
export function drive(from: Arm, to: Arm, opts: DriveOpts = {}): Corner[] {
  const a = inLane(from, opts.far ?? FAR, opts.offIn);
  const b = outLane(to, opts.exit ?? EXIT, opts.offOut ?? opts.offIn);
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

/**
 * Набори знаків і розмітки для типів перехресть. own — половина ширини дороги учня, cross — поперечної
 * (на перехрестях із проспектом вони різні).
 */
export function prioritySigns(egoSecondary: boolean, secondaryKind: 'giveWay' | 'stop', own: number = HW, cross: number = HW): Sign[] {
  const ownKind: SignKind = egoSecondary ? secondaryKind : 'mainRoad';
  const crossKind: SignKind = egoSecondary ? 'mainRoad' : secondaryKind;
  return [
    { kind: ownKind, x: own + 0.9, z: -(cross + 3.9), facing: H.N },
    { kind: ownKind, x: -(own + 0.9), z: cross + 3.9, facing: H.S },
    { kind: crossKind, x: own + 3.9, z: cross + 0.9, facing: H.W },
    { kind: crossKind, x: -(own + 3.9), z: -(cross + 0.9), facing: H.E },
  ];
}

export function priorityLines(egoSecondary: boolean, kind: 'giveWay' | 'stop', own: number = HW, cross: number = HW) {
  return egoSecondary
    ? [
        { kind, x: O, z: -(cross + 0.6), heading: H.N },
        { kind, x: -O, z: cross + 0.6, heading: H.S },
      ]
    : [
        { kind, x: own + 0.6, z: O, heading: H.W },
        { kind, x: -(own + 0.6), z: -O, heading: H.E },
      ];
}

/** Зебри на всіх чотирьох рукавах перехрестя. */
export const nodeCrosswalks = (own: number = HW, cross: number = HW): LocalCrosswalk[] => [
  { x: 0, z: -(cross + 2.2), acrossEgoRoad: true },
  { x: 0, z: cross + 2.2, acrossEgoRoad: true },
  { x: own + 2.2, z: 0, acrossEgoRoad: false },
  { x: -(own + 2.2), z: 0, acrossEgoRoad: false },
];
export const NODE_CROSSWALKS = nodeCrosswalks();

/** Зебра посеред кварталу зі знаками 5.35 з обох боків; half — половина ширини дороги. */
export function blockCrosswalk(z = 0, half: number = HW): { crosswalks: LocalCrosswalk[]; signs: Sign[] } {
  return {
    crosswalks: [{ x: 0, z, acrossEgoRoad: true, width: 4 }],
    signs: [
      { kind: 'crosswalk', x: half + 0.9, z: z - 3, facing: H.N },
      { kind: 'crosswalk', x: -(half + 0.9), z: z + 3, facing: H.S },
    ],
  };
}

/** Вісь велодоріжки на тротуарі звичайної вулиці (праворуч від учня). */
export const BIKE = HW + 2.05;
/** Велосипедист на проїзній частині тримається правого краю: зсув від осі дороги. */
export const EDGE_BIKE = 2.6;

/** Смуги проспекту: зсув осі смуги i від осьової й осі велосмуги. */
export const lane = (i: number) => O + i * CITY.laneWidth;
export const bikeLane = (lanes: number) => lanes * CITY.laneWidth + CITY.bikeLane / 2;
export const avenueHalf = (lanes: number) => lanes * CITY.laneWidth + CITY.bikeLane;

export const prop = (kind: Prop['kind'], x: number, z: number, heading = 0): Prop => ({ kind, x, z, heading });
