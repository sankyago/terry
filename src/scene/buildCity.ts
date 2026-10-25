import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CITY } from '../config';
import type { LightColor, LightState, WorldFeatures } from '../sim/city';
import { DRIVEWAYS, YARD } from '../sim/city';
import { forwardOf, rightOf } from '../sim/math';
import { seededRandom } from '../sim/random';
import type { V3 } from './geometry';
import { FlatGeometry } from './geometry';
import { COLORS, makeMaterial } from './palette';
import type { CarModel, VehicleParts } from './vehicleModels';
import { buildCar, TRAFFIC_MODELS } from './vehicleModels';

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

  /** clock — для миготливого жовтого (раз на секунду). */
  update(lights: Record<string, LightState>, clock = 0) {
    const blink = Math.floor(clock * 2) % 2 === 0;
    const key = JSON.stringify(lights) + blink;
    if (key === this.last) return;
    this.last = key;
    const litOf = (c: LightColor, lamp: 'red' | 'yellow' | 'green') =>
      lamp === 'red'
        ? c === 'red' || c === 'redYellow'
        : lamp === 'yellow'
          ? c === 'yellow' || c === 'redYellow' || (c === 'flash' && blink)
          : c === 'green';
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
  /** Прибирає все місто зі сцени (перед побудовою міста для нового маршруту). */
  dispose(): void;
}

const RX = CITY.roadsX;
const RZ = CITY.roadsZ;
const HW = CITY.roadHalfWidth;
const SW = CITY.sidewalk;
const CURB = CITY.curbHeight;
const MARK_Y = 0.03;

