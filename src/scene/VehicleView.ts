import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CAR } from '../config';
import type { ActorKind } from '../sim/kinds';
import { KINDS } from '../sim/kinds';
import type { Pose } from '../sim/math';
import type { IndicatorState } from '../sim/sim';
import type { MaterialCache } from './palette';
import { FlatGeometry } from './geometry';
import { COLORS, makeMaterial } from './palette';
import type { CarModel, VehicleParts } from './vehicleModels';
import { buildAmbulance, buildBus, buildCar } from './vehicleModels';

export type VehicleKind = 'coupe' | Exclude<ActorKind, 'pedestrian'>;

/** Колісна база автобуса (м). */
const BUS_WHEELBASE = 6.2;

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

let counter = 0;

/** Low-poly транспорт. Габарити збігаються з колайдерами симуляції. */
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

  constructor(
    scene: Scene,
    cache: MaterialCache,
    readonly kind: VehicleKind,
    color: string,
    withBlobShadow: boolean,
    model: CarModel = 'sedan',
  ) {
    const id = counter++;
    this.root = new TransformNode(`veh${id}`, scene);
    this.body = new TransformNode(`vehBody${id}`, scene);
    this.body.parent = this.root;

    const own = (name: string, hex: string, e: number) => {
      const m = makeMaterial(scene, `${name}${id}`, hex, e);
      this.mats.push(m);
      return m;
    };
    this.tail = own('tail', '#c81e2b', 0.35);
    this.indL = own('indL', '#a65a12', 0.2);
    this.indR = own('indR', '#a65a12', 0.2);
    if (kind === 'ambulance') {
      this.beaconA = own('beaconA', '#1a4fd8', 0.3);
      this.beaconB = own('beaconB', '#1a4fd8', 0.3);
    }
    const parts: VehicleParts = {
      paint: cache.get(color, 0.16),
      glass: cache.get(COLORS.carGlass, 0.08),
      trim: cache.get(COLORS.carTrim, 0.04),
      chrome: cache.get(COLORS.rim, 0.25),
      plate: cache.get('#f1f3f0', 0.35),
      head: cache.get('#fff7d6', 0.9),
      tail: this.tail,
      indL: this.indL,
      indR: this.indR,
      accent: cache.get('#d8343a', 0.25),
      roof: cache.get('#eef1f1', 0.15),
      sign: cache.get('#ffb347', 0.8),
      beaconA: this.beaconA ?? this.tail,
      beaconB: this.beaconB ?? this.tail,
    };

    // Кузов збирається в одну сітку на матеріал — кілька draw call на машину.
    const geos = new Map<StandardMaterial, FlatGeometry>();
    const geo = (m: StandardMaterial) => {
      let g = geos.get(m);
      if (!g) geos.set(m, (g = new FlatGeometry()));
      return g;
    };
    const wheels =
      kind === 'ambulance'
        ? buildAmbulance(geo, parts)
        : kind === 'bus'
          ? buildBus(geo, parts, [BUS_WHEELBASE / 2 + 0.4, -BUS_WHEELBASE / 2 + 0.4])
          : buildCar(kind === 'coupe' ? 'coupe' : model, geo, parts);
    const add = (mesh: Mesh, mat: StandardMaterial, parent: TransformNode = this.body) => {
      mesh.material = mat;
      mesh.parent = parent;
      mesh.isPickable = false;
      this.meshes.push(mesh);
      return mesh;
    };
    for (const [mat, g] of geos) add(g.toMesh(`vb${id}`, scene), mat);

    // Колеса: шина, диск і спиця (щоб було видно обертання); передні — у шарнірах повороту.
    const tyre = cache.get(COLORS.tyre, 0.02);
    const rim = cache.get(COLORS.rim, 0.2);
    const hub = cache.get(COLORS.carTrim, 0.05);
    const { radius: r, width: ww, track } = wheels;
    for (const [ai, wz] of wheels.axles.entries())
      for (const sx of [-1, 1]) {
        const pivot = new TransformNode('wheelPivot', scene);
        pivot.parent = this.body;
        pivot.position.set(sx * track, r, wz);
        const spin = new TransformNode('wheelSpin', scene);
        spin.parent = pivot;
        const t = MeshBuilder.CreateCylinder('tyre', { diameter: r * 2, height: ww, tessellation: 12 }, scene);
        t.rotation.z = Math.PI / 2;
        add(t, tyre, spin);
        const disc = MeshBuilder.CreateCylinder('rim', { diameter: r * 1.3, height: ww + 0.012, tessellation: 8 }, scene);
        disc.rotation.z = Math.PI / 2;
        add(disc, rim, spin);
        const spoke = MeshBuilder.CreateBox('hub', { width: 0.02, height: r * 1.2, depth: 0.09 }, scene);
        spoke.position.x = sx * (ww / 2 + 0.008);
        add(spoke, hub, spin);
        if (ai === 0) this.frontPivots.push(pivot);
        this.spinNodes.push(spin);
      }

    if (withBlobShadow) {
      const d = kind === 'bus' ? KINDS.bus : kind === 'ambulance' ? KINDS.ambulance : kind === 'coupe' ? CAR : KINDS.car;
      const blob = MeshBuilder.CreateGround('blob', { width: d.width + 0.4, height: d.length + 0.4 }, scene);
      const bm = cache.get('#1d2a30', 0);
      bm.alpha = 0.22;
      blob.position.y = 0.06;
      add(blob, bm, this.root);
    }
  }

  get casters(): Mesh[] {
    return this.meshes.filter((m) => m.name !== 'blob');
  }

  private alpha = 1;
  /** Плавна поява й зникнення на краях траєкторії. */
  setAlpha(a: number) {
    if (a === this.alpha || (a < 1 && Math.abs(a - this.alpha) < 0.02)) return;
    this.alpha = a;
    for (const m of this.meshes) m.visibility = a;
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
