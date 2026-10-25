export interface Vec2 {
  x: number;
  z: number;
}

/** Положення на площині: heading = 0 дивиться в +Z, додатний кут повертає праворуч (до +X). */
export interface Pose {
  x: number;
  z: number;
  heading: number;
}

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

export const approach = (current: number, target: number, maxDelta: number) =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

export const forwardOf = (heading: number): Vec2 => ({ x: Math.sin(heading), z: Math.cos(heading) });
export const rightOf = (heading: number): Vec2 => ({ x: Math.cos(heading), z: -Math.sin(heading) });

export const headingOf = (dx: number, dz: number) => Math.atan2(dx, dz);

export const msToKmh = (v: number) => v * 3.6;
