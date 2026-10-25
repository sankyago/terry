import { EXERCISE } from '../config';
import type { Contact } from './collision';
import { collideObbCircle, collideObbObb, obbCorners, obbInsideObb } from './collision';
import { forwardOf } from './math';
import type { Obstacle, Track } from './track';
import { nearestOnCenterline } from './track';
import type { VehicleState } from './vehicle';
import { vehicleObb } from './vehicle';

export interface WorldContact {
  id: string;
  label: string;
  /** Швидкість удару, м/с (для звуку). */
  impact: number;
}

/** Розв'язує зіткнення корпусу авто з перешкодами: виштовхує і гасить швидкість. */
export function resolveCollisions(v: VehicleState, obstacles: Obstacle[]): WorldContact[] {
  const contacts: WorldContact[] = [];
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    for (const o of obstacles) {
      const car = vehicleObb(v);
      let c: Contact | null;
      if (o.shape === 'circle') {
        if (Math.hypot(o.circle.x - car.x, o.circle.z - car.z) > 3 + o.circle.r) continue;
        c = collideObbCircle(car, o.circle);
      } else {
        const reach = 3 + Math.hypot(o.box.halfLength, o.box.halfWidth);
        if (Math.hypot(o.box.x - car.x, o.box.z - car.z) > reach) continue;
        c = collideObbObb(car, o.box);
      }
      if (!c) continue;
      any = true;
      // Нормаль контакту спрямована від перешкоди до авто.
      const { nx, nz } = c;
      v.x += nx * (c.depth + 0.001);
      v.z += nz * (c.depth + 0.001);
      const f = forwardOf(v.heading);
      const towards = (f.x * nx + f.z * nz) * v.speed;
      let impact = 0;
      if (towards < 0) {
        impact = Math.abs(v.speed);
        v.speed *= -0.12;
      }
      if (!contacts.some((x) => x.id === o.id)) contacts.push({ id: o.id, label: o.label, impact });
      else if (impact > 0) contacts.find((x) => x.id === o.id)!.impact = impact;
    }
    if (!any) break;
  }
  return contacts;
}

export interface CarTrackState {
  inZone: boolean;
  offRoad: boolean;
  s: number;
  lateral: number;
}

export function evaluateCarOnTrack(v: VehicleState, track: Track): CarTrackState {
  const obb = vehicleObb(v);
  const offRoad = obbCorners(obb).some(
    (c) => nearestOnCenterline(track.centerline, c).dist > track.halfWidth + EXERCISE.offRoadTolerance,
  );
  const n = nearestOnCenterline(track.centerline, v);
  return { inZone: obbInsideObb(obb, track.zone), offRoad, s: n.s, lateral: n.lateral };
}
