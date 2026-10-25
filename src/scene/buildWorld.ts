import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { OBB } from '../sim/collision';
import type { Pose } from '../sim/math';
import { headingOf, rightOf } from '../sim/math';
import type { Track } from '../sim/track';
import { poseAt, seededRandom } from '../sim/track';
import { CAR } from '../config';
import { COLORS, makeMaterial } from './palette';

/** Збирає статичні меші за матеріалом і зливає їх — кілька draw call замість сотень. */
class Batcher {
  private groups = new Map<StandardMaterial, Mesh[]>();
  add(mesh: Mesh, mat: StandardMaterial) {
    let g = this.groups.get(mat);
    if (!g) this.groups.set(mat, (g = []));
    g.push(mesh);
    return mesh;
  }

  flush(receiveShadows: Set<StandardMaterial>): Mesh[] {
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
      mat.freeze();
    }
    this.groups.clear();
    return out;
  }
}

export interface WorldView {
  zoneMaterial: StandardMaterial;
  shadowReceivers: Mesh[];
}

const ROAD_Y = 0.03;
const MARK_Y = 0.045;

export function buildWorld(scene: Scene, track: Track): WorldView {
  const b = new Batcher();
  const m = (name: string, hex: string, emissive = 0.12) => makeMaterial(scene, name, hex, emissive);
  const mats = {
    grass: m('grass', COLORS.grass, 0.05),
    pad: m('pad', COLORS.grassDark, 0.05),
    asphalt: m('asphalt', COLORS.asphalt, 0.06),
    marking: m('marking', COLORS.marking, 0.35),
    curbLight: m('curbLight', COLORS.curbLight),
    curbDark: m('curbDark', COLORS.curbDark),
    cone: m('cone', COLORS.cone, 0.25),
    coneStripe: m('coneStripe', COLORS.coneStripe, 0.3),
    trunk: m('trunk', COLORS.trunk),
    foliage: m('foliage', COLORS.foliage),
    foliage2: m('foliage2', COLORS.foliage2),
    wall: m('wall', COLORS.wall, 0.15),
    wall2: m('wall2', COLORS.wall2, 0.15),
    roof: m('roof', COLORS.roof),
    window: m('window', COLORS.window, 0.2),
    fence: m('fence', COLORS.fence),
    barrier: m('barrier', COLORS.barrier, 0.2),
    barrierStripe: m('barrierStripe', COLORS.barrierStripe, 0.2),
    signBlue: m('signBlue', COLORS.signBlue, 0.25),
  };
  for (const k of ['grass', 'pad', 'asphalt', 'marking'] as const) mats[k].backFaceCulling = false;

  // Земля.
  const ground = MeshBuilder.CreateGround('ground', { width: 420, height: 420, subdivisions: 1 }, scene);
  ground.position.set(25, 0, 27);
  b.add(ground, mats.grass);
  const { minX, maxX, minZ, maxZ } = track.bounds;
  const pad = MeshBuilder.CreateGround('pad', { width: maxX - minX, height: maxZ - minZ }, scene);
  pad.position.set((minX + maxX) / 2, 0.01, (minZ + maxZ) / 2);
  b.add(pad, mats.pad);

  const line = track.centerline;
  const pointHeading = (i: number) => {
    const a = line[Math.max(0, i - 1)];
    const c = line[Math.min(line.length - 1, i + 1)];
    return headingOf(c.x - a.x, c.z - a.z);
  };
  const offset = (x: number, z: number, heading: number, lat: number, y: number) => {
    const r = rightOf(heading);
    return new Vector3(x + r.x * lat, y, z + r.z * lat);
  };
  const strip = (poses: Pose[], latA: number, latB: number, y: number, name: string) =>
    MeshBuilder.CreateRibbon(
      name,
      {
        pathArray: [
          poses.map((p) => offset(p.x, p.z, p.heading, latA, y)),
          poses.map((p) => offset(p.x, p.z, p.heading, latB, y)),
        ],
      },
      scene,
    );
  const sampleRange = (s0: number, s1: number, step = 0.5): Pose[] => {
    const out: Pose[] = [];
    for (let s = s0; s < s1; s += step) out.push(poseAt(line, s));
    out.push(poseAt(line, s1));
    return out;
  };

  // Дорога і розмітка.
  const linePoses = line.map((p, i) => ({ x: p.x, z: p.z, heading: pointHeading(i) }));
  const hw = track.halfWidth;
  b.add(strip(linePoses, -hw, hw, ROAD_Y, 'road'), mats.asphalt);
  b.add(strip(linePoses, -hw + 0.15, -hw + 0.3, MARK_Y, 'edgeL'), mats.marking);
  b.add(strip(linePoses, hw - 0.3, hw - 0.15, MARK_Y, 'edgeR'), mats.marking);
  for (let s = 1; s < track.length - 3; s += 5) {
    if (s + 2.5 > track.zoneS.start - 1 && s < track.zoneS.end + 1) continue;
    b.add(strip(sampleRange(s, s + 2.5), -0.07, 0.07, MARK_Y, 'dash'), mats.marking);
  }
  // Суцільна осьова біля зони зупинки.
  b.add(strip(sampleRange(track.zoneS.start - 1, track.zoneS.end + 1), -0.07, 0.07, MARK_Y, 'solid'), mats.marking);
  // Стоп-лінія старту — перед бампером авто.
  const startLineS = track.startS + CAR.length / 2 + 0.5;
  b.add(strip(sampleRange(startLineS, startLineS + 0.35, 0.35), 0.1, hw - 0.3, MARK_Y, 'startLine'), mats.marking);

  // Бордюри — чергування світлих і темних блоків уздовж країв.
  let n = 0;
  for (let s = 0.5; s < track.length - 0.5; s += 1, n++) {
    for (const side of [-1, 1]) {
      const p = poseAt(line, s, side * (hw + 0.15));
      const curb = MeshBuilder.CreateBox('curb', { width: 0.3, height: 0.14, depth: 0.96 }, scene);
      curb.position.set(p.x, 0.07, p.z);
      curb.rotation.y = p.heading;
      b.add(curb, n % 2 === 0 ? mats.curbLight : mats.curbDark);
    }
  }

  const boxFor = (o: OBB, h: number, name: string, y0 = 0) => {
    const box = MeshBuilder.CreateBox(name, { width: o.halfWidth * 2, depth: o.halfLength * 2, height: h }, scene);
    box.position.set(o.x, y0 + h / 2, o.z);
    box.rotation.y = o.heading;
    return box;
  };

  const rnd = seededRandom(11);
  for (const o of track.obstacles) {
    if (o.shape === 'circle' && o.kind === 'cone') {
      const { x, z, r } = o.circle;
      const cone = MeshBuilder.CreateCylinder('cone', { diameterTop: 0.05, diameterBottom: r * 2, height: o.height, tessellation: 8 }, scene);
      cone.position.set(x, o.height / 2, z);
      b.add(cone, mats.cone);
      const stripe = MeshBuilder.CreateCylinder('coneStripe', { diameterTop: r * 0.95, diameterBottom: r * 1.2, height: 0.1, tessellation: 8 }, scene);
      stripe.position.set(x, o.height * 0.45, z);
      b.add(stripe, mats.coneStripe);
    } else if (o.shape === 'circle' && o.kind === 'tree') {
      const { x, z, r } = o.circle;
      const trunk = MeshBuilder.CreateCylinder('trunk', { diameter: r * 2, height: 1.7, tessellation: 6 }, scene);
      trunk.position.set(x, 0.85, z);
      b.add(trunk, mats.trunk);
      const h = o.height - 1.4;
      const w = 2.2 + rnd() * 1.2;
      const crown = MeshBuilder.CreateCylinder('crown', { diameterTop: 0, diameterBottom: w, height: h, tessellation: 7 }, scene);
      crown.position.set(x, 1.4 + h / 2, z);
      crown.rotation.y = rnd() * Math.PI;
      b.add(crown, rnd() > 0.5 ? mats.foliage : mats.foliage2);
    } else if (o.shape === 'circle' && o.kind === 'sign') {
      const { x, z, r } = o.circle;
      const pole = MeshBuilder.CreateCylinder('pole', { diameter: r * 2, height: o.height, tessellation: 6 }, scene);
      pole.position.set(x, o.height / 2, z);
      b.add(pole, mats.curbDark);
      buildParkingSign(scene, b, mats.signBlue, mats.marking, x, z, track.zone.heading, o.height);
    } else if (o.shape === 'box' && o.kind === 'building') {
      const { box } = o;
      b.add(boxFor(box, o.height, 'building'), rnd() > 0.5 ? mats.wall : mats.wall2);
      // Двосхилий дах: трикутна призма з гребенем уздовж довгої осі.
      const roofH = Math.min(2.2, box.halfWidth * 0.7);
      const roof = MeshBuilder.CreateCylinder('roof', { diameter: 1, height: box.halfLength * 2 + 0.4, tessellation: 3 }, scene);
      roof.scaling.set(roofH / 0.75, 1, (box.halfWidth * 2 + 0.4) / 0.866);
      roof.rotation.set(0, box.heading - Math.PI / 2, Math.PI / 2);
      roof.position.set(box.x, o.height + 0.25 * (roofH / 0.75), box.z);
      b.add(roof, mats.roof);
      // Вікна — смуги на довгих фасадах.
      const floors = Math.max(1, Math.floor(o.height / 3));
      for (let f = 0; f < floors; f++) {
        for (const side of [-1, 1]) {
          const win: OBB = {
            x: box.x + rightOf(box.heading).x * side * (box.halfWidth + 0.02),
            z: box.z + rightOf(box.heading).z * side * (box.halfWidth + 0.02),
            heading: box.heading,
            halfLength: box.halfLength * 0.8,
            halfWidth: 0.03,
          };
          b.add(boxFor(win, 1.0, 'win', 1.2 + f * 3), mats.window);
        }
      }
    } else if (o.shape === 'box' && o.kind === 'fence') {
      b.add(boxFor(o.box, o.height, 'fence'), mats.fence);
    } else if (o.shape === 'box' && o.kind === 'barrier') {
      const { box } = o;
      const segs = 8;
      const r = rightOf(box.heading);
      const segW = (box.halfWidth * 2) / segs;
      for (let i = 0; i < segs; i++) {
        const lat = -box.halfWidth + segW * (i + 0.5);
        const seg: OBB = { x: box.x + r.x * lat, z: box.z + r.z * lat, heading: box.heading, halfLength: box.halfLength, halfWidth: segW / 2 };
        b.add(boxFor(seg, o.height, 'barrier'), i % 2 === 0 ? mats.barrierStripe : mats.barrier);
      }
    }
  }

  // Зона зупинки: напівпрозора заливка + білі межі.
  const zone = track.zone;
  const zoneMaterial = makeMaterial(scene, 'zone', COLORS.zone, 0.4);
  zoneMaterial.alpha = 0.32;
  zoneMaterial.backFaceCulling = false;
  const fill = MeshBuilder.CreateGround('zoneFill', { width: zone.halfWidth * 2, height: zone.halfLength * 2 }, scene);
  fill.position.set(zone.x, 0.055, zone.z);
  fill.rotation.y = zone.heading;
  fill.material = zoneMaterial;
  fill.isPickable = false;
  const lw = 0.12;
  const f = { x: Math.sin(zone.heading), z: Math.cos(zone.heading) };
  const r = rightOf(zone.heading);
  const zoneLine = (along: number, across: number, hl: number, hwid: number) => {
    const o: OBB = {
      x: zone.x + f.x * along + r.x * across,
      z: zone.z + f.z * along + r.z * across,
      heading: zone.heading,
      halfLength: hl,
      halfWidth: hwid,
    };
    b.add(boxFor(o, 0.012, 'zoneLine', MARK_Y), mats.marking);
  };
  zoneLine(zone.halfLength - lw / 2, 0, lw / 2, zone.halfWidth);
  zoneLine(-zone.halfLength + lw / 2, 0, lw / 2, zone.halfWidth);
  zoneLine(0, zone.halfWidth - lw / 2, zone.halfLength, lw / 2);
  zoneLine(0, -zone.halfWidth + lw / 2, zone.halfLength, lw / 2);

  const receivers = new Set([mats.grass, mats.pad, mats.asphalt, mats.marking]);
  const meshes = b.flush(receivers);
  return { zoneMaterial, shadowReceivers: meshes.filter((x) => x.receiveShadows) };
}

