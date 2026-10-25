import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CITY } from '../config';
import type { LightColor, LightState } from '../sim/city';
import { CROSSWALKS, DRIVEWAYS, GIVE_WAY_LINES, SIGNALS, SIGNS, YARD } from '../sim/city';
import { forwardOf, rightOf } from '../sim/math';
import { seededRandom } from '../sim/random';
import { COLORS, makeMaterial } from './palette';

/** Збирає статичні меші за матеріалом і зливає їх — кілька draw call замість тисяч. */
class Batcher {
  private groups = new Map<StandardMaterial, Mesh[]>();
  add(mesh: Mesh, mat: StandardMaterial) {
    let g = this.groups.get(mat);
    if (!g) this.groups.set(mat, (g = []));
    g.push(mesh);
    return mesh;
  }

  flush(receiveShadows: Set<StandardMaterial>, freeze = true): Mesh[] {
    const out: Mesh[] = [];
    for (const [mat, meshes] of this.groups) {
      const merged = meshes.length === 1 ? meshes[0] : Mesh.MergeMeshes(meshes, true, true);
      if (!merged) continue;
      merged.material = mat;
      merged.isPickable = false;
      merged.receiveShadows = receiveShadows.has(mat);
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;
      out.push(merged);
      if (freeze) mat.freeze();
    }
    this.groups.clear();
    return out;
  }
}

const LAMP_ON: Record<'red' | 'yellow' | 'green', Color3> = {
  red: new Color3(1, 0.18, 0.15),
  yellow: new Color3(1, 0.75, 0.1),
  green: new Color3(0.15, 1, 0.45),
};
const LAMP_OFF = new Color3(0.08, 0.08, 0.08);

/** Лампи світлофорів: матеріал на кожен (перехрестя, вісь, колір). */
export class TrafficLightView {
  private last = '';
  constructor(private lamps: Map<string, StandardMaterial>) {}

  update(lights: Record<string, LightState>) {
    const key = JSON.stringify(lights);
    if (key === this.last) return;
    this.last = key;
    const litOf = (c: LightColor, lamp: 'red' | 'yellow' | 'green') =>
      lamp === 'red' ? c === 'red' || c === 'redYellow' : lamp === 'yellow' ? c === 'yellow' || c === 'redYellow' : c === 'green';
    for (const [id, st] of Object.entries(lights))
      for (const axis of ['ns', 'ew'] as const)
        for (const lamp of ['red', 'yellow', 'green'] as const) {
          const m = this.lamps.get(`${id}.${axis}.${lamp}`);
          if (m) m.emissiveColor = litOf(st[axis], lamp) ? LAMP_ON[lamp] : LAMP_OFF;
        }
  }
}

export interface CityView {
  trafficLights: TrafficLightView;
}

const RX = CITY.roadsX;
const RZ = CITY.roadsZ;
const HW = CITY.roadHalfWidth;
const SW = CITY.sidewalk;
const CURB = CITY.curbHeight;
const MARK_Y = 0.03;

