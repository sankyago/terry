import { LANE_OFFSET, ROAD_HALF_WIDTH } from '../config';
import type { Circle, OBB } from './collision';
import type { Pose, Vec2 } from './math';
import { headingOf, rightOf } from './math';

export interface CenterPoint {
  x: number;
  z: number;
  s: number;
}

export type ObstacleKind = 'cone' | 'tree' | 'building' | 'barrier' | 'fence' | 'sign';

export type Obstacle =
  | { id: string; kind: ObstacleKind; label: string; shape: 'circle'; circle: Circle; height: number }
  | { id: string; kind: ObstacleKind; label: string; shape: 'box'; box: OBB; height: number };

export interface Track {
  centerline: CenterPoint[];
  length: number;
  halfWidth: number;
  start: Pose;
  startS: number;
  curve: { startS: number; endS: number; center: Vec2; radius: number };
  zone: OBB;
  zoneS: { start: number; end: number; center: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: Obstacle[];
}

export interface NearestResult {
  dist: number;
  s: number;
  lateral: number;
  heading: number;
}

/** Найближча точка на осьовій лінії дороги. lateral > 0 — праворуч за напрямком руху. */
export function nearestOnCenterline(line: CenterPoint[], p: Vec2): NearestResult {
  let best: NearestResult = { dist: Infinity, s: 0, lateral: 0, heading: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const ex = p.x - px;
    const ez = p.z - pz;
    const d = Math.hypot(ex, ez);
    if (d < best.dist) {
      const heading = headingOf(dx, dz);
      const r = rightOf(heading);
      best = { dist: d, s: a.s + (b.s - a.s) * t, lateral: ex * r.x + ez * r.z, heading };
    }
  }
  return best;
}

export function poseAt(line: CenterPoint[], s: number, lateral = 0): Pose {
  let i = 0;
  while (i < line.length - 2 && line[i + 1].s < s) i++;
  const a = line[i];
  const b = line[i + 1];
  const t = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s)));
  const heading = headingOf(b.x - a.x, b.z - a.z);
  const r = rightOf(heading);
  return {
    x: a.x + (b.x - a.x) * t + r.x * lateral,
    z: a.z + (b.z - a.z) * t + r.z * lateral,
    heading,
  };
}

/** Детермінований генератор псевдовипадкових чисел, щоб сцена завжди була однаковою. */
export function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCenterline(): { line: CenterPoint[]; curveStartS: number; curveEndS: number } {
  const pts: Vec2[] = [];
  for (let z = -10; z < 40; z += 1) pts.push({ x: 0, z });
  const R = 14;
  const cx = 14;
  const cz = 40;
  const n = 36;
  for (let i = 0; i < n; i++) {
    const phi = Math.PI - (Math.PI / 2) * (i / n);
    pts.push({ x: cx + R * Math.cos(phi), z: cz + R * Math.sin(phi) });
  }
  for (let x = 14; x <= 66; x += 1) pts.push({ x, z: 54 });

  const line: CenterPoint[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    line.push({ x: pts[i].x, z: pts[i].z, s });
  }
  return { line, curveStartS: 50, curveEndS: 50 + (Math.PI / 2) * R };
}