function buildParkingSign(
  scene: Scene,
  b: Batcher,
  blue: StandardMaterial,
  white: StandardMaterial,
  x: number,
  z: number,
  heading: number,
  height: number,
) {
  const r = rightOf(heading);
  const f = { x: Math.sin(heading), z: Math.cos(heading) };
  const y0 = height - 0.4;
  // Табличка кріпиться перед стовпом з боку водія, що під'їжджає.
  x -= f.x * 0.12;
  z -= f.z * 0.12;
  const board = MeshBuilder.CreateBox('signBoard', { width: 0.7, height: 0.7, depth: 0.04 }, scene);
  board.position.set(x, y0, z);
  board.rotation.y = heading;
  b.add(board, blue);
  // Літера «P» на боці, зверненому до водія, що під'їжджає.
  const part = (lx: number, ly: number, w: number, h: number) => {
    const p = MeshBuilder.CreateBox('signP', { width: w, height: h, depth: 0.02 }, scene);
    p.position.set(x + r.x * lx - f.x * 0.03, y0 + ly, z + r.z * lx - f.z * 0.03);
    p.rotation.y = heading;
    b.add(p, white);
  };
  part(-0.1, 0, 0.08, 0.46);
  part(0.0, 0.19, 0.28, 0.08);
  part(0.0, 0.0, 0.28, 0.08);
  part(0.12, 0.095, 0.08, 0.2);
}
