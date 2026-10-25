import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CAR } from '../config';
import type { Pose } from '../sim/math';
import { COLORS, makeMaterial } from './palette';

export interface CarVisualState {
  steerAngle: number;
  steer: number;
  wheelSpin: number;
  braking: boolean;
  reversing: boolean;
  leftLit: boolean;
  rightLit: boolean;
}

/**
 * Low-poly модель авто. Усі розміри взяті з CAR, тож корпус точно збігається
 * з колайдером (4,63 × 1,85 м у плані).
 */
export class CarView {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private frontPivots: TransformNode[] = [];
  private spinNodes: TransformNode[] = [];
  private wheel: Mesh;
  private roof: Mesh;
  private tail: StandardMaterial;
  private reverse: StandardMaterial;
  private indL: StandardMaterial;
  private indR: StandardMaterial;
  private lastLights = '';

  constructor(scene: Scene, withBlobShadow: boolean) {
    this.root = new TransformNode('car', scene);
    const L = CAR.length;
    const W = CAR.width;
    const halfL = L / 2;
    const halfW = W / 2;
    const bodyBottom = CAR.groundClearance;
    const bodyTop = 0.8;

    const body = makeMaterial(scene, 'carBody', COLORS.carBody, 0.15);
    const glass = makeMaterial(scene, 'carGlass', COLORS.carGlass, 0.05);
    glass.specularColor = new Color3(0.4, 0.45, 0.5);
    const tyre = makeMaterial(scene, 'tyre', COLORS.tyre, 0.02);
    const rim = makeMaterial(scene, 'rim', COLORS.rim, 0.2);
    const dark = makeMaterial(scene, 'carDark', '#2b3136', 0.05);
    const head = makeMaterial(scene, 'headlight', '#fff7d6', 0.9);
    this.tail = makeMaterial(scene, 'taillight', '#c81e2b', 0.35);
    this.reverse = makeMaterial(scene, 'reverse', '#7d858a', 0.2);
    this.indL = makeMaterial(scene, 'indL', '#a65a12', 0.2);
    this.indR = makeMaterial(scene, 'indR', '#a65a12', 0.2);

    const add = (mesh: Mesh, mat: StandardMaterial, parent: TransformNode = this.root) => {
      mesh.material = mat;
      mesh.parent = parent;
      mesh.isPickable = false;
      this.meshes.push(mesh);
      return mesh;
    };
    const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial) => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      return add(m, mat);
    };

    // Нижня частина кузова: точно L × W.
    box('body', W, bodyTop - bodyBottom, L, 0, (bodyTop + bodyBottom) / 2, 0, body);

    // Салон — трапеція з нахиленим лобовим склом (видно, де перед).
    const cabinH = CAR.height - bodyTop - 0.05;
    const cabin = MeshBuilder.CreateBox('cabin', { width: W - 0.24, height: cabinH, depth: 2.35 }, scene);
    const pos = cabin.getVerticesData('position')!;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 1] > 0) pos[i + 2] = pos[i + 2] > 0 ? pos[i + 2] - 0.55 : pos[i + 2] + 0.35;
    }
    const idx = cabin.getIndices()!;
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, idx, normals);
    cabin.setVerticesData('position', pos);
    cabin.setVerticesData('normal', normals);
    cabin.position.set(0, bodyTop + cabinH / 2, -0.2);
    add(cabin, glass);
    // Дах у кольорі кузова.
    this.roof = box('roof', W - 0.34, 0.05, 1.45, 0, CAR.height - 0.025, -0.3, body);
    // Капот: легкий підйом, щоб силует читався.
    box('hood', W - 0.3, 0.04, 1.1, 0, bodyTop + 0.02, 1.55, body);

    // Світло. Глибина 0.03 — повністю всередині габариту.
    const zf = halfL - 0.015;
    box('grille', 0.9, 0.16, 0.03, 0, 0.42, zf, dark);
    for (const s of [-1, 1]) {
      box('head', 0.42, 0.1, 0.03, s * 0.55, 0.64, zf, head);
      box('tail', 0.44, 0.11, 0.03, s * 0.58, 0.67, -zf, this.tail);
      box('rev', 0.14, 0.07, 0.03, s * 0.24, 0.67, -zf, this.reverse);
      const ind = s < 0 ? this.indL : this.indR;
      box('indF', 0.14, 0.09, 0.03, s * (halfW - 0.08), 0.64, zf, ind);
      box('indR', 0.18, 0.12, 0.03, s * (halfW - 0.1), 0.67, -zf, ind);
      box('indSide', 0.03, 0.06, 0.18, s * (halfW - 0.015), 0.7, 1.55, ind);
    }

    // Колеса: передні — у шарнірах повороту.
    const wx = halfW - CAR.wheelWidth / 2 - 0.02;
    const wz = CAR.wheelbase / 2;
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
      const pivot = new TransformNode('wheelPivot', scene);
      pivot.parent = this.root;
      pivot.position.set(sx * wx, CAR.wheelRadius, sz * wz);
      const spin = new TransformNode('wheelSpin', scene);
      spin.parent = pivot;
      const t = MeshBuilder.CreateCylinder('tyre', { diameter: CAR.wheelRadius * 2, height: CAR.wheelWidth, tessellation: 12 }, scene);
      t.rotation.z = Math.PI / 2;
      add(t, tyre, spin);
      const hub = MeshBuilder.CreateBox('hub', { width: 0.02, height: CAR.wheelRadius * 1.1, depth: 0.12 }, scene);
      hub.position.x = sx * (CAR.wheelWidth / 2);
      add(hub, rim, spin);
      if (sz > 0) this.frontPivots.push(pivot);
      this.spinNodes.push(spin);
    }

    // Інтер'єр для виду з місця водія (зовні його не видно крізь тоновані вікна).
    box('dash', W - 0.3, 0.08, 0.3, 0, bodyTop + 0.04, 0.75, dark);
    this.wheel = MeshBuilder.CreateTorus('steeringWheel', { diameter: 0.36, thickness: 0.03, tessellation: 16 }, scene);
    const wheelPivot = new TransformNode('steerPivot', scene);
    wheelPivot.parent = this.root;
    wheelPivot.position.set(-0.38, 0.9, 0.42);
    wheelPivot.rotation.x = -1.15;
    add(this.wheel, dark, wheelPivot);

    if (withBlobShadow) {
      const blob = MeshBuilder.CreateGround('blob', { width: W + 0.3, height: L + 0.3 }, scene);
      const bm = makeMaterial(scene, 'blob', '#1d2a30', 0);
      bm.alpha = 0.22;
      blob.position.y = 0.06;
      add(blob, bm);
    }
  }

  /** У виді з місця водія ховаємо дах, щоб його нижня грань не закривала огляд. */
  setDriverView(driver: boolean) {
    this.roof.isVisible = !driver;
  }

  get casters(): Mesh[] {
    return this.meshes.filter((m) => m.name !== 'blob');
  }

  update(pose: Pose, s: CarVisualState) {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.heading;
    for (const p of this.frontPivots) p.rotation.y = s.steerAngle;
    for (const n of this.spinNodes) n.rotation.x = s.wheelSpin;
    this.wheel.rotation.y = s.steer * 2.2;

    const key = `${s.braking}${s.reversing}${s.leftLit}${s.rightLit}`;
    if (key === this.lastLights) return;
    this.lastLights = key;
    this.tail.emissiveColor = s.braking ? new Color3(1, 0.15, 0.15) : new Color3(0.45, 0.06, 0.08);
    this.reverse.emissiveColor = s.reversing ? new Color3(1, 1, 1) : new Color3(0.25, 0.25, 0.26);
    const on = new Color3(1, 0.62, 0.1);
    const off = new Color3(0.2, 0.11, 0.03);
    this.indL.emissiveColor = s.leftLit ? on : off;
    this.indR.emissiveColor = s.rightLit ? on : off;
  }
}