export function createTrack(): Track {
  const { line, curveStartS, curveEndS } = buildCenterline();
  const length = line[line.length - 1].s;
  const halfWidth = ROAD_HALF_WIDTH;
  const obstacles: Obstacle[] = [];

  const startS = 10;
  const start = poseAt(line, startS, LANE_OFFSET);

  // Зона зупинки — у правій смузі на останній прямій.
  const zoneCenterS = curveEndS + 30;
  const zoneHalfLength = 3.5;
  const zonePose = poseAt(line, zoneCenterS, LANE_OFFSET);
  const zone: OBB = { ...zonePose, halfLength: zoneHalfLength, halfWidth: 1.6 };

  let coneN = 0;
  const cone = (s: number, lateral: number) => {
    const p = poseAt(line, s, lateral);
    obstacles.push({
      id: `cone-${coneN++}`,
      kind: 'cone',
      label: 'конус',
      shape: 'circle',
      circle: { x: p.x, z: p.z, r: 0.22 },
      height: 0.6,
    });
  };
  // Конуси вздовж зони зупинки — на узбіччі, поза дорогою.
  for (let s = zoneCenterS - 6; s <= zoneCenterS + 6.01; s += 2.4) {
    cone(s, halfWidth + 0.75);
    cone(s, -(halfWidth + 0.75));
  }
  // Зовнішній край повороту.
  for (let i = 1; i < 6; i++) cone(curveStartS + ((curveEndS - curveStartS) * i) / 6, -(halfWidth + 0.8));
  // Біля старту.
  cone(startS - 4, halfWidth + 0.75);
  cone(startS + 4, halfWidth + 0.75);

  // Бетонний блок, що перекриває дорогу за зоною.
  const barrierPose = poseAt(line, zoneCenterS + 13, 0);
  obstacles.push({
    id: 'barrier',
    kind: 'barrier',
    label: 'бетонний блок',
    shape: 'box',
    box: { x: barrierPose.x, z: barrierPose.z, heading: barrierPose.heading, halfLength: 0.25, halfWidth: halfWidth + 0.4 },
    height: 0.8,
  });

  // Знак «P» біля зони.
  const signPose = poseAt(line, zoneCenterS, halfWidth + 1.9);
  obstacles.push({
    id: 'sign',
    kind: 'sign',
    label: 'дорожній знак',
    shape: 'circle',
    circle: { x: signPose.x, z: signPose.z, r: 0.08 },
    height: 2.3,
  });

  const bounds = { minX: -24, maxX: 74, minZ: -18, maxZ: 72 };
  const t = 0.3;
  const wall = (id: string, x: number, z: number, heading: number, halfLength: number) =>
    obstacles.push({
      id,
      kind: 'fence',
      label: 'огорожа майданчика',
      shape: 'box',
      box: { x, z, heading, halfLength, halfWidth: t / 2 },
      height: 1.0,
    });
  const cxm = (bounds.minX + bounds.maxX) / 2;
  const czm = (bounds.minZ + bounds.maxZ) / 2;
  const hx = (bounds.maxX - bounds.minX) / 2;
  const hz = (bounds.maxZ - bounds.minZ) / 2;
  wall('fence-s', cxm, bounds.minZ, Math.PI / 2, hx + t / 2);
  wall('fence-n', cxm, bounds.maxZ, Math.PI / 2, hx + t / 2);
  wall('fence-w', bounds.minX, czm, 0, hz + t / 2);
  wall('fence-e', bounds.maxX, czm, 0, hz + t / 2);

  const buildings: Array<[number, number, number, number, number, number]> = [
    // x, z, heading, halfLength(z), halfWidth(x), height
    [-14, 14, 0, 6, 4.5, 6],
    [-14, 38, 0, 4, 4, 9],
    [30, 26, 0, 5, 7, 5],
    [46, 65, Math.PI / 2, 3.5, 5, 7],
    [26, 64, Math.PI / 2, 3, 4, 4.5],
    [62, 30, 0.3, 4, 3.5, 6],
  ];
  buildings.forEach(([x, z, heading, hl, hw, h], i) =>
    obstacles.push({
      id: `building-${i}`,
      kind: 'building',
      label: 'будівля',
      shape: 'box',
      box: { x, z, heading, halfLength: hl, halfWidth: hw },
      height: h,
    }),
  );

  const rnd = seededRandom(7);
  let placed = 0;
  for (let attempt = 0; attempt < 600 && placed < 46; attempt++) {
    const x = bounds.minX + 3 + rnd() * (bounds.maxX - bounds.minX - 6);
    const z = bounds.minZ + 3 + rnd() * (bounds.maxZ - bounds.minZ - 6);
    const p = { x, z };
    if (nearestOnCenterline(line, p).dist < halfWidth + 4) continue;
    const tooClose = obstacles.some((o) => {
      const c = o.shape === 'circle' ? o.circle : o.box;
      const extent = o.shape === 'circle' ? o.circle.r : Math.max(o.box.halfLength, o.box.halfWidth);
      return Math.hypot(c.x - x, c.z - z) < extent + 2.6;
    });
    if (tooClose) continue;
    obstacles.push({
      id: `tree-${placed}`,
      kind: 'tree',
      label: 'дерево',
      shape: 'circle',
      circle: { x, z, r: 0.35 },
      height: 4 + rnd() * 2.5,
    });
    placed++;
  }

  return {
    centerline: line,
    length,
    halfWidth,
    start,
    startS,
    curve: { startS: curveStartS, endS: curveEndS, center: { x: 14, z: 40 }, radius: 14 },
    zone,
    zoneS: { start: zoneCenterS - zoneHalfLength, end: zoneCenterS + zoneHalfLength, center: zoneCenterS },
    bounds,
    obstacles,
  };
}