export function buildCity(scene: Scene, shadows: boolean): CityView {
  const b = new Batcher();
  const m = (name: string, hex: string, emissive = 0.12) => makeMaterial(scene, name, hex, emissive);
  const mats = {
    grass: m('grass', COLORS.grass, 0.06),
    grassDark: m('grassDark', COLORS.grassDark, 0.06),
    asphalt: m('asphalt', COLORS.asphalt, 0.06),
    parking: m('parking', COLORS.parking, 0.06),
    marking: m('marking', COLORS.marking, 0.4),
    sidewalk: m('sidewalk', COLORS.sidewalk, 0.1),
    curb: m('curb', COLORS.curb, 0.1),
    paving: m('paving', COLORS.paving, 0.1),
    water: m('water', '#7fb7d6', 0.2),
    trunk: m('trunk', COLORS.trunk),
    foliage: m('foliage', COLORS.foliage),
    foliage2: m('foliage2', COLORS.foliage2),
    walls: COLORS.walls.map((c, i) => m(`wall${i}`, c, 0.14)),
    roof: m('roof', COLORS.roof),
    roofDark: m('roofDark', COLORS.roofDark),
    window: m('window', COLORS.window, 0.22),
    pole: m('pole', COLORS.pole, 0.1),
    signBlue: m('signBlue', COLORS.signBlue, 0.3),
    signRed: m('signRed', COLORS.signRed, 0.3),
    signYellow: m('signYellow', COLORS.signYellow, 0.3),
    signWhite: m('signWhite', COLORS.signWhite, 0.45),
    carParts: {
      glass: m('pGlass', COLORS.carGlass, 0.05),
      tyre: m('pTyre', COLORS.tyre, 0.02),
      bodies: ['#c9d1d6', '#3f4a52', '#9b2f2f', '#2f5f9b', '#e8e2d4', '#55606a', '#6c8f5a'].map((c, i) => m(`pBody${i}`, c, 0.14)),
    },
  };
  for (const k of ['signBlue', 'signRed', 'signYellow', 'signWhite'] as const) mats[k].backFaceCulling = false;
  const rnd = seededRandom(23);

  const flat = (x0: number, z0: number, x1: number, z1: number, y: number, mat: StandardMaterial) => {
    const g = MeshBuilder.CreateGround('flat', { width: x1 - x0, height: z1 - z0 }, scene);
    g.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    return b.add(g, mat);
  };
  const box = (cx: number, cy: number, cz: number, w: number, h: number, d: number, mat: StandardMaterial, rotY = 0) => {
    const bx = MeshBuilder.CreateBox('box', { width: w, height: h, depth: d }, scene);
    bx.position.set(cx, cy, cz);
    bx.rotation.y = rotY;
    return b.add(bx, mat);
  };

  // Земля й асфальт усього міста (квартали лежать зверху).
  flat(-260, -260, 440, 440, -0.02, mats.grass);
  const minR = RX[0] - HW;
  const maxR = RX[RX.length - 1] + HW;
  flat(minR, RZ[0] - HW, maxR, RZ[RZ.length - 1] + HW, 0, mats.asphalt);

  /** Біля перехресть маршруту будинків немає: з камери під 45° вони закривали б учасників ситуацій. */
  const openAreas = [
    { x: 90, z: 90 },
    { x: 180, z: 90 },
    { x: 180, z: 180 },
    { x: 90, z: 180 },
    { x: 0, z: 180 },
  ];
  const blocked = (x0: number, z0: number, x1: number, z1: number) =>
    openAreas.some((c) => Math.hypot(Math.max(x0 - c.x, 0, c.x - x1), Math.max(z0 - c.z, 0, c.z - z1)) < 34);

  // ---------- Квартали ----------
  const isYard = (i: number, j: number) => RX[i] === 0 && RZ[j] === 0;
  const isPark = (i: number, j: number) => RX[i] === 90 && RZ[j] === 90;
  for (let i = 0; i < RX.length - 1; i++)
    for (let j = 0; j < RZ.length - 1; j++) {
      const x0 = RX[i] + HW;
      const x1 = RX[i + 1] - HW;
      const z0 = RZ[j] + HW;
      const z1 = RZ[j + 1] - HW;
      box((x0 + x1) / 2, CURB / 2, (z0 + z1) / 2, x1 - x0, CURB, z1 - z0, mats.sidewalk);
      // Бордюр — світліша смуга по краю тротуару.
      const t = 0.22;
      box((x0 + x1) / 2, CURB / 2 + 0.004, z0 + t / 2, x1 - x0, CURB, t, mats.curb);
      box((x0 + x1) / 2, CURB / 2 + 0.004, z1 - t / 2, x1 - x0, CURB, t, mats.curb);
      box(x0 + t / 2, CURB / 2 + 0.004, (z0 + z1) / 2, t, CURB, z1 - z0, mats.curb);
      box(x1 - t / 2, CURB / 2 + 0.004, (z0 + z1) / 2, t, CURB, z1 - z0, mats.curb);
      const ix0 = x0 + SW;
      const ix1 = x1 - SW;
      const iz0 = z0 + SW;
      const iz1 = z1 - SW;
      const y = CURB + 0.006;
      if (isYard(i, j)) buildYard(ix0, iz0, ix1, iz1, y);
      else if (isPark(i, j)) buildPark(ix0, iz0, ix1, iz1, y);
      else {
        flat(ix0, iz0, ix1, iz1, y, rnd() > 0.5 ? mats.grass : mats.paving);
        buildPerimeter(ix0, iz0, ix1, iz1, y);
      }
    }

  function building(x0: number, z0: number, x1: number, z1: number, h: number, y: number, force = false) {
    if (!force && blocked(x0, z0, x1, z1)) {
      // Замість будинку — газон із деревом.
      tree((x0 + x1) / 2, (z0 + z1) / 2, y);
      return;
    }
    const wall = mats.walls[Math.floor(rnd() * mats.walls.length)];
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    box(cx, y + h / 2, cz, w, h, d, wall);
    box(cx, y + h + 0.15, cz, w + 0.3, 0.3, d + 0.3, mats.roof);
    // Дахові блоки.
    for (let k = 0; k < 2; k++) {
      const uw = 1.5 + rnd() * 2.5;
      box(cx + (rnd() - 0.5) * (w - uw - 1), y + h + 0.6, cz + (rnd() - 0.5) * (d - uw - 1), uw, 0.9, uw, mats.roofDark);
    }
    // Вікна — смуга на кожен поверх з усіх боків.
    const floors = Math.max(1, Math.floor((h - 1) / 3));
    for (let f = 0; f < floors; f++) {
      const wy = y + 1.8 + f * 3;
      box(cx, wy, cz, w + 0.04, 1.1, d * 0.84, mats.window);
      box(cx, wy, cz, w * 0.84, 1.1, d + 0.04, mats.window);
    }
  }

  /** Будинки по периметру кварталу; біля кутів — нижчі, щоб не закривати перехрестя від камери. */
  function buildPerimeter(x0: number, z0: number, x1: number, z1: number, y: number) {
    const setback = 1.5;
    const heightAt = (cx: number, cz: number) => {
      const nearCorner = Math.min(Math.abs(cx - x0), Math.abs(cx - x1)) < 20 && Math.min(Math.abs(cz - z0), Math.abs(cz - z1)) < 20;
      return nearCorner ? 7 + rnd() * 4 : 9 + rnd() * 12;
    };
    const along = (from: number, to: number, place: (a: number, b: number, depth: number) => void) => {
      let p = from;
      while (p < to - 8) {
        const len = Math.min(to - p, 14 + rnd() * 14);
        const depth = 10 + rnd() * 5;
        place(p, p + len, depth);
        p += len + 3 + rnd() * 5;
      }
    };
    along(x0 + setback, x1 - setback, (a, c, dp) => {
      building(a, z0 + setback, c, z0 + setback + dp, heightAt((a + c) / 2, z0), y);
      building(a, z1 - setback - dp, c, z1 - setback, heightAt((a + c) / 2, z1), y);
    });
    along(z0 + setback + 18, z1 - setback - 18, (a, c, dp) => {
      building(x0 + setback, a, x0 + setback + dp, c, heightAt(x0, (a + c) / 2), y);
      building(x1 - setback - dp, a, x1 - setback, c, heightAt(x1, (a + c) / 2), y);
    });
    for (let k = 0; k < 6; k++) tree(x0 + 22 + rnd() * (x1 - x0 - 44), z0 + 22 + rnd() * (z1 - z0 - 44), y);
  }

  function buildYard(x0: number, z0: number, x1: number, z1: number, y: number) {
    flat(x0, z0, x1, z1, y, mats.paving);
    flat(YARD.minX, YARD.minZ, YARD.maxX, YARD.maxZ, y + 0.004, mats.parking);
    // Будинки двору: південь, захід, схід; з півночі — виїзд і хвіртка.
    building(x0 + 1, z0 + 1, x1 - 1, z0 + 15, 15, y, true);
    building(x0 + 1, z0 + 18, x0 + 8, z1 - 16, 12, y, true);
    building(66, z0 + 18, 76, 58, 8, y, true);
    // Розмітка й припарковані авто — два ряди.
    for (const [rowZ, heading] of [
      [38, 0],
      [62, Math.PI],
    ] as const) {
      for (let k = 0; k <= 9; k++) {
        const x = 29 + k * 3;
        box(x - 1.5, y + 0.01, rowZ, 0.12, 0.01, 5, mats.marking);
        if (rnd() < 0.8) parkedCar(x, rowZ, heading + (rnd() - 0.5) * 0.05, y);
      }
    }
    for (const [tx, tz] of [
      [12, 76],
      [30, 76],
      [40, 76],
      [58, 76],
      [12, 30],
    ])
      tree(tx, tz, y);
  }

  function buildPark(x0: number, z0: number, x1: number, z1: number, y: number) {
    flat(x0, z0, x1, z1, y, mats.grassDark);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    flat(cx - 1.5, z0, cx + 1.5, z1, y + 0.004, mats.paving);
    flat(x0, cz - 1.5, x1, cz + 1.5, y + 0.004, mats.paving);
    const pond = MeshBuilder.CreateDisc('pond', { radius: 9, tessellation: 18 }, scene);
    pond.rotation.x = Math.PI / 2;
    pond.position.set(cx + 20, y + 0.01, cz - 20);
    b.add(pond, mats.water);
    for (let k = 0; k < 46; k++) {
      const tx = x0 + 4 + rnd() * (x1 - x0 - 8);
      const tz = z0 + 4 + rnd() * (z1 - z0 - 8);
      if (Math.abs(tx - cx) < 4 || Math.abs(tz - cz) < 4 || Math.hypot(tx - cx - 20, tz - cz + 20) < 11) continue;
      tree(tx, tz, y);
    }
  }

  function tree(x: number, z: number, y: number, street = false) {
    const h = (street ? 2.4 : 1.8) + rnd() * 0.6;
    const trunk = MeshBuilder.CreateCylinder('trunk', { diameter: 0.32, height: h, tessellation: 6 }, scene);
    trunk.position.set(x, y + h / 2, z);
    b.add(trunk, mats.trunk);
    const r = street ? 1.2 + rnd() * 0.5 : 1.6 + rnd() * 1.1;
    const crown = MeshBuilder.CreateSphere('crown', { diameter: r * 2, segments: 3 }, scene);
    crown.position.set(x, y + h + r * 0.7, z);
    crown.scaling.y = 0.85;
    b.add(crown, rnd() > 0.5 ? mats.foliage : mats.foliage2);
  }

  function parkedCar(x: number, z: number, heading: number, y: number) {
    const body = mats.carParts.bodies[Math.floor(rnd() * mats.carParts.bodies.length)];
    const f = forwardOf(heading);
    const at = (along: number) => ({ x: x + f.x * along, z: z + f.z * along });
    const c = at(0);
    box(c.x, y + 0.48, c.z, 1.8, 0.64, 4.4, body, heading);
    const cab = at(-0.2);
    box(cab.x, y + 1.07, cab.z, 1.56, 0.55, 2.3, mats.carParts.glass, heading);
    box(cab.x, y + 1.36, cab.z, 1.46, 0.05, 1.5, body, heading);
  }

  // ---------- Розмітка ----------
  const isSignal = (x: number, z: number) => SIGNALS.some((s) => s.x === x && s.z === z);
  const dash = (cx: number, cz: number, len: number, alongX: boolean, w = 0.14) =>
    box(cx, MARK_Y, cz, alongX ? len : w, 0.01, alongX ? w : len, mats.marking);
  /** Осьова між перехрестями: суцільна біля перехресть, далі пунктир. */
  const centerLine = (fixed: number, from: number, to: number, alongX: boolean) => {
    const solid = 12;
    const at = (p: number, len: number) => (alongX ? dash(p, fixed, len, true) : dash(fixed, p, len, false));
    at(from + solid / 2, solid);
    at(to - solid / 2, solid);
    for (let p = from + solid + 3; p + 3 < to - solid; p += 9) at(p + 1.5, 3);
  };
  for (const x of RX)
    for (let j = 0; j < RZ.length - 1; j++) {
      const gapA = isSignal(x, RZ[j]) ? 8 : HW + 0.5;
      const gapB = isSignal(x, RZ[j + 1]) ? 8 : HW + 0.5;
      centerLine(x, RZ[j] + gapA, RZ[j + 1] - gapB, false);
    }
  for (const z of RZ)
    for (let i = 0; i < RX.length - 1; i++) {
      const gapA = isSignal(RX[i], z) ? 8 : HW + 0.5;
      const gapB = isSignal(RX[i + 1], z) ? 8 : HW + 0.5;
      centerLine(z, RX[i] + gapA, RX[i + 1] - gapB, true);
    }

  // Зебри: смуги вздовж руху, розкладені поперек дороги.
  for (const c of CROSSWALKS) {
    for (let k = -HW + 0.5; k <= HW - 0.4; k += 1.0) {
      if (c.roadAlongX) box(c.x, MARK_Y, c.z + k, c.width, 0.01, 0.5, mats.marking);
      else box(c.x + k, MARK_Y, c.z, 0.5, 0.01, c.width, mats.marking);
    }
  }
  // Стоп-лінії на регульованих перехрестях (права половина дороги перед зеброю).
  for (const s of SIGNALS) {
    const d = HW + 2.2 + 1.5 + 0.45;
    box(s.x + HW / 2, MARK_Y, s.z - d, HW, 0.01, 0.4, mats.marking);
    box(s.x - HW / 2, MARK_Y, s.z + d, HW, 0.01, 0.4, mats.marking);
    box(s.x + d, MARK_Y, s.z + HW / 2, 0.4, 0.01, HW, mats.marking);
    box(s.x - d, MARK_Y, s.z - HW / 2, 0.4, 0.01, HW, mats.marking);
  }
  // Лінія «Дати дорогу» — трикутники вершиною до водія.
  for (const g of GIVE_WAY_LINES) {
    const f = forwardOf(g.heading);
    const r = rightOf(g.heading);
    for (let k = -1.5; k <= 1.5; k += 0.75) {
      const tri = MeshBuilder.CreateDisc('tooth', { radius: 0.36, tessellation: 3 }, scene);
      tri.rotation.set(Math.PI / 2, g.heading + Math.PI / 2, 0);
      tri.position.set(g.x + r.x * k - f.x * 0.2, MARK_Y + 0.004, g.z + r.z * k - f.z * 0.2);
      b.add(tri, mats.marking);
    }
  }
  // Виїзд із двору — заниження тротуару.
  for (const d of DRIVEWAYS) {
    const hw = d.width / 2;
    if (d.alongZ) flat(d.x - hw, d.z - SW / 2 - 0.01, d.x + hw, d.z + SW / 2 + 0.01, CURB + 0.012, mats.parking);
  }

  // ---------- Дерева вздовж тротуарів ----------
  const avoid: Array<{ x: number; z: number; r: number }> = [
    ...CROSSWALKS.map((c) => ({ x: c.x, z: c.z, r: 9 })),
    ...SIGNS.map((s) => ({ x: s.x, z: s.z, r: 3 })),
    ...DRIVEWAYS.map((d) => ({ x: d.x, z: d.z, r: 6 })),
    { x: 50, z: 85, r: 4 },
  ];
  const free = (x: number, z: number) => avoid.every((a) => Math.hypot(a.x - x, a.z - z) > a.r);
  for (let i = 0; i < RX.length - 1; i++)
    for (let j = 0; j < RZ.length - 1; j++) {
      const x0 = RX[i] + HW + 1.7;
      const x1 = RX[i + 1] - HW - 1.7;
      const z0 = RZ[j] + HW + 1.7;
      const z1 = RZ[j + 1] - HW - 1.7;
      for (let p = 12; p < x1 - x0 - 10; p += 13) {
        if (free(x0 + p, z0)) tree(x0 + p, z0, CURB, true);
        if (free(x0 + p, z1)) tree(x0 + p, z1, CURB, true);
      }
      for (let p = 12; p < z1 - z0 - 10; p += 13) {
        if (free(x0, z0 + p)) tree(x0, z0 + p, CURB, true);
        if (free(x1, z0 + p)) tree(x1, z0 + p, CURB, true);
      }
    }

  // ---------- Дорожні знаки ----------
  for (const s of SIGNS) {
    const pole = MeshBuilder.CreateCylinder('pole', { diameter: 0.09, height: 2.5, tessellation: 6 }, scene);
    pole.position.set(s.x, CURB + 1.25, s.z);
    b.add(pole, mats.pole);
    const f = forwardOf(s.facing);
    const y0 = CURB + 2.35;
    const plate = (mesh: Mesh, mat: StandardMaterial, off: number, rotZ: number) => {
      mesh.rotation.set(0, s.facing, rotZ);
      mesh.position.set(s.x - f.x * (0.06 + off), y0, s.z - f.z * (0.06 + off));
      b.add(mesh, mat);
    };
    const disc = (r: number, tess: number) => MeshBuilder.CreateDisc('sign', { radius: r, tessellation: tess, sideOrientation: Mesh.DOUBLESIDE }, scene);
    if (s.kind === 'giveWay') {
      plate(disc(0.62, 3), mats.signRed, 0, -Math.PI / 2);
      plate(disc(0.42, 3), mats.signWhite, 0.01, -Math.PI / 2);
    } else if (s.kind === 'mainRoad') {
      plate(disc(0.5, 4), mats.signWhite, 0, 0);
      plate(disc(0.38, 4), mats.signYellow, 0.01, 0);
    } else {
      const sq = MeshBuilder.CreatePlane('sign', { size: 0.85, sideOrientation: Mesh.DOUBLESIDE }, scene);
      plate(sq, mats.signBlue, 0, 0);
      plate(disc(0.36, 3), mats.signWhite, 0.01, Math.PI / 2);
    }
  }

  // ---------- Світлофори ----------
  const lampMats = new Map<string, StandardMaterial>();
  const lb = new Batcher();
  for (const sig of SIGNALS) {
    for (const [heading, axis] of [
      [0, 'ns'],
      [Math.PI, 'ns'],
      [Math.PI / 2, 'ew'],
      [-Math.PI / 2, 'ew'],
    ] as const) {
      const f = forwardOf(heading);
      const r = rightOf(heading);
      const off = HW + 0.7;
      const px = sig.x - f.x * off + r.x * off;
      const pz = sig.z - f.z * off + r.z * off;
      const pole = MeshBuilder.CreateCylinder('tlPole', { diameter: 0.14, height: 3.6, tessellation: 6 }, scene);
      pole.position.set(px, CURB + 1.8, pz);
      b.add(pole, mats.pole);
      const hy = CURB + 3.2;
      box(px - f.x * 0.05, hy, pz - f.z * 0.05, 0.42, 1.15, 0.3, mats.pole, heading);
      for (const [k, lamp] of (['red', 'yellow', 'green'] as const).entries()) {
        const key = `${sig.id}.${axis}.${lamp}`;
        let mat = lampMats.get(key);
        if (!mat) {
          mat = makeMaterial(scene, key, '#222222', 0);
          mat.emissiveColor = LAMP_OFF;
          lampMats.set(key, mat);
        }
        const sph = MeshBuilder.CreateSphere('lamp', { diameter: 0.3, segments: 6 }, scene);
        sph.position.set(px - f.x * 0.2, hy + 0.36 - k * 0.36, pz - f.z * 0.2);
        lb.add(sph, mat);
      }
    }
  }
  lb.flush(new Set(), false);
  const trafficLights = new TrafficLightView(lampMats);
  trafficLights.update(Object.fromEntries(SIGNALS.map((s) => [s.id, s.initial])));

  const receivers = shadows
    ? new Set([mats.grass, mats.grassDark, mats.asphalt, mats.parking, mats.sidewalk, mats.paving, mats.marking])
    : new Set<StandardMaterial>();
  b.flush(receivers);
  return { trafficLights };
}