/** Місто для конкретного маршруту: квартали однакові, а знаки, світлофори й розмітка — з плану. */
export function buildCity(scene: Scene, shadows: boolean, world: WorldFeatures): CityView {
  const meshesBefore = new Set(scene.meshes);
  const materialsBefore = new Set(scene.materials);
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
    frame: m('frame', '#f3f1ea', 0.2),
    shop: m('shop', '#3f5766', 0.12),
    plinth: m('plinth', '#8d8f8c', 0.1),
    gravel: m('gravel', '#9ca3a5', 0.08),
    tile: m('tile', '#a8524a', 0.12),
    brick: m('brick', '#b8735a', 0.14),
    awnings: ['#d8543a', '#2f8f6f', '#3a6fb0', '#e0a43a'].map((c, i) => m(`awning${i}`, c, 0.2)),
    patch: m('patch', '#50575e', 0.05),
    manhole: m('manhole', '#3c4247', 0.05),
    joint: m('joint', '#c3c6c2', 0.08),
    lamp: m('lamp', '#fff4d0', 0.7),
    soil: m('soil', '#7d6c5a', 0.06),
    pole: m('pole', COLORS.pole, 0.1),
    signBlue: m('signBlue', COLORS.signBlue, 0.3),
    signRed: m('signRed', COLORS.signRed, 0.3),
    signYellow: m('signYellow', COLORS.signYellow, 0.3),
    signWhite: m('signWhite', COLORS.signWhite, 0.45),
    signBlack: m('signBlack', '#1d2125', 0.1),
    coneOrange: m('coneOrange', '#f07a1a', 0.3),
    carParts: {
      glass: m('pGlass', COLORS.carGlass, 0.08),
      tyre: m('pTyre', COLORS.tyre, 0.02),
      trim: m('pTrim', COLORS.carTrim, 0.04),
      chrome: m('pChrome', COLORS.rim, 0.25),
      plate: m('pPlate', '#f1f3f0', 0.35),
      head: m('pHead', '#e9e4d0', 0.3),
      tail: m('pTail', '#8e2026', 0.25),
      ind: m('pInd', '#8a5418', 0.15),
      bodies: ['#c9d1d6', '#3f4a52', '#9b2f2f', '#2f5f9b', '#e8e2d4', '#55606a', '#6c8f5a', '#1f2326'].map((c, i) => m(`pBody${i}`, c, 0.14)),
    },
  };
  for (const k of ['signBlue', 'signRed', 'signYellow', 'signWhite', 'signBlack'] as const) mats[k].backFaceCulling = false;
  const rnd = seededRandom(23);
  // Деталізовані частини (вікна, кузови, бордюри) — одна сітка на матеріал.
  const geos = new Map<StandardMaterial, FlatGeometry>();
  const fg = (mat: StandardMaterial) => {
    let g = geos.get(mat);
    if (!g) geos.set(mat, (g = new FlatGeometry()));
    return g;
  };
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];

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
  flat(RX[0] - 170, RZ[0] - 170, RX[RX.length - 1] + 170, RZ[RZ.length - 1] + 170, -0.02, mats.grass);
  const minR = RX[0] - HW;
  const maxR = RX[RX.length - 1] + HW;
  flat(minR, RZ[0] - HW, maxR, RZ[RZ.length - 1] + HW, 0, mats.asphalt);

  /** Біля місць ситуацій будинків немає: з камери під 45° вони закривали б учасників. */
  const blocked = (x0: number, z0: number, x1: number, z1: number) =>
    world.open.some((c) => Math.hypot(Math.max(x0 - c.x, 0, c.x - x1), Math.max(z0 - c.z, 0, c.z - z1)) < c.r);

  // ---------- Квартали ----------
  const isYard = (i: number, j: number) => RX[i] === 0 && RZ[j] === 0;
  const isPark = (i: number, j: number) => RX[i] === 90 && RZ[j] === 90;
  for (let i = 0; i < RX.length - 1; i++)
    for (let j = 0; j < RZ.length - 1; j++) {
      const x0 = RX[i] + HW;
      const x1 = RX[i + 1] - HW;
      const z0 = RZ[j] + HW;
      const z1 = RZ[j + 1] - HW;
      sidewalkBlock(x0, z0, x1, z1);
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

  type Style = 'panel' | 'office' | 'brick' | 'house';

  function building(x0: number, z0: number, x1: number, z1: number, h: number, y: number, force = false) {
    if (!force && blocked(x0, z0, x1, z1)) {
      // Замість будинку — газон із деревом.
      tree((x0 + x1) / 2, (z0 + z1) / 2, y);
      return;
    }
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const r = rnd();
    const style: Style = h < 10 && r < 0.45 ? 'house' : r < 0.4 ? 'panel' : r < 0.7 ? 'brick' : 'office';
    const wall = style === 'brick' ? mats.brick : style === 'office' ? pick([mats.walls[1], mats.walls[3]]) : pick(mats.walls);
    const top = y + h;
    box(cx, y + h / 2, cz, w, h, d, wall);
    // Цоколь.
    box(cx, y + 0.3, cz, w + 0.08, 0.6, d + 0.08, mats.plinth);

    // Фасади: вікна по поверхах, перший поверх — вітрини з маркізами.
    const shops = style !== 'house' && h > 8 && rnd() < 0.7;
    const floorH = style === 'office' ? 3.4 : 3;
    const groundH = shops ? 4 : floorH;
    const floors = Math.max(1, Math.floor((h - groundH - 0.6) / floorH) + 1);
    const faces: Array<{ c: V3; t: V3; n: V3; len: number }> = [
      { c: [cx, 0, z0], t: [1, 0, 0], n: [0, 0, -1], len: w },
      { c: [cx, 0, z1], t: [1, 0, 0], n: [0, 0, 1], len: w },
      { c: [x0, 0, cz], t: [0, 0, 1], n: [-1, 0, 0], len: d },
      { c: [x1, 0, cz], t: [0, 0, 1], n: [1, 0, 0], len: d },
    ];
    const at = (f: (typeof faces)[number], along: number, out: number, yy: number): V3 => [
      f.c[0] + f.t[0] * along + f.n[0] * out,
      yy,
      f.c[2] + f.t[2] * along + f.n[2] * out,
    ];
    const scale = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];
    const up: V3 = [0, 1, 0];
    const balconies = style === 'panel' && rnd() < 0.7;
    for (const f of faces) {
      const spacing = style === 'office' ? 2.2 : 3;
      const cols = Math.floor((f.len - 1.6) / spacing);
      if (cols < 1) continue;
      const start = -((cols - 1) * spacing) / 2;
      const ww = style === 'office' ? 1.9 : style === 'house' ? 1.1 : 1.3;
      const wh = style === 'office' ? 2.3 : 1.5;
      for (let fl = 0; fl < floors; fl++) {
        const ground = fl === 0;
        if (ground && shops) continue;
        const wy = y + (ground ? 0 : groundH + (fl - 1) * floorH) + (style === 'office' ? 1.7 : 1.75);
        if (wy + wh / 2 > top - 0.4) continue;
        for (let k = 0; k < cols; k++) {
          const a = start + k * spacing;
          if (style !== 'office') fg(mats.frame).quad(at(f, a, 0.02, wy), scale(f.t, ww / 2 + 0.1), scale(up, wh / 2 + 0.1), f.n);
          fg(mats.window).quad(at(f, a, 0.035, wy), scale(f.t, ww / 2), scale(up, wh / 2), f.n);
          if (balconies && !ground && k % 2 === 0 && f.len > 12) {
            const bc = at(f, a, 0.5, wy - wh / 2 - 0.05);
            const along = Math.abs(f.t[0]) > 0;
            fg(wall).box(bc[0], bc[1], bc[2], along ? ww + 0.6 : 1.0, 0.12, along ? 1.0 : ww + 0.6);
            const rc = at(f, a, 0.96, wy - wh / 2 + 0.3);
            fg(mats.plinth).box(rc[0], rc[1], rc[2], along ? ww + 0.6 : 0.06, 0.6, along ? 0.06 : ww + 0.6);
          }
        }
      }
      // Офісні фасади: світлі горизонтальні пояси між поверхами.
      if (style === 'office')
        for (let fl = 1; fl < floors + 1; fl++) {
          const by = y + groundH + (fl - 1) * floorH;
          if (by > top - 0.5) break;
          fg(mats.frame).quad(at(f, 0, 0.03, by), scale(f.t, f.len / 2 - 0.4), scale(up, 0.12), f.n);
        }
      if (shops) {
        const awning = pick(mats.awnings);
        for (let k = 0; k < cols; k += 2) {
          const a = start + k * spacing + (k + 1 < cols ? spacing / 2 : 0);
          const sw = k + 1 < cols ? spacing * 2 - 0.8 : spacing - 0.6;
          fg(mats.frame).quad(at(f, a, 0.02, y + 1.85), scale(f.t, sw / 2 + 0.12), scale(up, 1.3), f.n);
          fg(mats.shop).quad(at(f, a, 0.035, y + 1.75), scale(f.t, sw / 2), scale(up, 1.1), f.n);
          if (rnd() < 0.6) {
            const ac = at(f, a, 0.55, y + 3.25);
            const along = Math.abs(f.t[0]) > 0;
            fg(awning).box(ac[0], ac[1], ac[2], along ? sw + 0.2 : 1.1, 0.12, along ? 1.1 : sw + 0.2, 0, 0);
          }
        }
      }
    }

    if (style === 'house') {
      // Двосхилий дах уздовж довшої сторони, з фронтонами й димарем.
      const o = 0.45;
      const alongX = w >= d;
      const span = (alongX ? d : w) / 2;
      const ridge = top + Math.min(3.2, span * 0.7);
      const inside: V3 = [cx, top, cz];
      const roofM = rnd() < 0.6 ? mats.tile : mats.roofDark;
      if (alongX) {
        fg(roofM).poly([[x0 - o, top - 0.3, z0 - o], [x1 + o, top - 0.3, z0 - o], [x1 + o, ridge, cz], [x0 - o, ridge, cz]], inside);
        fg(roofM).poly([[x0 - o, top - 0.3, z1 + o], [x1 + o, top - 0.3, z1 + o], [x1 + o, ridge, cz], [x0 - o, ridge, cz]], inside);
        for (const x of [x0, x1]) fg(wall).poly([[x, top, z0], [x, top, z1], [x, ridge, cz]], inside);
      } else {
        fg(roofM).poly([[x0 - o, top - 0.3, z0 - o], [x0 - o, top - 0.3, z1 + o], [cx, ridge, z1 + o], [cx, ridge, z0 - o]], inside);
        fg(roofM).poly([[x1 + o, top - 0.3, z0 - o], [x1 + o, top - 0.3, z1 + o], [cx, ridge, z1 + o], [cx, ridge, z0 - o]], inside);
        for (const z of [z0, z1]) fg(wall).poly([[x0, top, z], [x1, top, z], [cx, ridge, z]], inside);
      }
      box(cx + w * 0.22, ridge - 0.2, cz + d * 0.15, 0.7, 2, 0.7, mats.brick);
      return;
    }
    // Плаский дах: гравій, парапет, вентиляційні блоки й вихід на дах.
    box(cx, top + 0.02, cz, w - 0.1, 0.04, d - 0.1, mats.gravel);
    const pw = 0.3;
    const ph = 0.6;
    const cornice = style === 'brick' ? mats.frame : wall;
    box(cx, top + ph / 2, z0 + pw / 2, w + 0.1, ph, pw + 0.1, cornice);
    box(cx, top + ph / 2, z1 - pw / 2, w + 0.1, ph, pw + 0.1, cornice);
    box(x0 + pw / 2, top + ph / 2, cz, pw + 0.1, ph, d, cornice);
    box(x1 - pw / 2, top + ph / 2, cz, pw + 0.1, ph, d, cornice);
    for (let k = 0; k < 2 + Math.floor(rnd() * 2); k++) {
      const uw = 1.2 + rnd() * 1.8;
      box(cx + (rnd() - 0.5) * (w - uw - 2), top + 0.5, cz + (rnd() - 0.5) * (d - uw - 2), uw, 0.9, uw * (0.6 + rnd() * 0.6), mats.roofDark);
    }
    if (w > 10 && d > 8) box(cx - w * 0.2, top + 1.2, cz + d * 0.15, 2.4, 2.4, 2.4, mats.roof);
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
    const conifer = !street && rnd() < 0.25;
    const h = (street ? 2.4 : 1.8) + rnd() * 0.6;
    const trunk = MeshBuilder.CreateCylinder('trunk', { diameterTop: 0.22, diameterBottom: 0.34, height: h, tessellation: 6 }, scene);
    trunk.position.set(x, y + h / 2, z);
    b.add(trunk, mats.trunk);
    if (conifer) {
      // Ялина — три яруси конусів.
      const r = 1.5 + rnd() * 0.6;
      for (let k = 0; k < 3; k++) {
        const cone = MeshBuilder.CreateCylinder('cone', { diameterTop: 0, diameterBottom: r * 2 * (1 - k * 0.25), height: 2.2, tessellation: 7 }, scene);
        cone.position.set(x, y + h + 0.6 + k * 1.25, z);
        cone.rotation.y = rnd() * Math.PI;
        b.add(cone, mats.foliage);
      }
      return;
    }
    const r = street ? 1.2 + rnd() * 0.5 : 1.6 + rnd() * 1.1;
    const foliage = rnd() > 0.5 ? mats.foliage : mats.foliage2;
    const crown = MeshBuilder.CreateIcoSphere('crown', { radius: r, subdivisions: 1, flat: true }, scene);
    crown.position.set(x, y + h + r * 0.7, z);
    crown.scaling.y = 0.85;
    crown.rotation.y = rnd() * Math.PI;
    b.add(crown, foliage);
    // Друга, менша «шапка» — крона стає нерівною.
    const a = rnd() * Math.PI * 2;
    const r2 = r * (0.55 + rnd() * 0.2);
    const top = MeshBuilder.CreateIcoSphere('crown2', { radius: r2, subdivisions: 1, flat: true }, scene);
    top.position.set(x + Math.sin(a) * r * 0.45, y + h + r * 1.15, z + Math.cos(a) * r * 0.45);
    b.add(top, foliage);
  }


  /** Припаркований легковик: та сама low-poly модель, що й у руху, але злита зі статикою міста. */
  function parkedParts(paint: StandardMaterial): VehicleParts {
    const c = mats.carParts;
    return {
      paint,
      glass: c.glass,
      trim: c.trim,
      chrome: c.chrome,
      plate: c.plate,
      head: c.head,
      tail: c.tail,
      indL: c.ind,
      indR: c.ind,
      accent: c.tail,
      roof: c.plate,
      sign: c.head,
      beaconA: c.trim,
      beaconB: c.trim,
    };
  }

  function parkedCar(x: number, z: number, heading: number, y: number) {
    const model: CarModel = pick(TRAFFIC_MODELS);
    const parts = parkedParts(pick(mats.carParts.bodies));
    // Модель будується в локальних координатах, потім вершини повертаються й зсуваються на місце.
    const local = new Map<StandardMaterial, FlatGeometry>();
    const wheels = buildCar(model, (mat) => {
      let g = local.get(mat);
      if (!g) local.set(mat, (g = new FlatGeometry()));
      return g;
    }, parts);
    for (const [mat, g] of local) fg(mat).append(g, x, y, z, heading);
    const f = forwardOf(heading);
    const r = rightOf(heading);
    for (const az of wheels.axles)
      for (const sx of [-1, 1])
        fg(mats.carParts.tyre).cylinderX(
          x + f.x * az + r.x * sx * wheels.track,
          y + wheels.radius,
          z + f.z * az + r.z * sx * wheels.track,
          wheels.radius,
          wheels.width,
          10,
          heading,
        );
  }

  /** Тротуар кварталу із заокругленими кутами, бордюром і швами плитки. */
  function sidewalkBlock(x0: number, z0: number, x1: number, z1: number) {
    const R = 1.8;
    const seg = 4;
    const outline = (inset: number): Array<[number, number]> => {
      const r = R - inset;
      const pts: Array<[number, number]> = [];
      const corners: Array<[number, number, number]> = [
        [x1 - R, z1 - R, 0],
        [x1 - R, z0 + R, Math.PI / 2],
        [x0 + R, z0 + R, Math.PI],
        [x0 + R, z1 - R, -Math.PI / 2],
      ];
      for (const [ccx, ccz, a0] of corners)
        for (let i = 0; i <= seg; i++) {
          const a = a0 + (i / seg) * (Math.PI / 2);
          pts.push([ccx + Math.sin(a) * r, ccz + Math.cos(a) * r]);
        }
      return pts;
    };
    const outer = outline(0);
    const inner = outline(0.22);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const inside: V3 = [cx, 0, cz];
    fg(mats.sidewalk).poly(inner.map(([x, z]): V3 => [x, CURB, z]), [cx, -1, cz]);
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ax, az] = outer[i];
      const [bx, bz] = outer[j];
      fg(mats.curb).poly([[ax, 0, az], [bx, 0, bz], [bx, CURB + 0.02, bz], [ax, CURB + 0.02, az]], inside);
      fg(mats.curb).poly([[ax, CURB + 0.02, az], [bx, CURB + 0.02, bz], [inner[j][0], CURB + 0.02, inner[j][1]], [inner[i][0], CURB + 0.02, inner[i][1]]], [cx, -1, cz]);
    }
    // Шви плитки поперек тротуару.
    for (let p = x0 + 3; p < x1 - 3; p += 1.6)
      for (const z of [z0 + 0.22, z1 - 0.22 - SW]) fg(mats.joint).quad([p, CURB + 0.004, z + SW / 2], [0.03, 0, 0], [0, 0, SW / 2], [0, 1, 0]);
    for (let p = z0 + 3; p < z1 - 3; p += 1.6)
      for (const x of [x0 + 0.22, x1 - 0.22 - SW]) fg(mats.joint).quad([x + SW / 2, CURB + 0.004, p], [SW / 2, 0, 0], [0, 0, 0.03], [0, 1, 0]);
  }

  // ---------- Розмітка ----------
  /** Біля перехресть із зебрами осьова лінія закінчується раніше. */
  const isSignal = (x: number, z: number) => world.wideNodes.some((s) => s.x === x && s.z === z);
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
  for (const c of world.crosswalks) {
    for (let k = -HW + 0.5; k <= HW - 0.4; k += 1.0) {
      if (c.roadAlongX) box(c.x, MARK_Y, c.z + k, c.width, 0.01, 0.5, mats.marking);
      else box(c.x + k, MARK_Y, c.z, 0.5, 0.01, c.width, mats.marking);
    }
  }
  // Стоп-лінії на регульованих перехрестях (права половина дороги перед зеброю).
  for (const s of world.signals) {
    const d = HW + 2.2 + 1.5 + 0.45;
    box(s.x + HW / 2, MARK_Y, s.z - d, HW, 0.01, 0.4, mats.marking);
    box(s.x - HW / 2, MARK_Y, s.z + d, HW, 0.01, 0.4, mats.marking);
    box(s.x + d, MARK_Y, s.z + HW / 2, 0.4, 0.01, HW, mats.marking);
    box(s.x - d, MARK_Y, s.z - HW / 2, 0.4, 0.01, HW, mats.marking);
  }
  // Лінія «Дати дорогу» — трикутники вершиною до водія; перед знаком «STOP» — суцільна стоп-лінія.
  for (const g of world.lines) {
    const f = forwardOf(g.heading);
    const r = rightOf(g.heading);
    if (g.kind === 'stop') {
      box(g.x - f.x * 0.2, MARK_Y, g.z - f.z * 0.2, Math.abs(r.x) * HW + Math.abs(f.x) * 0.4, 0.01, Math.abs(r.z) * HW + Math.abs(f.z) * 0.4, mats.marking);
      continue;
    }
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
    ...world.crosswalks.map((c) => ({ x: c.x, z: c.z, r: 9 })),
    ...world.signs.map((s) => ({ x: s.x, z: s.z, r: 3 })),
    ...DRIVEWAYS.map((d) => ({ x: d.x, z: d.z, r: 6 })),
    ...world.avoid,
  ];
  const free = (x: number, z: number) => avoid.every((a) => Math.hypot(a.x - x, a.z - z) > a.r);
  for (let i = 0; i < RX.length - 1; i++)
    for (let j = 0; j < RZ.length - 1; j++) {
      const x0 = RX[i] + HW + 1.7;
      const x1 = RX[i + 1] - HW - 1.7;
      const z0 = RZ[j] + HW + 1.7;
      const z1 = RZ[j + 1] - HW - 1.7;
      for (let p = 12; p < x1 - x0 - 10; p += 13) {
        if (free(x0 + p, z0)) streetTree(x0 + p, z0);
        if (free(x0 + p, z1)) streetTree(x0 + p, z1);
      }
      for (let p = 12; p < z1 - z0 - 10; p += 13) {
        if (free(x0, z0 + p)) streetTree(x0, z0 + p);
        if (free(x1, z0 + p)) streetTree(x1, z0 + p);
      }
      // Ліхтарі — між деревами, біля бордюру, плафоном над дорогою.
      const ex = RX[i] + HW + 0.5;
      const ez = RZ[j] + HW + 0.5;
      for (let p = 18.5; p < x1 - x0 - 10; p += 26) if (free(x0 + p, ez)) streetLamp(x0 + p, ez, 0, -1);
      for (let p = 18.5; p < z1 - z0 - 10; p += 26) if (free(ex, z0 + p)) streetLamp(ex, z0 + p, -1, 0);
    }

  function streetTree(x: number, z: number) {
    fg(mats.soil).quad([x, CURB + 0.008, z], [0.65, 0, 0], [0, 0, 0.65], [0, 1, 0]);
    tree(x, z, CURB, true);
  }

  function streetLamp(x: number, z: number, dx: number, dz: number) {
    const h = 6.2;
    const pole = MeshBuilder.CreateCylinder('lampPole', { diameterTop: 0.1, diameterBottom: 0.16, height: h, tessellation: 6 }, scene);
    pole.position.set(x, CURB + h / 2, z);
    b.add(pole, mats.pole);
    const arm = 1.5;
    box(x + (dx * arm) / 2, CURB + h - 0.05, z + (dz * arm) / 2, dx ? arm : 0.08, 0.08, dz ? arm : 0.08, mats.pole);
    box(x + dx * arm, CURB + h - 0.12, z + dz * arm, dx ? 0.7 : 0.32, 0.12, dz ? 0.7 : 0.32, mats.pole);
    box(x + dx * arm, CURB + h - 0.19, z + dz * arm, dx ? 0.6 : 0.24, 0.03, dz ? 0.6 : 0.24, mats.lamp);
  }

  // ---------- Латки асфальту й люки ----------
  const nearSpecial = (x: number, z: number) =>
    world.crosswalks.some((c) => Math.hypot(c.x - x, c.z - z) < 7) || world.props.some((p) => Math.hypot(p.x - x, p.z - z) < 6);
  for (const x of RX)
    for (let j = 0; j < RZ.length - 1; j++)
      for (let k = 0; k < 3; k++) {
        const z = RZ[j] + 12 + rnd() * (RZ[j + 1] - RZ[j] - 24);
        const lx = x + (rnd() < 0.5 ? -1 : 1) * CITY.laneOffset;
        if (nearSpecial(lx, z)) continue;
        if (k === 0) roadDisc(lx, z);
        else flat(lx - 0.5 - rnd() * 0.6, z, lx + 0.5 + rnd() * 0.6, z + 1.5 + rnd() * 3, 0.008, mats.patch);
      }
  for (const z of RZ)
    for (let i = 0; i < RX.length - 1; i++)
      for (let k = 0; k < 3; k++) {
        const x = RX[i] + 12 + rnd() * (RX[i + 1] - RX[i] - 24);
        const lz = z + (rnd() < 0.5 ? -1 : 1) * CITY.laneOffset;
        if (nearSpecial(x, lz)) continue;
        if (k === 0) roadDisc(x, lz);
        else flat(x, lz - 0.5 - rnd() * 0.6, x + 1.5 + rnd() * 3, lz + 0.5 + rnd() * 0.6, 0.008, mats.patch);
      }
  function roadDisc(x: number, z: number) {
    const disc = MeshBuilder.CreateDisc('manhole', { radius: 0.38, tessellation: 10 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(x, 0.012, z);
    b.add(disc, mats.manhole);
  }

  // ---------- Дорожні знаки ----------
  for (const s of world.signs) {
    const pole = MeshBuilder.CreateCylinder('pole', { diameter: 0.09, height: 2.5, tessellation: 6 }, scene);
    pole.position.set(s.x, CURB + 1.25, s.z);
    b.add(pole, mats.pole);
    const f = forwardOf(s.facing);
    const r = rightOf(s.facing);
    const y0 = CURB + 2.35;
    /** dx, dy — зсув деталі на табличці (праворуч і вгору, як бачить водій). */
    const plate = (mesh: Mesh, mat: StandardMaterial, off: number, rotZ: number, dx = 0, dy = 0) => {
      mesh.rotation.set(0, s.facing, rotZ);
      mesh.position.set(s.x - f.x * (0.06 + off) + r.x * dx, y0 + dy, s.z - f.z * (0.06 + off) + r.z * dx);
      b.add(mesh, mat);
    };
    const disc = (rad: number, tess: number) => MeshBuilder.CreateDisc('sign', { radius: rad, tessellation: tess, sideOrientation: Mesh.DOUBLESIDE }, scene);
    const rect = (w: number, h: number) => MeshBuilder.CreatePlane('sign', { width: w, height: h, sideOrientation: Mesh.DOUBLESIDE }, scene);
    /** Стрілка: стрижень і трикутний наконечник; up — вістрям угору. */
    const arrow = (mat: StandardMaterial, off: number, dx: number, up: boolean) => {
      const k = up ? 1 : -1;
      plate(rect(0.07, 0.34), mat, off, 0, dx, -0.06 * k);
      plate(disc(0.1, 3), mat, off, (k * Math.PI) / 2, dx, 0.15 * k);
    };
    switch (s.kind) {
      case 'giveWay':
        plate(disc(0.62, 3), mats.signRed, 0, -Math.PI / 2);
        plate(disc(0.42, 3), mats.signWhite, 0.01, -Math.PI / 2);
        break;
      case 'stop':
        plate(disc(0.5, 8), mats.signWhite, 0, Math.PI / 8);
        plate(disc(0.45, 8), mats.signRed, 0.01, Math.PI / 8);
        plate(rect(0.5, 0.12), mats.signWhite, 0.02, 0);
        break;
      case 'mainRoad':
        plate(disc(0.5, 4), mats.signWhite, 0, 0);
        plate(disc(0.38, 4), mats.signYellow, 0.01, 0);
        break;
      case 'yieldOncoming':
        plate(disc(0.45, 16), mats.signRed, 0, 0);
        plate(disc(0.37, 16), mats.signWhite, 0.01, 0);
        arrow(mats.signBlack, 0.02, -0.1, true);
        arrow(mats.signRed, 0.02, 0.1, false);
        break;
      case 'priorityOncoming':
        plate(rect(0.75, 0.75), mats.signBlue, 0, 0);
        arrow(mats.signWhite, 0.01, -0.12, true);
        arrow(mats.signRed, 0.01, 0.12, false);
        break;
      case 'roadworks':
        plate(disc(0.62, 3), mats.signRed, 0, Math.PI / 2);
        plate(disc(0.45, 3), mats.signWhite, 0.01, Math.PI / 2);
        plate(rect(0.08, 0.22), mats.signBlack, 0.02, 0.5, 0, -0.02);
        plate(rect(0.3, 0.05), mats.signBlack, 0.02, 0, 0, -0.16);
        break;
      case 'busStop':
        plate(rect(0.7, 0.7), mats.signBlue, 0, 0);
        plate(rect(0.48, 0.24), mats.signWhite, 0.01, 0, 0, 0.04);
        plate(rect(0.4, 0.06), mats.signBlue, 0.02, 0, 0, 0.08);
        break;
      case 'crosswalk':
        plate(rect(0.85, 0.85), mats.signBlue, 0, 0);
        plate(disc(0.36, 3), mats.signWhite, 0.01, Math.PI / 2);
        break;
    }
  }

  // ---------- Антураж ситуацій ----------
  const onRoad = (x: number, z: number) => RX.some((v) => Math.abs(v - x) <= HW) || RZ.some((v) => Math.abs(v - z) <= HW);
  for (const p of world.props) {
    const y = onRoad(p.x, p.z) ? 0 : CURB;
    const f = forwardOf(p.heading);
    const r = rightOf(p.heading);
    /** Бокс у локальних координатах предмета: a — уздовж heading, c — убік. */
    const part = (a: number, c: number, yy: number, len: number, h: number, w: number, mat: StandardMaterial) =>
      box(p.x + f.x * a + r.x * c, y + yy, p.z + f.z * a + r.z * c, w, h, len, mat, p.heading);
    switch (p.kind) {
      case 'barrier':
        // Червоно-біла балка на двох ніжках.
        for (let k = 0; k < 6; k++) part(-1.25 + 0.21 + k * 0.42, 0, 0.85, 0.42, 0.24, 0.1, k % 2 ? mats.signWhite : mats.signRed);
        for (const a of [-1.1, 1.1]) part(a, 0, 0.36, 0.08, 0.72, 0.5, mats.pole);
        break;
      case 'cone': {
        const cone = MeshBuilder.CreateCylinder('cone', { diameterTop: 0.06, diameterBottom: 0.38, height: 0.72, tessellation: 8 }, scene);
        cone.position.set(p.x, y + 0.36, p.z);
        b.add(cone, mats.coneOrange);
        part(0, 0, 0.42, 0.25, 0.08, 0.25, mats.signWhite);
        part(0, 0, 0.02, 0.45, 0.04, 0.45, mats.coneOrange);
        break;
      }
      case 'triangle': {
        const tri = MeshBuilder.CreateDisc('warn', { radius: 0.3, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE }, scene);
        tri.rotation.set(0, p.heading + Math.PI, Math.PI / 2);
        tri.position.set(p.x, y + 0.24, p.z);
        b.add(tri, mats.signRed);
        part(0, 0, 0.02, 0.3, 0.03, 0.06, mats.pole);
        break;
      }
      case 'shelter':
        // Павільйон зупинки: дах, задня скляна стінка, стійки й лавка.
        part(0, 0, 2.45, 3.6, 0.1, 1.6, mats.roofDark);
        part(0, -0.7, 1.3, 3.4, 2.1, 0.06, mats.window);
        for (const a of [-1.7, 1.7]) part(a, -0.7, 1.2, 0.1, 2.4, 0.1, mats.pole);
        part(0, -0.35, 0.45, 2.4, 0.08, 0.4, mats.trunk);
        break;
      case 'kiosk':
        part(0, 0, 1.25, 2.4, 2.5, 2.0, mats.walls[2]);
        part(0, 0, 2.6, 2.7, 0.2, 2.3, mats.awnings[1]);
        part(0, -1.01, 1.4, 1.6, 0.9, 0.02, mats.shop);
        break;
    }
  }

  // ---------- Світлофори ----------
  const lampMats = new Map<string, StandardMaterial>();
  const lb = new Batcher();
  for (const sig of world.signals) {
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
  trafficLights.update(Object.fromEntries(world.signals.map((s) => [s.id, s.initial])));

  for (const [mat, g] of geos) if (!g.empty) b.add(g.toMesh('detail', scene), mat);

  const receivers = shadows
    ? new Set([mats.grass, mats.grassDark, mats.asphalt, mats.parking, mats.sidewalk, mats.paving, mats.marking])
    : new Set<StandardMaterial>();
  b.flush(receivers);
  const meshes = scene.meshes.filter((m) => !meshesBefore.has(m));
  const materials = scene.materials.filter((m) => !materialsBefore.has(m));
  return {
    trafficLights,
    dispose() {
      for (const m of meshes) m.dispose(false, false);
      for (const m of materials) m.dispose();
    },
  };
}
