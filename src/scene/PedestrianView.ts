import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Pose } from '../sim/math';
import type { MaterialCache } from './palette';
import { COLORS } from './palette';

let counter = 0;

/** Пішохід із простою анімацією ходьби; після наїзду падає. */
export class PedestrianView {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private tilt: TransformNode;
  private legs: TransformNode[] = [];
  private arms: TransformNode[] = [];

  constructor(scene: Scene, cache: MaterialCache, shirt: string, pants = '#3a4250', cane = false) {
    const id = counter++;
    this.root = new TransformNode(`ped${id}`, scene);
    this.tilt = new TransformNode(`pedTilt${id}`, scene);
    this.tilt.parent = this.root;
    const add = (m: Mesh, mat: StandardMaterial, parent: TransformNode) => {
      m.material = mat;
      m.parent = parent;
      m.isPickable = false;
      this.meshes.push(m);
      return m;
    };
    const shirtM = cache.get(shirt, 0.2);
    const pantsM = cache.get(pants, 0.1);
    const skin = cache.get(COLORS.skin, 0.2);

    for (const s of [-1, 1]) {
      const hip = new TransformNode('hip', scene);
      hip.parent = this.tilt;
      hip.position.set(s * 0.11, 0.9, 0);
      const leg = MeshBuilder.CreateBox('leg', { width: 0.14, height: 0.9, depth: 0.16 }, scene);
      leg.position.y = -0.45;
      add(leg, pantsM, hip);
      this.legs.push(hip);
      const sh = new TransformNode('shoulder', scene);
      sh.parent = this.tilt;
      sh.position.set(s * 0.27, 1.45, 0);
      const arm = MeshBuilder.CreateBox('arm', { width: 0.1, height: 0.62, depth: 0.12 }, scene);
      arm.position.y = -0.3;
      add(arm, shirtM, sh);
      this.arms.push(sh);
    }
    const torso = MeshBuilder.CreateBox('torso', { width: 0.44, height: 0.62, depth: 0.26 }, scene);
    torso.position.y = 1.2;
    add(torso, shirtM, this.tilt);
    const headM = MeshBuilder.CreateSphere('head', { diameter: 0.26, segments: 6 }, scene);
    headM.position.y = 1.66;
    add(headM, skin, this.tilt);
    if (cane) {
      // Біла тростина в правій руці, нахилена вперед до землі.
      const stick = MeshBuilder.CreateBox('cane', { width: 0.04, height: 1.15, depth: 0.04 }, scene);
      stick.position.set(0.02, -0.75, 0.25);
      stick.rotation.x = 0.45;
      add(stick, cache.get('#f7f7f2', 0.5), this.arms[1]);
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

  /** phase — пройдена відстань (м) для кроку; fall — 0..1, частка падіння. */
  update(pose: Pose, phase: number, moving: boolean, fall: number, scale = 1) {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.y = pose.heading;
    this.root.scaling.setAll(scale);
    const swing = moving && fall === 0 ? Math.sin(phase * 4.2) * 0.55 : 0;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.8;
    this.arms[1].rotation.x = swing * 0.8;
    // Падіння вперед навколо стоп.
    this.tilt.rotation.x = fall * (Math.PI / 2 - 0.1);
    this.tilt.position.y = fall * 0.12;
  }

  dispose() {
    this.root.dispose(false, false);
  }
}
