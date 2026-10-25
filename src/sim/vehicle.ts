import { CAR } from '../config';
import type { OBB } from './collision';
import type { Pose } from './math';
import { approach, clamp, forwardOf } from './math';

export type Gear = 'P' | 'R' | 'N' | 'D';
export const GEARS: Gear[] = ['P', 'R', 'N', 'D'];

export interface DriveCommand {
  throttle: number;
  brake: number;
  steer: number;
}

export interface VehicleState extends Pose {
  /** Поздовжня швидкість, м/с. Додатна — вперед. */
  speed: number;
  /** Положення керма -1…1 (праворуч > 0). */
  steer: number;
  gear: Gear;
  throttle: number;
  brake: number;
  /** Пройдений шлях (м) — для обертання коліс і визначення старту. */
  odometer: number;
}

export type GearResult = { ok: true } | { ok: false; reason: 'speed' | 'brake' };

export function createVehicle(pose: Pose): VehicleState {
  return { ...pose, speed: 0, steer: 0, gear: 'P', throttle: 0, brake: 0, odometer: 0 };
}

export function resetVehicle(v: VehicleState, pose: Pose) {
  Object.assign(v, createVehicle(pose));
}

/**
 * Перемикання селектора. Правила (спрощено, як у типового автомата):
 *  - вийти з P можна лише з натиснутим гальмом;
 *  - P, а також D↔R — лише коли авто майже стоїть.
 */
export function requestGear(v: VehicleState, gear: Gear, brakeInput: number): GearResult {
  if (gear === v.gear) return { ok: true };
  if (v.gear === 'P' && brakeInput < 0.1) return { ok: false, reason: 'brake' };
  const slow = Math.abs(v.speed) <= CAR.shiftSpeedThreshold;
  if (gear === 'P' && !slow) return { ok: false, reason: 'speed' };
  if (gear === 'D' && v.speed < -CAR.shiftSpeedThreshold) return { ok: false, reason: 'speed' };
  if (gear === 'R' && v.speed > CAR.shiftSpeedThreshold) return { ok: false, reason: 'speed' };
  v.gear = gear;
  if (gear === 'P') v.speed = 0;
  return { ok: true };
}

export function steerAngle(v: VehicleState): number {
  const speedFactor = 1 / (1 + (v.speed / 12) ** 2);
  return v.steer * CAR.maxSteerAngle * speedFactor;
}

/** Один фіксований крок кінематичної моделі «велосипед». */
export function stepVehicle(v: VehicleState, cmd: DriveCommand, dt: number) {
  const throttle = clamp(cmd.throttle, 0, 1);
  const brake = clamp(cmd.brake, 0, 1);
  v.throttle = throttle;
  v.brake = brake;
  v.steer = approach(v.steer, clamp(cmd.steer, -1, 1), CAR.steerRate * dt);

  if (v.gear === 'P') {
    v.speed = 0;
    return;
  }

  let speed = v.speed;
  // Тяга.
  if (v.gear === 'D') {
    if (throttle > 0) speed += throttle * CAR.driveAccel * Math.max(0, 1 - speed / CAR.maxForwardSpeed) * dt;
    else if (brake === 0 && speed < CAR.creepSpeed) speed = Math.min(CAR.creepSpeed, speed + CAR.creepAccel * dt);
  } else if (v.gear === 'R') {
    if (throttle > 0) speed -= throttle * CAR.reverseAccel * Math.max(0, 1 + speed / CAR.maxReverseSpeed) * dt;
    else if (brake === 0 && speed > -CAR.creepSpeed) speed = Math.max(-CAR.creepSpeed, speed - CAR.creepAccel * dt);
  }
  // Гальмо та опір кочення — завжди до нуля, без зміни знаку.
  const resist = brake * CAR.brakeDecel + CAR.rollingResistance + CAR.aeroDrag * speed * speed;
  speed = approach(speed, 0, resist * dt);
  v.speed = clamp(speed, -CAR.maxReverseSpeed, CAR.maxForwardSpeed);

  const yawRate = (v.speed / CAR.wheelbase) * Math.tan(steerAngle(v));
  v.heading += yawRate * dt;
  const f = forwardOf(v.heading);
  v.x += f.x * v.speed * dt;
  v.z += f.z * v.speed * dt;
  v.odometer += Math.abs(v.speed) * dt;
}

export function vehicleObb(v: Pose): OBB {
  return { x: v.x, z: v.z, heading: v.heading, halfLength: CAR.length / 2, halfWidth: CAR.width / 2 };
}
