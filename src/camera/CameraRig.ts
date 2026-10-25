import type { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CameraMode } from '../storage/storage';
import type { Pose, Vec2 } from '../sim/math';
import { forwardOf, lerpAngle, rightOf } from '../sim/math';

export type RigMode = CameraMode | 'orbit';

/** Кут нахилу камери до землі — вид згори під 45°. */
const PITCH = Math.PI / 4;
const BASE_DIST = 40;

export interface CameraFocus {
  point: Vec2;
  /** Частка зсуву центру кадру від авто до точки (0..1). */
  weight: number;
  dist: number;
}

export interface CameraFrame {
  focus: CameraFocus | null;
  /** Напрямок, за яким повертається камера «за авто» (під час ДТП — зафіксований). */
  heading: number;
  /** Частка ширини кадру, закрита панеллю праворуч: кадр зсувається вліво. */
  rightInset: number;
}

/**
 * Камера над містом під 45°. «follow» повертається слідом за авто (зручно визначати «праворуч/ліворуч»),
 * «north» — північ завжди вгорі. Під час ситуації кадр зсувається до точки конфлікту.
 */
export class CameraRig {
  readonly camera: FreeCamera;
  mode: RigMode = 'orbit';
  private yaw = 0;
  private dist = BASE_DIST;
  private look = new Vector3();
  private orbitAngle = 0.4;
  private snapNext = true;
  private shake = 0;
  private inset = 0;
  /** Співвідношення сторін кадру (ширина / висота). */
  aspect = 16 / 9;

  constructor(
    scene: Scene,
    private orbitCenter: Vec2,
  ) {
    this.camera = new FreeCamera('cam', new Vector3(0, 40, -40), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.5;
    this.camera.maxZ = 700;
    this.camera.fov = 0.72;
  }

  setMode(mode: RigMode) {
    if (mode !== this.mode) this.snapNext = true;
    this.mode = mode;
  }

  snap() {
    this.snapNext = true;
  }

  kick(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  update(pose: Pose, dt: number, frame: CameraFrame) {
    const { focus } = frame;
    const cam = this.camera;
    if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.05;
      const { x, z } = this.orbitCenter;
      const d = 95;
      cam.position.set(x - Math.sin(this.orbitAngle) * d * Math.cos(PITCH), d * Math.sin(PITCH), z - Math.cos(this.orbitAngle) * d * Math.cos(PITCH));
      cam.setTarget(new Vector3(x, 0, z));
      return;
    }
    const f = forwardOf(frame.heading);
    let tx = pose.x + f.x * 6;
    let tz = pose.z + f.z * 6;
    let dist = BASE_DIST;
    if (focus) {
      tx += (focus.point.x - tx) * focus.weight;
      tz += (focus.point.z - tz) * focus.weight;
      dist = focus.dist;
    }
    const targetYaw = this.mode === 'follow' ? frame.heading : 0;
    if (this.snapNext) {
      this.yaw = targetYaw;
      this.look.set(tx, 0, tz);
      this.dist = dist;
      this.snapNext = false;
    } else {
      this.yaw = lerpAngle(this.yaw, targetYaw, 1 - Math.exp(-2.2 * dt));
      const k = 1 - Math.exp(-3 * dt);
      this.look.x += (tx - this.look.x) * k;
      this.look.z += (tz - this.look.z) * k;
      this.dist += (dist - this.dist) * (1 - Math.exp(-2 * dt));
    }
    const cf = forwardOf(this.yaw);
    const back = this.dist * Math.cos(PITCH);
    // Зсув під бічну панель: дивимося правіше, і сцена з'їжджає вліво.
    this.inset += (frame.rightInset - this.inset) * (1 - Math.exp(-4 * dt));
    const halfW = this.dist * Math.tan(this.camera.fov / 2) * this.aspect;
    const lx = this.look.x + rightOf(this.yaw).x * halfW * this.inset;
    const lz = this.look.z + rightOf(this.yaw).z * halfW * this.inset;
    let sx = 0;
    let sy = 0;
    if (this.shake > 0.001) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-5 * dt);
    }
    cam.position.set(lx - cf.x * back + sx, this.dist * Math.sin(PITCH) + sy, lz - cf.z * back + sx);
    cam.setTarget(new Vector3(lx + sx * 0.5, 0, lz + sx * 0.5));
  }
}
