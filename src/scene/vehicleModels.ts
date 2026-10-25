import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CAR } from '../config';
import { KINDS } from '../sim/kinds';
import type { FlatGeometry, Section, Station } from './geometry';
import { grow, mapSections, sectionAt, slice, topAt } from './geometry';

/** Моделі легковиків: купе — авто учня (Audi A5), решта — для різноманіття на дорозі. */
export type CarModel = 'coupe' | 'sedan' | 'hatch' | 'wagon' | 'suv' | 'van';
export const TRAFFIC_MODELS: CarModel[] = ['sedan', 'hatch', 'wagon', 'suv', 'van'];

/** Стабільний вибір моделі: сусідні ситуації отримують різні машини, а повтор ситуації — ту саму. */
export function pickCarModel(ticket: number, specId: string): CarModel {
  let h = 0;
  for (let i = 0; i < specId.length; i++) h = (h * 31 + specId.charCodeAt(i)) % 9973;
  return TRAFFIC_MODELS[(ticket + h) % TRAFFIC_MODELS.length];
}

export interface VehicleParts {
  paint: StandardMaterial;
  glass: StandardMaterial;
  trim: StandardMaterial;
  chrome: StandardMaterial;
  plate: StandardMaterial;
  head: StandardMaterial;
  tail: StandardMaterial;
  indL: StandardMaterial;
  indR: StandardMaterial;
  /** Червоні смуги швидкої. */
  accent: StandardMaterial;
  /** Світлий дах автобуса. */
  roof: StandardMaterial;
  /** Табло маршруту автобуса. */
  sign: StandardMaterial;
  beaconA: StandardMaterial;
  beaconB: StandardMaterial;
}

export interface WheelLayout {
  /** z осей (перша — передня, керована). */
  axles: number[];
  radius: number;
  width: number;
  /** x центру колеса. */
  track: number;
}

type Geo = (mat: StandardMaterial) => FlatGeometry;

interface CarShape {
  length: number;
  width: number;
  /** Нижня кромка кузова. */
  sill: number;
  nose: { y0: number; y1: number; hw: number };
  tail: { y0: number; y1: number; hw: number };
  hoodFront: number;
  /** Висота капота біля лобового скла. */
  hood: number;
  /** Лінія вікон. */
  belt: number;
  /** Задній край кришки багажника / верх дверей багажника. */
  trunk: number;
  roof: number;
  /** z: основа лобового скла, передній і задній край даху, основа заднього скла. */
  zWs: number;
  zRoofF: number;
  zRoofR: number;
  zRear: number;
  /** Звуження даху відносно скла внизу (завал боковин). */
  tumble: number;
  /** Пофарбовані стійки/панелі поверх скла: [z від, z до]. */
  pillars: Array<[number, number]>;
  wheelRadius: number;
  grille: 'audi' | 'slim' | 'wide';
  taillights: 'bar' | 'tall';
  rails?: boolean;
  cladding?: boolean;
}

