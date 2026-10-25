import type { Pose, Vec2 } from './math';
import { headingOf, wrapAngle } from './math';

export interface PathPoint {
  x: number;
  z: number;
  s: number;
}

/** Ламана з довжиною дуги. За межами [0, length] продовжується по прямій. */
export interface Path {
  pts: PathPoint[];
  length: number;
}

/** Кутова точка маршруту; r — радіус заокруглення повороту в цій точці. */
export interface Corner extends Vec2 {
  r?: number;
}

export function makePath(points: Vec2[]): Path {
  const pts: PathPoint[] = [];
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const d = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
      if (d < 1e-6) continue;
      s += d;
    }
    pts.push({ x: points[i].x, z: points[i].z, s });
  }
  return { pts, length: s };
}

/** Маршрут із прямих і дуг кола в кутах (як реальна траєкторія повороту). */
export function roundedPath(corners: Corner[], step = 0.5): Path {
  const out: Vec2[] = [];
  const pushLine = (a: Vec2, b: Vec2) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = out.length ? 1 : 0; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
  };
  let cursor: Vec2 = corners[0];
  for (let i = 1; i < corners.length - 1; i++) {
    const p = corners[i];
    const prev = corners[i - 1];
    const next = corners[i + 1];
    const r = p.r ?? 0;
    const l1 = Math.hypot(p.x - prev.x, p.z - prev.z);
    const l2 = Math.hypot(next.x - p.x, next.z - p.z);
    const d1 = { x: (p.x - prev.x) / l1, z: (p.z - prev.z) / l1 };
    const d2 = { x: (next.x - p.x) / l2, z: (next.z - p.z) / l2 };
    const theta = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.z * d2.z)));
    if (r <= 0 || theta < 1e-3) {
      pushLine(cursor, p);
      cursor = p;
      continue;
    }
    const t = r * Math.tan(theta / 2);
    const a = { x: p.x - d1.x * t, z: p.z - d1.z * t };
    const b = { x: p.x + d2.x * t, z: p.z + d2.z * t };
    pushLine(cursor, a);
    // Центр дуги — з боку повороту.
    let nx = -d1.z;
    let nz = d1.x;
    if (nx * d2.x + nz * d2.z < 0) {
      nx = -nx;
      nz = -nz;
    }
    const c = { x: a.x + nx * r, z: a.z + nz * r };
    const pa = Math.atan2(a.z - c.z, a.x - c.x);
    const delta = wrapAngle(Math.atan2(b.z - c.z, b.x - c.x) - pa);
    const n = Math.max(2, Math.ceil((Math.abs(delta) * r) / step));
    for (let k = 1; k <= n; k++) {
      const ang = pa + (delta * k) / n;
      out.push({ x: c.x + Math.cos(ang) * r, z: c.z + Math.sin(ang) * r });
    }
    cursor = b;
  }
  pushLine(cursor, corners[corners.length - 1]);
  return makePath(out);
}

function segmentAt(path: Path, s: number): number {
  const pts = path.pts;
  let lo = 0;
  let hi = pts.length - 2;
  if (s <= pts[0].s) return 0;
  if (s >= pts[hi].s) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].s <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function poseOnPath(path: Path, s: number): Pose {
  const i = segmentAt(path, s);
  const a = path.pts[i];
  const b = path.pts[i + 1];
  const len = b.s - a.s;
  const t = (s - a.s) / len;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: headingOf(b.x - a.x, b.z - a.z) };
}

/** Кривизна (1/м) зі знаком: > 0 — поворот праворуч. */
export function curvatureAt(path: Path, s: number, ds = 1): number {
  const h1 = poseOnPath(path, s - ds / 2).heading;
  const h2 = poseOnPath(path, s + ds / 2).heading;
  return wrapAngle(h2 - h1) / ds;
}

export function nearestOnPath(path: Path, p: Vec2): { s: number; dist: number } {
  let best = { s: 0, dist: Infinity };
  const pts = path.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
    if (d < best.dist) best = { s: a.s + (b.s - a.s) * t, dist: d };
  }
  return best;
}

/**
 * Точка конфлікту: перше місце попереду на маршруті `a` (від `fromS`), де центр
 * опиняється ближче за `threshold` до траєкторії `b`. Працює і для перетину, і для злиття смуг.
 */
export function findConflict(a: Path, fromS: number, b: Path, threshold = 1.4, maxAhead = 60) {
  for (let s = fromS; s <= fromS + maxAhead; s += 0.25) {
    const p = poseOnPath(a, s);
    const n = nearestOnPath(b, p);
    if (n.dist < threshold) return { sa: s, sb: n.s, x: p.x, z: p.z };
  }
  return null;
}
