import type { Vec2 } from './math';
import { forwardOf, rightOf } from './math';

/** Орієнтований прямокутник: halfLength — уздовж heading, halfWidth — поперек. */
export interface OBB {
  x: number;
  z: number;
  heading: number;
  halfLength: number;
  halfWidth: number;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Вектор виштовхування для першого об'єкта (нормаль від перешкоди до авто). */
export interface Contact {
  nx: number;
  nz: number;
  depth: number;
}

export function obbCorners(o: OBB): Vec2[] {
  const f = forwardOf(o.heading);
  const r = rightOf(o.heading);
  const fl = o.halfLength;
  const hw = o.halfWidth;
  return [
    { x: o.x + f.x * fl - r.x * hw, z: o.z + f.z * fl - r.z * hw },
    { x: o.x + f.x * fl + r.x * hw, z: o.z + f.z * fl + r.z * hw },
    { x: o.x - f.x * fl + r.x * hw, z: o.z - f.z * fl + r.z * hw },
    { x: o.x - f.x * fl - r.x * hw, z: o.z - f.z * fl - r.z * hw },
  ];
}

/** Координати точки в локальній системі прямокутника (along, across). */
export function toLocal(o: OBB, p: Vec2): { along: number; across: number } {
  const dx = p.x - o.x;
  const dz = p.z - o.z;
  const f = forwardOf(o.heading);
  const r = rightOf(o.heading);
  return { along: dx * f.x + dz * f.z, across: dx * r.x + dz * r.z };
}

export function pointInObb(o: OBB, p: Vec2, margin = 0): boolean {
  const l = toLocal(o, p);
  return Math.abs(l.along) <= o.halfLength - margin && Math.abs(l.across) <= o.halfWidth - margin;
}

export function obbInsideObb(inner: OBB, outer: OBB): boolean {
  return obbCorners(inner).every((c) => pointInObb(outer, c));
}

export function collideObbCircle(o: OBB, c: Circle): Contact | null {
  const l = toLocal(o, c);
  const ca = Math.max(-o.halfLength, Math.min(o.halfLength, l.along));
  const cw = Math.max(-o.halfWidth, Math.min(o.halfWidth, l.across));
  const f = forwardOf(o.heading);
  const r = rightOf(o.heading);
  const inside = ca === l.along && cw === l.across;
  if (!inside) {
    const px = o.x + f.x * ca + r.x * cw;
    const pz = o.z + f.z * ca + r.z * cw;
    const dx = px - c.x;
    const dz = pz - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= c.r * c.r) return null;
    const d = Math.sqrt(d2) || 1e-6;
    return { nx: dx / d, nz: dz / d, depth: c.r - d };
  }
  // Центр кола всередині прямокутника — виштовхуємо через найближчу грань.
  const pa = o.halfLength - Math.abs(l.along);
  const pw = o.halfWidth - Math.abs(l.across);
  if (pa < pw) {
    const s = l.along >= 0 ? -1 : 1;
    return { nx: f.x * s, nz: f.z * s, depth: pa + c.r };
  }
  const s = l.across >= 0 ? -1 : 1;
  return { nx: r.x * s, nz: r.z * s, depth: pw + c.r };
}

function project(o: OBB, ax: number, az: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const c of obbCorners(o)) {
    const p = c.x * ax + c.z * az;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

/** SAT для двох прямокутників. Повертає виштовхування для `a`. */
export function collideObbObb(a: OBB, b: OBB): Contact | null {
  const axes = [forwardOf(a.heading), rightOf(a.heading), forwardOf(b.heading), rightOf(b.heading)];
  let best: Contact | null = null;
  for (const ax of axes) {
    const [amin, amax] = project(a, ax.x, ax.z);
    const [bmin, bmax] = project(b, ax.x, ax.z);
    const overlap = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) {
      const dir = (a.x - b.x) * ax.x + (a.z - b.z) * ax.z >= 0 ? 1 : -1;
      best = { nx: ax.x * dir, nz: ax.z * dir, depth: overlap };
    }
  }
  return best;
}
