import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CAR } from '../config';
import type { ActorKind } from '../sim/kinds';
import { KINDS } from '../sim/kinds';
import type { Pose } from '../sim/math';
import type { IndicatorState } from '../sim/sim';
import type { MaterialCache } from './palette';
import { COLORS, makeMaterial } from './palette';

export type VehicleKind = 'coupe' | Exclude<ActorKind, 'pedestrian'>;

export interface VehicleVisualState {
  steerAngle: number;
  wheelSpin: number;
  braking: boolean;
  indicator: IndicatorState;
  /** Годинник рендера (с) — для блимання. */
  clock: number;
  siren: boolean;
  /** Підскок кузова після удару (м). */
  bounce: number;
}

interface Dims {
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  wheelRadius: number;
}

const DIMS: Record<VehicleKind, Dims> = {
  coupe: { length: CAR.length, width: CAR.width, height: CAR.height, wheelbase: CAR.wheelbase, wheelRadius: CAR.wheelRadius },
  car: { length: KINDS.car.length, width: KINDS.car.width, height: 1.46, wheelbase: 2.7, wheelRadius: 0.32 },
  ambulance: { length: KINDS.ambulance.length, width: KINDS.ambulance.width, height: 2.55, wheelbase: 3.6, wheelRadius: 0.36 },
  bus: { length: KINDS.bus.length, width: KINDS.bus.width, height: 3.1, wheelbase: 6.2, wheelRadius: 0.5 },
};

let counter = 0;

/** Low-poly транспорт. Розміри збігаються з колайдерами симуляції. */
export class VehicleView {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private body: TransformNode;
  private frontPivots: TransformNode[] = [];
  private spinNodes: TransformNode[] = [];
  private tail: StandardMaterial;
  private indL: StandardMaterial;
  private indR: StandardMaterial;
  private beaconA: StandardMaterial | null = null;
  private beaconB: StandardMaterial | null = null;
  private lastLights = '';
  private mats: StandardMaterial[] = [];