const car = KINDS.car;
const SHAPES: Record<CarModel, CarShape> = {
  // Audi A5 Coupé: довгий капот, низький дах, пологе заднє скло, без центральної стійки.
  coupe: {
    length: CAR.length,
    width: CAR.width,
    sill: 0.27,
    nose: { y0: 0.27, y1: 0.66, hw: 0.78 },
    tail: { y0: 0.32, y1: 0.86, hw: 0.8 },
    hoodFront: 0.77,
    hood: 0.9,
    belt: 0.93,
    trunk: 0.97,
    roof: CAR.height,
    zWs: 0.78,
    zRoofF: 0.08,
    zRoofR: -0.86,
    zRear: -1.62,
    tumble: 0.17,
    pillars: [[-1.62, -1.05]],
    wheelRadius: CAR.wheelRadius,
    grille: 'audi',
    taillights: 'bar',
  },
  // Седан — класичні «три об'єми».
  sedan: {
    length: car.length,
    width: car.width,
    sill: 0.3,
    nose: { y0: 0.3, y1: 0.68, hw: 0.74 },
    tail: { y0: 0.34, y1: 0.88, hw: 0.76 },
    hoodFront: 0.8,
    hood: 0.94,
    belt: 0.98,
    trunk: 1.0,
    roof: 1.46,
    zWs: 0.95,
    zRoofF: 0.3,
    zRoofR: -0.95,
    zRear: -1.5,
    tumble: 0.15,
    pillars: [[-0.3, -0.2]],
    wheelRadius: 0.32,
    grille: 'slim',
    taillights: 'bar',
  },
  // Хетчбек — короткий, з крутою п'ятою дверцятою.
  hatch: {
    length: 4.25,
    width: 1.79,
    sill: 0.3,
    nose: { y0: 0.3, y1: 0.68, hw: 0.74 },
    tail: { y0: 0.36, y1: 1.0, hw: 0.78 },
    hoodFront: 0.8,
    hood: 0.94,
    belt: 0.99,
    trunk: 1.02,
    roof: 1.47,
    zWs: 0.85,
    zRoofF: 0.25,
    zRoofR: -1.62,
    zRear: -1.9,
    tumble: 0.15,
    pillars: [
      [-0.42, -0.32],
      [-1.86, -1.42],
    ],
    wheelRadius: 0.31,
    grille: 'slim',
    taillights: 'tall',
  },
  // Універсал — довгий дах до самої корми, рейлінги.
  wagon: {
    length: car.length,
    width: car.width,
    sill: 0.3,
    nose: { y0: 0.3, y1: 0.68, hw: 0.74 },
    tail: { y0: 0.36, y1: 1.0, hw: 0.78 },
    hoodFront: 0.8,
    hood: 0.94,
    belt: 0.98,
    trunk: 1.0,
    roof: 1.47,
    zWs: 0.95,
    zRoofF: 0.3,
    zRoofR: -1.84,
    zRear: -2.02,
    tumble: 0.14,
    pillars: [
      [-0.3, -0.2],
      [-1.28, -1.16],
      [-2.02, -1.78],
    ],
    wheelRadius: 0.32,
    grille: 'slim',
    taillights: 'tall',
    rails: true,
  },
  // Кросовер — високий кліренс, чорні накладки, рейлінги.
  suv: {
    length: car.length,
    width: car.width,
    sill: 0.44,
    nose: { y0: 0.42, y1: 0.88, hw: 0.76 },
    tail: { y0: 0.46, y1: 1.1, hw: 0.78 },
    hoodFront: 1.0,
    hood: 1.1,
    belt: 1.14,
    trunk: 1.15,
    roof: 1.7,
    zWs: 0.9,
    zRoofF: 0.28,
    zRoofR: -1.72,
    zRear: -1.95,
    tumble: 0.13,
    pillars: [
      [-0.36, -0.24],
      [-1.95, -1.5],
    ],
    wheelRadius: 0.36,
    grille: 'wide',
    taillights: 'tall',
    rails: true,
    cladding: true,
  },
  // Компактвен / фургон: короткий капот, вертикальна корма, глухі бокові панелі вантажного відсіку.
  van: {
    length: 4.45,
    width: car.width,
    sill: 0.36,
    nose: { y0: 0.36, y1: 0.84, hw: 0.76 },
    tail: { y0: 0.4, y1: 1.12, hw: 0.84 },
    hoodFront: 0.94,
    hood: 1.06,
    belt: 1.1,
    trunk: 1.12,
    roof: 1.84,
    zWs: 1.2,
    zRoofF: 0.55,
    zRoofR: -2.06,
    zRear: -2.12,
    tumble: 0.06,
    pillars: [[-2.12, -0.42]],
    wheelRadius: 0.32,
    grille: 'wide',
    taillights: 'tall',
  },
};

/** Переріз нижньої частини кузова: днище, найширше місце, плече, верх. */
const bodySection = (hw: number, y0: number, y1: number): Section => [
  [hw - 0.1, y0],
  [hw, y0 + (y1 - y0) * 0.42],
  [hw - 0.015, y1 - Math.min(0.1, (y1 - y0) * 0.25)],
  [hw - 0.09, y1],
];

