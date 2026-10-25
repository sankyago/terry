import { describe, expect, it } from 'vitest';
import { CAR, SIM_DT } from '../src/config';
import { collideObbCircle, collideObbObb, obbCorners, obbInsideObb } from '../src/sim/collision';
import { Indicators } from '../src/sim/indicators';
import { createTrack, nearestOnCenterline } from '../src/sim/track';
import { createVehicle, requestGear, stepVehicle, vehicleObb } from '../src/sim/vehicle';
import { evaluateCarOnTrack, resolveCollisions } from '../src/sim/world';

const track = createTrack();

describe('модель авто', () => {
  it('з P не виходить без гальма; D↔R на ходу заблоковано', () => {
    const v = createVehicle(track.start);
    expect(requestGear(v, 'D', 0)).toEqual({ ok: false, reason: 'brake' });
    expect(requestGear(v, 'D', 1).ok).toBe(true);
    for (let i = 0; i < 120; i++) stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, SIM_DT);
    expect(v.speed).toBeGreaterThan(2);
    expect(requestGear(v, 'R', 1)).toEqual({ ok: false, reason: 'speed' });
    expect(requestGear(v, 'P', 1)).toEqual({ ok: false, reason: 'speed' });
    expect(v.gear).toBe('D');
  });

  it('гальмо зупиняє авто без відкату назад, далі вмикається P', () => {
    const v = createVehicle(track.start);
    requestGear(v, 'D', 1);
    for (let i = 0; i < 120; i++) stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, SIM_DT);
    for (let i = 0; i < 180; i++) stepVehicle(v, { throttle: 0, brake: 1, steer: 0 }, SIM_DT);
    expect(v.speed).toBe(0);
    expect(requestGear(v, 'P', 1).ok).toBe(true);
    const z = v.z;
    for (let i = 0; i < 60; i++) stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, SIM_DT);
    expect(v.z).toBe(z);
  });

  it('задній хід рухає авто назад', () => {
    const v = createVehicle(track.start);
    requestGear(v, 'R', 1);
    const z0 = v.z;
    for (let i = 0; i < 120; i++) stepVehicle(v, { throttle: 0.6, brake: 0, steer: 0 }, SIM_DT);
    expect(v.speed).toBeLessThan(0);
    expect(v.z).toBeLessThan(z0);
    expect(Math.abs(v.speed)).toBeLessThanOrEqual(CAR.maxReverseSpeed + 1e-9);
  });

  it('кермо праворуч повертає праворуч (heading росте) лише в русі', () => {
    const v = createVehicle(track.start);
    requestGear(v, 'D', 1);
    for (let i = 0; i < 30; i++) stepVehicle(v, { throttle: 0, brake: 1, steer: 1 }, SIM_DT);
    expect(v.heading).toBe(track.start.heading);
    for (let i = 0; i < 120; i++) stepVehicle(v, { throttle: 0.5, brake: 0, steer: 1 }, SIM_DT);
    expect(v.heading).toBeGreaterThan(track.start.heading);
  });

  it('детермінований фіксований крок', () => {
    const a = createVehicle(track.start);
    const b = createVehicle(track.start);
    for (const v of [a, b]) {
      requestGear(v, 'D', 1);
      for (let i = 0; i < 300; i++) stepVehicle(v, { throttle: 0.7, brake: 0, steer: Math.sin(i / 40) }, SIM_DT);
    }
    expect(a).toEqual(b);
  });
});

describe('геометрія та зіткнення', () => {
  it('старт: авто на дорозі, поза зоною, без контактів', () => {
    const v = createVehicle(track.start);
    const st = evaluateCarOnTrack(v, track);
    expect(st.offRoad).toBe(false);
    expect(st.inZone).toBe(false);
    expect(resolveCollisions(v, track.obstacles)).toHaveLength(0);
  });

  it('авто, поставлене в центр зони, повністю в ній', () => {
    const v = createVehicle({ x: track.zone.x, z: track.zone.z, heading: track.zone.heading });
    expect(evaluateCarOnTrack(v, track).inZone).toBe(true);
    const shifted = createVehicle({ x: track.zone.x + 2.5, z: track.zone.z, heading: track.zone.heading });
    expect(evaluateCarOnTrack(shifted, track).inZone).toBe(false);
  });

  it('жодна перешкода, крім блоку, не стоїть на дорозі', () => {
    for (const o of track.obstacles) {
      if (o.kind === 'barrier') continue;
      const pts = o.shape === 'circle' ? [o.circle] : obbCorners(o.box);
      for (const p of pts) {
        expect(nearestOnCenterline(track.centerline, p).dist).toBeGreaterThan(track.halfWidth);
      }
    }
  });

  it('коло та прямокутник: контакт і виштовхування', () => {
    const car = vehicleObb({ x: 0, z: 0, heading: 0 });
    expect(collideObbCircle(car, { x: 0, z: 2.5, r: 0.3 })).not.toBeNull();
    expect(collideObbCircle(car, { x: 0, z: 3, r: 0.3 })).toBeNull();
    const c = collideObbObb(car, { x: 1.5, z: 0, heading: 0, halfLength: 1, halfWidth: 1 });
    expect(c && c.nx).toBeLessThan(0);
    expect(obbInsideObb(vehicleObb({ x: 0, z: 0, heading: 0.01 }), { x: 0, z: 0, heading: 0, halfLength: 3, halfWidth: 1.2 })).toBe(true);
  });

  it('наїзд на блок зупиняє авто і не дає проїхати крізь нього', () => {
    const b = track.obstacles.find((o) => o.kind === 'barrier')!;
    if (b.shape !== 'box') throw new Error('barrier');
    const v = createVehicle({ x: b.box.x - 6, z: track.zone.z, heading: Math.PI / 2 });
    requestGear(v, 'D', 1);
    let hit = false;
    for (let i = 0; i < 600; i++) {
      stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, SIM_DT);
      if (resolveCollisions(v, track.obstacles).length) hit = true;
    }
    expect(hit).toBe(true);
    expect(v.x + CAR.length / 2).toBeLessThanOrEqual(b.box.x - b.box.halfLength + 0.05);
  });
});

describe('покажчики повороту', () => {
  it('вимикаються після повороту керма і повернення', () => {
    const ind = new Indicators();
    ind.toggle('right');
    ind.update(0.8);
    expect(ind.side).toBe('right');
    ind.update(0.05);
    expect(ind.side).toBe('none');
  });
});
