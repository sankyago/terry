import type { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CameraMode } from '../storage/storage';
import type { Pose } from '../sim/math';
import { forwardOf, rightOf } from '../sim/math';

export type RigMode = CameraMode | 'orbit';

/** Камера від третьої особи з експоненційним згладжуванням, вид з місця водія та обліт для меню. */
export class CameraRig {
  readonly camera: FreeCamera;
  mode: RigMode = 'orbit';
  private pos = new Vector3();
  private look = new Vector3();
  private orbitAngle = -0.6;
  private snapNext = true;

  constructor(
    scene: Scene,
    private orbitCenter: { x: number; z: number },
  ) {
    this.camera = new FreeCamera('cam', new Vector3(0, 10, -20), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.1;
    this.camera.maxZ = 600;
  }

  setMode(mode: RigMode) {
    if (mode !== this.mode) this.snapNext = true;
    this.mode = mode;
    this.camera.fov = mode === 'driver' ? 1.05 : 0.9;
  }

  snap() {
    this.snapNext = true;
  }

  update(pose: Pose, dt: number) {
    const cam = this.camera;
    const f = forwardOf(pose.heading);
    if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.06;
      const { x, z } = this.orbitCenter;
      cam.position.set(x + Math.sin(this.orbitAngle) * 58, 30, z + Math.cos(this.orbitAngle) * 58);
      cam.setTarget(new Vector3(x, 0, z));
      return;
    }
    if (this.mode === 'driver') {
      const r = rightOf(pose.heading);
      // Лівий руль: водій ліворуч від осі авто.
      const ex = pose.x - r.x * 0.38 - f.x * 0.05;
      const ez = pose.z - r.z * 0.38 - f.z * 0.05;
      cam.position.set(ex, 1.2, ez);
      cam.setTarget(new Vector3(ex + f.x * 12, 0.8, ez + f.z * 12));
      return;
    }
    const desired = new Vector3(pose.x - f.x * 7.2, 3.1, pose.z - f.z * 7.2);
    const target = new Vector3(pose.x + f.x * 2.5, 0.9, pose.z + f.z * 2.5);
    if (this.snapNext) {
      this.pos.copyFrom(desired);
      this.look.copyFrom(target);
      this.snapNext = false;
    } else {
      const kp = 1 - Math.exp(-4 * dt);
      const kl = 1 - Math.exp(-9 * dt);
      Vector3.LerpToRef(this.pos, desired, kp, this.pos);
      Vector3.LerpToRef(this.look, target, kl, this.look);
    }
    cam.position.copyFrom(this.pos);
    cam.setTarget(this.look);
  }
}