/** Кузов легковика. Повертає розташування коліс. */
export function buildCar(model: CarModel, geo: Geo, p: VehicleParts): WheelLayout {
  const s = SHAPES[model];
  const hl = s.length / 2;
  const hw = s.width / 2;
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;

  // ---- Нижня частина: від заднього бампера до переднього ----
  const body: Station[] = [
    { z: -hl, s: bodySection(s.tail.hw, s.tail.y0, s.tail.y1) },
    { z: -hl + 0.07, s: bodySection(mix(s.tail.hw, hw, 0.75), mix(s.tail.y0, s.sill, 0.7), mix(s.tail.y1, s.trunk, 0.6)) },
    { z: -hl + 0.2, s: bodySection(hw, s.sill, s.trunk) },
    { z: s.zRear, s: bodySection(hw, s.sill, s.belt) },
    { z: s.zWs, s: bodySection(hw, s.sill, s.hood) },
    { z: hl - 0.38, s: bodySection(hw - 0.01, s.sill, s.hoodFront) },
    { z: hl - 0.09, s: bodySection(mix(s.nose.hw, hw, 0.7), mix(s.nose.y0, s.sill, 0.6), mix(s.nose.y1, s.hoodFront, 0.65)) },
    { z: hl, s: bodySection(s.nose.hw, s.nose.y0, s.nose.y1) },
  ];
  geo(p.paint).loft(body);
  if (s.cladding) geo(p.trim).loft(mapSections(body, (sec) => grow(0.012, -0.01)([sec[0], sec[1]])));

  // ---- Скляний «тепличний» верх ----
  const gw = hw - 0.12;
  const rw = gw - s.tumble;
  const flat = (y: number): Section => [
    [gw, y],
    [gw, y],
  ];
  const full = (y: number): Section => [
    [gw, y],
    [rw, s.roof],
  ];
  const cabin: Station[] = [
    { z: s.zRear, s: flat(s.belt - 0.03) },
    { z: s.zRoofR, s: full(s.belt - 0.03) },
    { z: s.zRoofF, s: full(s.hood - 0.03) },
    { z: s.zWs, s: flat(s.hood - 0.03) },
  ];
  // Плавніший перехід заднього скла: проміжна станція трохи вище за пряму.
  const rearMid = (s.zRear + s.zRoofR) / 2;
  if (s.zRoofR - s.zRear > 0.4) {
    const t = 0.62;
    cabin.splice(1, 0, { z: rearMid, s: [[gw, s.belt - 0.03], [mix(gw, rw, t), mix(s.belt, s.roof, t)]] });
  }
  geo(p.glass).loft(cabin);
  // Дах фарбований, скло лишається смугою вікон.
  const roofSec = (inset: number): Section => [
    [rw + 0.012 - inset, s.roof - 0.06],
    [rw - 0.03 - inset, s.roof + 0.012],
  ];
  geo(p.paint).loft([
    { z: s.zRoofR - 0.01, s: roofSec(0.04) },
    { z: s.zRoofR + 0.08, s: roofSec(0) },
    { z: s.zRoofF - 0.06, s: roofSec(0) },
    { z: s.zRoofF + 0.01, s: roofSec(0.04) },
  ]);
  for (const [za, zb] of s.pillars) geo(p.paint).loft(mapSections(slice(cabin, za, zb), grow(0.01)), { sidesOnly: true });

  // ---- Світло, решітка, номери ----
  const g = (m: StandardMaterial) => geo(m);
  const ny = (t: number) => mix(s.nose.y0, s.nose.y1, t);
  const ty = (t: number) => mix(s.tail.y0, s.tail.y1, t);
  const lampX = s.nose.hw - 0.29;
  if (s.grille === 'audi') {
    // Великий шестикутний «single frame» з хромованою рамкою і світлодіодні фари.
    g(p.chrome).box(0, ny(0.48), hl - 0.02, 0.74, (s.nose.y1 - s.nose.y0) * 0.86, 0.05);
    g(p.trim).box(0, ny(0.48), hl - 0.01, 0.66, (s.nose.y1 - s.nose.y0) * 0.76, 0.05);
    for (const sx of [-1, 1]) g(p.trim).box(sx * (s.nose.hw - 0.22), ny(0.24), hl - 0.03, 0.2, 0.12, 0.06);
  } else {
    const gwid = s.grille === 'wide' ? 0.92 : 0.72;
    g(p.trim).box(0, ny(0.72), hl - 0.02, gwid, s.grille === 'wide' ? 0.2 : 0.13, 0.06);
    if (s.grille === 'wide') g(p.chrome).box(0, ny(0.72), hl + 0.005, gwid * 0.9, 0.03, 0.03);
    g(p.trim).box(0, ny(0.25), hl - 0.03, 0.96, 0.12, 0.06);
  }
  // Фари — пласкі смуги в передній панелі, у темних корпусах.
  for (const sx of [-1, 1]) {
    g(p.trim).box(sx * lampX, ny(0.78), hl - 0.05, 0.36, 0.13, 0.1);
    g(p.head).box(sx * lampX, ny(0.78), hl - 0.04, 0.32, s.grille === 'audi' ? 0.07 : 0.09, 0.1);
  }
  g(p.plate).box(0, ny(s.grille === 'audi' ? 0.22 : 0.45), hl + 0.01, 0.52, 0.11, 0.03);
  // Задні ліхтарі: горизонтальні («bar») або вертикальні по кутах корми.
  const tailFaceZ = -hl + 0.035;
  if (s.taillights === 'bar') {
    for (const sx of [-1, 1]) {
      g(p.tail).box(sx * (s.tail.hw - 0.24), ty(0.84), tailFaceZ, 0.4, 0.12, 0.1);
    }
  } else {
    for (const sx of [-1, 1]) g(p.tail).box(sx * (s.tail.hw - 0.14), ty(0.76), tailFaceZ, 0.2, (s.tail.y1 - s.tail.y0) * 0.34, 0.1);
  }
  g(p.plate).box(0, ty(0.45), -hl - 0.005, 0.52, 0.11, 0.03);
  g(p.trim).box(0, ty(0.12), -hl + 0.04, s.tail.hw * 1.6, 0.1, 0.1);
  if (model === 'coupe') {
    // Дві овальні вихлопні труби й «плавник» антени.
    for (const sx of [-1, 1]) g(p.trim).box(sx * 0.5, ty(0.1), -hl - 0.01, 0.16, 0.07, 0.12);
    g(p.trim).box(0, s.roof + 0.03, s.zRoofR + 0.16, 0.06, 0.07, 0.2);
  }
  // Покажчики повороту: передні кути, бокові повторювачі (видно згори), задні — поряд з ліхтарями.
  for (const sx of [-1, 1]) {
    const ind = sx < 0 ? p.indL : p.indR;
    g(ind).box(sx * (s.nose.hw - 0.06), ny(0.78), hl - 0.045, 0.1, 0.09, 0.1);
    g(ind).box(sx * (hw - 0.01), topAt(body, hl - 0.85) - 0.06, hl - 0.85, 0.05, 0.05, 0.2);
    g(ind).box(sx * (s.tail.hw - 0.1), ty(s.taillights === 'bar' ? 0.84 : 0.54), tailFaceZ - 0.005, 0.1, 0.09, 0.1);
  }

  // ---- Дзеркала, рейлінги ----
  const my = sectionAt(body, s.zWs - 0.12);
  for (const sx of [-1, 1]) {
    const x = sx * (my[3][0] + 0.07);
    g(p.paint).box(x, s.hood + 0.08, s.zWs - 0.18, 0.18, 0.11, 0.12);
    g(p.trim).box(sx * (my[3][0] - 0.02), s.hood + 0.05, s.zWs - 0.16, 0.08, 0.04, 0.08);
  }
  if (s.rails)
    for (const sx of [-1, 1]) g(p.trim).box(sx * (rw - 0.04), s.roof + 0.045, (s.zRoofR + s.zRoofF) / 2, 0.05, 0.05, s.zRoofF - s.zRoofR - 0.2);

  return {
    axles: model === 'hatch' ? [1.3, -1.25] : model === 'coupe' ? [CAR.wheelbase / 2 + 0.06, -CAR.wheelbase / 2 + 0.06] : [1.38, -1.35],
    radius: s.wheelRadius,
    width: model === 'suv' ? 0.26 : CAR.wheelWidth,
    track: hw - 0.14,
  };
}

