import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Pose } from '../sim/math';
import type { MaterialCache } from './palette';
import { COLORS } from './palette';

let counter = 0;
const WHEEL_R = 0.34;
/** Відстань між осями коліс (м). */
const BASE = 1.05;

/** Велосипедист: рама з колесами, що обертаються, і вершник, що крутить педалі; після удару падає набік. */
export class CyclistView {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private tilt: TransformNode;
  private wheels: TransformNode[] = [];
  private crank: TransformNode;
  private legs: TransformNode[] = [];

  constructor(scene: Scene, cache: MaterialCache, shirt: string, frame = '#2f3a44') {
    const id = counter++;
    this.root = new TransformNode(`cyc${id}`, scene);
    this.tilt = new TransformNode(`cycTilt${id}`, scene);
    this.tilt.parent = this.root;
    const add = (m: Mesh, mat: StandardMaterial, parent: TransformNode = this.tilt) => {
      m.material = mat;
      m.parent = parent;
      m.isPickable = false;
      this.meshes.push(m);
      return m;
    };
    const tyre = cache.get(COLORS.tyre, 0.02);
    const frameM = cache.get(frame, 0.2);
    const shirtM = cache.get(shirt, 0.2);
    const pantsM = cache.get('#30353d', 0.1);
    const skin = cache.get(COLORS.skin, 0.2);
    const helmet = cache.get('#f2c14e', 0.3);

    for (const z of [-BASE / 2, BASE / 2]) {
      const hub = new TransformNode('cycWheel', scene);
      hub.parent = this.tilt;
      hub.position.set(0, WHEEL_R, z);
      const t = MeshBuilder.CreateTorus('cycTyre', { diameter: WHEEL_R * 2 - 0.05, thickness: 0.06, tessellation: 14 }, scene);
      t.rotation.z = Math.PI / 2;
      add(t, tyre, hub);
      const spoke = MeshBuilder.CreateBox('cycSpoke', { width: 0.02, height: WHEEL_R * 1.9, depth: 0.03 }, scene);
      add(spoke, frameM, hub);
      this.wheels.push(hub);
    }
    // Рама: нижня й верхня труби, підсідельна, вилка, кермо.
    const bar = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w = 0.05) => {
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const m = MeshBuilder.CreateBox('cycBar', { width: w, height: w, depth: len }, scene);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.rotation.set(-Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0)), Math.atan2(x1 - x0, z1 - z0), 0);
      return add(m, frameM);
    };
    const seat = { y: 0.95, z: -0.18 };
    const head = { y: 0.98, z: 0.36 };
    const bb = { y: 0.32, z: 0 };
    bar(0, bb.y, bb.z, 0, seat.y, seat.z);
    bar(0, bb.y, bb.z, 0, head.y, head.z);
    bar(0, seat.y - 0.05, seat.z, 0, head.y, head.z);
    bar(0, bb.y, bb.z, 0, WHEEL_R, -BASE / 2);
    bar(0, seat.y, seat.z, 0, WHEEL_R, -BASE / 2);
    bar(0, head.y, head.z, 0, WHEEL_R, BASE / 2);
    bar(-0.25, head.y + 0.08, head.z, 0.25, head.y + 0.08, head.z, 0.04);
    const saddle = MeshBuilder.CreateBox('cycSaddle', { width: 0.14, height: 0.05, depth: 0.26 }, scene);
    saddle.position.set(0, seat.y + 0.03, seat.z);
    add(saddle, cache.get('#1d2125', 0.05));

    // Вершник: тулуб нахилений уперед, руки до керма.
    const torso = MeshBuilder.CreateBox('cycTorso', { width: 0.4, height: 0.6, depth: 0.24 }, scene);
    torso.position.set(0, seat.y + 0.36, seat.z + 0.16);
    torso.rotation.x = 0.55;
    add(torso, shirtM);
    const headM = MeshBuilder.CreateSphere('cycHead', { diameter: 0.25, segments: 6 }, scene);
    headM.position.set(0, seat.y + 0.74, seat.z + 0.42);
    add(headM, skin);
    const cap = MeshBuilder.CreateSphere('cycHelmet', { diameter: 0.29, segments: 6, slice: 0.5 }, scene);
    cap.position.set(0, seat.y + 0.77, seat.z + 0.42);
    add(cap, helmet);
    for (const s of [-1, 1]) {
      const arm = MeshBuilder.CreateBox('cycArm', { width: 0.09, height: 0.09, depth: 0.5 }, scene);
      arm.position.set(s * 0.2, seat.y + 0.44, seat.z + 0.42);
      arm.rotation.x = 0.5;
      add(arm, shirtM);
    }
    this.crank = new TransformNode('cycCrank', scene);
    this.crank.parent = this.tilt;
    this.crank.position.set(0, bb.y, bb.z);
    for (const s of [-1, 1]) {
      const hip = new TransformNode('cycHip', scene);
      hip.parent = this.tilt;
      hip.position.set(s * 0.12, seat.y, seat.z);
      const leg = MeshBuilder.CreateBox('cycLeg', { width: 0.13, height: 0.68, depth: 0.14 }, scene);
      leg.position.y = -0.34;
      add(leg, pantsM, hip);
      this.legs.push(hip);
    }
  }

  private alpha = 1;
  setAlpha(a: number) {
    if (a === this.alpha) return;
    this.alpha = a;
    for (const m of this.meshes) m.visibility = a;
  }

  setVisible(v: boolean) {
    this.root.setEnabled(v);
  }

  /** dist — пройдена відстань (м) для обертання коліс і педалей; fall — 0..1, частка падіння набік. */
  update(pose: Pose, dist: number, moving: boolean, fall: number, scale = 1) {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.heading;
    this.root.scaling.setAll(scale);
    const a = dist / WHEEL_R;
    for (const w of this.wheels) w.rotation.x = a;
    const pedal = moving && fall === 0 ? a * 0.45 : 0;
    this.legs[0].rotation.x = 0.35 + Math.sin(pedal) * 0.45;
    this.legs[1].rotation.x = 0.35 - Math.sin(pedal) * 0.45;
    this.tilt.rotation.z = fall * (Math.PI / 2 - 0.15);
  }

  dispose() {
    this.root.dispose(false, false);
  }
}