  constructor(scene: Scene, cache: MaterialCache, readonly kind: VehicleKind, color: string, withBlobShadow: boolean) {
    const id = counter++;
    this.root = new TransformNode(`veh${id}`, scene);
    this.body = new TransformNode(`vehBody${id}`, scene);
    this.body.parent = this.root;
    const d = DIMS[kind];
    const L = d.length;
    const W = d.width;
    const halfL = L / 2;
    const halfW = W / 2;

    const paint = cache.get(color, 0.16);
    const glass = cache.get(COLORS.carGlass, 0.05);
    const tyre = cache.get(COLORS.tyre, 0.02);
    const rim = cache.get(COLORS.rim, 0.2);
    const dark = cache.get('#2b3136', 0.05);
    const head = cache.get('#fff7d6', 0.9);
    const own = (name: string, hex: string, e: number) => {
      const m = makeMaterial(scene, `${name}${id}`, hex, e);
      this.mats.push(m);
      return m;
    };
    this.tail = own('tail', '#c81e2b', 0.35);
    this.indL = own('indL', '#a65a12', 0.2);
    this.indR = own('indR', '#a65a12', 0.2);

    const add = (mesh: Mesh, mat: StandardMaterial, parent: TransformNode = this.body) => {
      mesh.material = mat;
      mesh.parent = parent;
      mesh.isPickable = false;
      this.meshes.push(mesh);
      return mesh;
    };
    const box = (w: number, h: number, dp: number, x: number, y: number, z: number, mat: StandardMaterial) => {
      const m = MeshBuilder.CreateBox('vb', { width: w, height: h, depth: dp }, scene);
      m.position.set(x, y, z);
      return add(m, mat);
    };
    /** Салон-трапеція: верх звужено спереду й ззаду (нахилене скло). */
    const cabin = (w: number, h: number, dp: number, y: number, z: number, front: number, back: number) => {
      const c = MeshBuilder.CreateBox('cabin', { width: w, height: h, depth: dp }, scene);
      const pos = c.getVerticesData('position')!;
      for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] > 0) pos[i + 2] = pos[i + 2] > 0 ? pos[i + 2] - front : pos[i + 2] + back;
      const normals: number[] = [];
      VertexData.ComputeNormals(pos, c.getIndices()!, normals);
      c.setVerticesData('position', pos);
      c.setVerticesData('normal', normals);
      c.position.set(0, y + h / 2, z);
      return add(c, glass);
    };

    const zf = halfL - 0.015;
    if (kind === 'coupe' || kind === 'car') {
      const bodyBottom = 0.16;
      const bodyTop = kind === 'coupe' ? 0.78 : 0.82;
      box(W, bodyTop - bodyBottom, L, 0, (bodyTop + bodyBottom) / 2, 0, paint);
      const cabinH = d.height - bodyTop - 0.05;
      if (kind === 'coupe') {
        // Купе: короткий низький салон, пологе заднє скло, довгий капот.
        cabin(W - 0.22, cabinH, 2.3, bodyTop, -0.35, 0.65, 0.6);
        box(W - 0.4, 0.05, 1.0, 0, d.height - 0.025, -0.4, paint);
        box(W - 0.3, 0.04, 1.25, 0, bodyTop + 0.02, 1.55, paint);
        // Широка «однорамкова» решітка радіатора.
        box(0.78, 0.26, 0.03, 0, 0.42, zf, dark);
      } else {
        cabin(W - 0.24, cabinH, 2.4, bodyTop, -0.15, 0.5, 0.4);
        box(W - 0.36, 0.05, 1.45, 0, d.height - 0.025, -0.2, paint);
        box(0.9, 0.16, 0.03, 0, 0.45, zf, dark);
      }
      for (const s of [-1, 1]) {
        box(0.4, 0.1, 0.03, s * 0.56, 0.64, zf, head);
        box(0.44, 0.11, 0.03, s * 0.56, 0.68, -zf, this.tail);
        const ind = s < 0 ? this.indL : this.indR;
        box(0.14, 0.09, 0.03, s * (halfW - 0.08), 0.64, zf, ind);
        box(0.16, 0.12, 0.03, s * (halfW - 0.1), 0.68, -zf, ind);
        // Повторювачі на крилах — видно згори.
        box(0.05, 0.06, 0.22, s * (halfW - 0.02), 0.72, 1.45, ind);
      }
    } else if (kind === 'ambulance') {
      const white = paint;
      const red = cache.get('#d8343a', 0.25);
      box(W, 0.9, L, 0, 0.65, 0, white);
      // Кабіна спереду + високий кузов-фургон.
      cabin(W - 0.1, 0.95, 1.6, 1.1, halfL - 1.05, 0.55, 0);
      box(W, 1.45, L - 1.75, 0, 1.1 + 1.45 / 2, -0.85, white);
      for (const s of [-1, 1]) box(0.02, 0.22, L - 0.3, s * (halfW + 0.005), 1.25, 0, red);
      box(W - 0.6, 0.22, 0.02, 0, 1.6, -zf - 0.005, red);
      // Маячки на даху — дві сині секції, блимають по черзі.
      this.beaconA = own('beaconA', '#1a4fd8', 0.3);
      this.beaconB = own('beaconB', '#1a4fd8', 0.3);
      box(0.5, 0.18, 0.3, -0.35, 2.64, halfL - 1.1, this.beaconA);
      box(0.5, 0.18, 0.3, 0.35, 2.64, halfL - 1.1, this.beaconB);
      box(0.55, 0.12, 0.12, 0, 2.6, -halfL + 0.4, this.beaconB);
      for (const s of [-1, 1]) {
        box(0.36, 0.12, 0.03, s * 0.66, 0.7, zf, head);
        box(0.3, 0.3, 0.03, s * (halfW - 0.2), 0.75, -zf, this.tail);
        const ind = s < 0 ? this.indL : this.indR;
        box(0.16, 0.12, 0.03, s * (halfW - 0.1), 0.7, zf, ind);
      }
      box(0.9, 0.2, 0.03, 0, 0.5, zf, dark);
    } else {
      const top = d.height;
      box(W, top - 0.35, L, 0, 0.35 + (top - 0.35) / 2, 0, paint);
      // Смуга вікон по колу й світлий дах.
      box(W + 0.03, 1.05, L - 1.2, 0, 2.05, -0.2, glass);
      box(W - 0.2, 1.2, 0.04, 0, 1.85, zf + 0.01, glass);
      box(W - 0.3, 0.08, L - 0.6, 0, top + 0.04, 0, cache.get('#eef1f1', 0.15));
      for (const s of [-1, 1]) {
        box(0.34, 0.14, 0.03, s * 0.9, 0.6, zf + 0.02, head);
        box(0.3, 0.3, 0.03, s * (halfW - 0.25), 0.8, -zf, this.tail);
        const ind = s < 0 ? this.indL : this.indR;
        box(0.18, 0.14, 0.03, s * (halfW - 0.12), 0.85, zf + 0.02, ind);
      }
    }

    // Колеса: передні — у шарнірах повороту.
    const r = d.wheelRadius;
    const ww = kind === 'bus' ? 0.32 : CAR.wheelWidth;
    const wx = halfW - ww / 2 - 0.02;
    const axles = kind === 'bus' ? [d.wheelbase / 2 + 0.4, -d.wheelbase / 2 + 0.4] : [d.wheelbase / 2, -d.wheelbase / 2];
    for (const [ai, wz] of axles.entries())
      for (const sx of [-1, 1]) {
        const pivot = new TransformNode('wheelPivot', scene);
        pivot.parent = this.body;
        pivot.position.set(sx * wx, r, wz);
        const spin = new TransformNode('wheelSpin', scene);
        spin.parent = pivot;
        const t = MeshBuilder.CreateCylinder('tyre', { diameter: r * 2, height: ww, tessellation: 12 }, scene);
        t.rotation.z = Math.PI / 2;
        add(t, tyre, spin);
        const hub = MeshBuilder.CreateBox('hub', { width: 0.02, height: r * 1.1, depth: 0.12 }, scene);
        hub.position.x = sx * (ww / 2);
        add(hub, rim, spin);
        if (ai === 0) this.frontPivots.push(pivot);
        this.spinNodes.push(spin);
      }

    if (withBlobShadow) {
      const blob = MeshBuilder.CreateGround('blob', { width: W + 0.4, height: L + 0.4 }, scene);
      const bm = cache.get('#1d2a30', 0);
      bm.alpha = 0.22;
      blob.position.y = 0.06;
      add(blob, bm, this.root);
    }
  }

  get casters(): Mesh[] {
    return this.meshes.filter((m) => m.name !== 'blob');
  }

  setVisible(v: boolean) {
    this.root.setEnabled(v);
  }

  update(pose: Pose, s: VehicleVisualState) {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.heading;
    this.body.position.y = s.bounce;
    for (const p of this.frontPivots) p.rotation.y = s.steerAngle;
    for (const n of this.spinNodes) n.rotation.x = s.wheelSpin;

    const blink = Math.floor(s.clock * 3) % 2 === 0;
    const left = (s.indicator === 'left' || s.indicator === 'hazard') && blink;
    const right = (s.indicator === 'right' || s.indicator === 'hazard') && blink;
    const beacon = s.siren ? Math.floor(s.clock * 6) % 2 : -1;
    const key = `${s.braking}${left}${right}${beacon}`;
    if (key === this.lastLights) return;
    this.lastLights = key;
    this.tail.emissiveColor = s.braking ? new Color3(1, 0.15, 0.15) : new Color3(0.45, 0.06, 0.08);
    const on = new Color3(1, 0.62, 0.1);
    const off = new Color3(0.2, 0.11, 0.03);
    this.indL.emissiveColor = left ? on : off;
    this.indR.emissiveColor = right ? on : off;
    if (this.beaconA && this.beaconB) {
      const lit = new Color3(0.35, 0.6, 1.6);
      const dim = new Color3(0.05, 0.12, 0.35);
      this.beaconA.emissiveColor = beacon === 0 ? lit : dim;
      this.beaconB.emissiveColor = beacon === 1 ? lit : dim;
    }
  }

  dispose() {
    this.root.dispose(false, false);
    for (const m of this.mats) m.dispose();
  }
}