/** Швидка: фургон із високим дахом (на кшталт Sprinter). */
export function buildAmbulance(geo: Geo, p: VehicleParts): WheelLayout {
  const L = KINDS.ambulance.length;
  const W = KINDS.ambulance.width;
  const hl = L / 2;
  const hw = W / 2;
  const sill = 0.42;
  const belt = 1.22;
  const lower: Station[] = [
    { z: -hl, s: bodySection(hw - 0.03, sill, belt) },
    { z: hl - 1.0, s: bodySection(hw, sill, belt) },
    { z: hl - 0.4, s: bodySection(hw - 0.02, sill, 1.08) },
    { z: hl - 0.08, s: bodySection(hw - 0.12, 0.46, 0.98) },
    { z: hl, s: bodySection(hw - 0.2, 0.48, 0.9) },
  ];
  geo(p.paint).loft(lower);
  geo(p.trim).loft(mapSections(lower, (sec) => grow(0.012, -0.01)([sec[0], sec[1]])));
  const box = (w: number, y: number): Section => [
    [w, belt - 0.02],
    [w, Math.max(belt, y - 0.1)],
    [w - 0.08, y],
  ];
  const top = 2.52;
  const upper: Station[] = [
    { z: -hl + 0.02, s: box(hw - 0.04, top) },
    { z: hl - 1.78, s: box(hw - 0.04, top) },
    { z: hl - 1.62, s: box(hw - 0.06, top - 0.12) },
    { z: hl - 0.98, s: box(hw - 0.08, belt + 0.02) },
  ];
  geo(p.paint).loft(upper);
  // Лобове скло й бокові вікна кабіни.
  const ya = topAt(upper, hl - 1.58);
  const yb = topAt(upper, hl - 1.04);
  geo(p.glass).box(0, (ya + yb) / 2 + 0.005, hl - 1.31, W - 0.3, 0.04, Math.hypot(0.54, ya - yb), 0, Math.atan2(yb - ya, 0.54));
  for (const sx of [-1, 1]) {
    geo(p.glass).box(sx * (hw - 0.035), 1.72, hl - 1.5, 0.02, 0.62, 0.55);
    // Червона смуга вздовж кузова, хрест на боках і на даху.
    geo(p.accent).box(sx * (hw + 0.004), 1.0, -0.45, 0.02, 0.2, L - 1.5);
    geo(p.accent).box(sx * (hw - 0.03), 1.78, -0.9, 0.02, 0.5, 0.15);
    geo(p.accent).box(sx * (hw - 0.03), 1.78, -0.9, 0.02, 0.15, 0.5);
  }
  geo(p.accent).box(0, top + 0.01, -0.7, 0.9, 0.02, 0.28);
  geo(p.accent).box(0, top + 0.01, -0.7, 0.28, 0.02, 0.9);
  geo(p.accent).box(0, 1.0, -hl - 0.005, W - 0.4, 0.2, 0.02);
  // Задні двері: шов і вікна.
  geo(p.trim).box(0, 1.6, -hl - 0.004, 0.03, 1.6, 0.02);
  for (const sx of [-1, 1]) geo(p.glass).box(sx * 0.42, 2.0, -hl - 0.004, 0.6, 0.5, 0.02);
  // Маячки: дві сині секції над кабіною, третя — ззаду.
  geo(p.trim).box(0, top + 0.03, hl - 1.85, 1.4, 0.05, 0.3);
  geo(p.beaconA).box(-0.38, top + 0.13, hl - 1.85, 0.56, 0.16, 0.26);
  geo(p.beaconB).box(0.38, top + 0.13, hl - 1.85, 0.56, 0.16, 0.26);
  geo(p.beaconB).box(0, top + 0.08, -hl + 0.25, 0.6, 0.12, 0.12);
  // Перед: решітка, фари, номер.
  geo(p.trim).box(0, 0.78, hl - 0.03, 0.85, 0.22, 0.08);
  geo(p.plate).box(0, 0.58, hl + 0.005, 0.52, 0.11, 0.03);
  for (const sx of [-1, 1]) {
    const ind = sx < 0 ? p.indL : p.indR;
    geo(p.head).box(sx * (hw - 0.4), 0.92, hl - 0.15, 0.36, 0.12, 0.22);
    geo(ind).box(sx * (hw - 0.2), 0.92, hl - 0.18, 0.12, 0.11, 0.2);
    geo(p.tail).box(sx * (hw - 0.12), 0.85, -hl - 0.002, 0.18, 0.5, 0.04);
    geo(ind).box(sx * (hw - 0.12), 1.18, -hl - 0.004, 0.18, 0.12, 0.04);
    geo(p.paint).box(sx * (hw + 0.1), 1.62, hl - 1.15, 0.12, 0.3, 0.1);
  }
  return { axles: [1.8, -1.8], radius: 0.36, width: 0.24, track: hw - 0.16 };
}

/** Міський автобус: заокруглені кути, смуга вікон, двері праворуч, кондиціонер на даху. */
export function buildBus(geo: Geo, p: VehicleParts, axles: number[]): WheelLayout {
  const L = KINDS.bus.length;
  const W = KINDS.bus.width;
  const hl = L / 2;
  const hw = W / 2;
  const H = 3.1;
  const sec = (w: number, y0: number, y1: number): Section => [
    [w - 0.05, y0],
    [w, y0 + 0.4],
    [w, y1 - 0.18],
    [w - 0.14, y1],
  ];
  const body: Station[] = [
    { z: -hl, s: sec(hw - 0.12, 0.34, H - 0.06) },
    { z: -hl + 0.22, s: sec(hw, 0.3, H) },
    { z: hl - 0.25, s: sec(hw, 0.3, H) },
    { z: hl, s: sec(hw - 0.12, 0.34, H - 0.1) },
  ];
  geo(p.paint).loft(body);
  geo(p.trim).loft(mapSections(body, (s) => grow(0.012, -0.01)([s[0], s[1]])));
  geo(p.roof).box(0, H + 0.005, 0, W - 0.32, 0.03, L - 0.6);
  // Кондиціонер і люки на даху.
  geo(p.roof).box(0, H + 0.17, -hl + 3.2, 1.6, 0.3, 2.4);
  geo(p.trim).box(0, H + 0.33, -hl + 3.2, 1.2, 0.03, 1.8);
  for (const z of [1.2, 3.6]) geo(p.trim).box(0, H + 0.04, z, 0.8, 0.06, 0.8);
  // Смуга вікон і стійки між ними.
  const wy0 = 1.2;
  const wy1 = 2.75;
  for (const sx of [-1, 1]) {
    geo(p.glass).box(sx * (hw + 0.004), (wy0 + wy1) / 2, -0.3, 0.02, wy1 - wy0, L - 2.2);
    for (let z = -hl + 1.4; z < hl - 1.6; z += 1.55) geo(p.paint).box(sx * (hw + 0.01), (wy0 + wy1) / 2, z, 0.02, wy1 - wy0 + 0.02, 0.12);
  }
  // Двері праворуч (+X): передні, середні, задні.
  for (const [z0, z1] of [
    [hl - 1.75, hl - 0.6],
    [-0.1, 1.2],
    [-hl + 1.6, -hl + 2.8],
  ]) {
    geo(p.trim).box(hw + 0.008, 1.5, (z0 + z1) / 2, 0.02, 2.5, z1 - z0 + 0.1);
    geo(p.glass).box(hw + 0.014, 1.55, (z0 + z1) / 2, 0.02, 2.2, z1 - z0 - 0.2);
    geo(p.trim).box(hw + 0.02, 1.55, (z0 + z1) / 2, 0.02, 2.2, 0.04);
  }
  // Лобове скло (злегка нахилене), табло маршруту, заднє скло.
  geo(p.glass).box(0, 1.85, hl + 0.005, W - 0.36, 1.7, 0.04, 0, -0.06);
  geo(p.sign).box(0, 2.84, hl + 0.01, W - 0.6, 0.24, 0.08);
  geo(p.glass).box(0, 2.3, -hl - 0.005, W - 0.6, 0.9, 0.04);
  for (const sx of [-1, 1]) {
    const ind = sx < 0 ? p.indL : p.indR;
    geo(p.head).box(sx * (hw - 0.32), 0.62, hl + 0.005, 0.34, 0.14, 0.04);
    geo(ind).box(sx * (hw - 0.12), 0.62, hl + 0.01, 0.16, 0.14, 0.04);
    geo(p.tail).box(sx * (hw - 0.2), 0.95, -hl - 0.005, 0.2, 0.42, 0.04);
    geo(ind).box(sx * (hw - 0.2), 1.25, -hl - 0.008, 0.2, 0.14, 0.04);
    geo(ind).box(sx * (hw + 0.01), 0.75, hl - 0.6, 0.03, 0.08, 0.22);
    // Дзеркала на кронштейнах.
    geo(p.trim).box(sx * (hw + 0.2), 2.3, hl + 0.15, 0.06, 0.4, 0.06);
  }
  geo(p.plate).box(0, 0.5, hl + 0.01, 0.52, 0.11, 0.03);
  return { axles, radius: 0.5, width: 0.32, track: hw - 0.2 };
}
