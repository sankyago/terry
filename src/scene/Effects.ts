import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { makeMaterial } from './palette';

interface Particle {
  mesh: Mesh;
  mat?: StandardMaterial;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  age: number;
  life: number;
  size: number;
  grow: number;
}

/** Ефекти ДТП: спалах, уламки й скло з гравітацією та дим, що повільно розходиться. */
export class Effects {
  private smoke: Particle[] = [];
  private debris: Particle[] = [];
  private debrisMats: StandardMaterial[] = [];
  private flash: Mesh;
  private flashMat: StandardMaterial;
  private flashAge = 99;
  private smokeEmit = 0;
  private emitAt = { x: 0, z: 0 };

  constructor(private scene: Scene) {
    this.flashMat = makeMaterial(scene, 'flash', '#fff2c4', 1);
    this.flashMat.alpha = 0;
    this.flashMat.disableLighting = true;
    this.flash = MeshBuilder.CreateDisc('flash', { radius: 1, tessellation: 24 }, scene);
    this.flash.rotation.x = Math.PI / 2;
    this.flash.material = this.flashMat;
    this.flash.isPickable = false;
    this.flash.setEnabled(false);
  }

  /** strength — відносна швидкість удару (м/с). */
  burst(x: number, z: number, strength: number, pedestrian: boolean) {
    this.clear();
    this.flashAge = 0;
    this.flash.position.set(x, 0.6, z);
    this.flash.setEnabled(true);
    this.emitAt = { x, z };
    this.smokeEmit = pedestrian ? 0.6 : 2.2;
    const n = pedestrian ? 6 : Math.min(36, 14 + Math.round(strength * 2));
    const colors = ['#cfe3ea', '#a9c4cf', '#2b3136', '#e4572e', '#d9dcd8'];
    const mats = colors.map((c, i) => makeMaterial(this.scene, `deb${i}`, c, 0.3));
    this.debrisMats = mats;
    for (let i = 0; i < n; i++) {
      const s = 0.08 + Math.random() * 0.18;
      const mesh = MeshBuilder.CreateBox('debris', { width: s, height: s * 0.4, depth: s * 1.4 }, this.scene);
      mesh.material = mats[i % mats.length];
      mesh.isPickable = false;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * (2 + strength * 0.4);
      this.debris.push({
        mesh,
        x,
        y: 0.6 + Math.random() * 0.4,
        z,
        vx: Math.cos(a) * sp,
        vy: 2 + Math.random() * 4,
        vz: Math.sin(a) * sp,
        spin: (Math.random() - 0.5) * 20,
        age: 0,
        life: 6,
        size: s,
        grow: 0,
      });
    }
  }

  private puff() {
    const mesh = MeshBuilder.CreateSphere('smoke', { diameter: 1, segments: 4 }, this.scene);
    const mat = makeMaterial(this.scene, 'smokeM', Math.random() > 0.4 ? '#9aa3a8' : '#6f777c', 0.35);
    mat.alpha = 0.55;
    mesh.material = mat;
    mesh.isPickable = false;
    this.smoke.push({
      mesh,
      mat,
      x: this.emitAt.x + (Math.random() - 0.5) * 1.6,
      y: 0.7,
      z: this.emitAt.z + (Math.random() - 0.5) * 1.6,
      vx: (Math.random() - 0.5) * 0.8,
      vy: 0.9 + Math.random() * 0.8,
      vz: (Math.random() - 0.5) * 0.8,
      spin: 0,
      age: 0,
      life: 2.6 + Math.random() * 1.6,
      size: 0.8 + Math.random() * 0.6,
      grow: 1.2 + Math.random() * 0.8,
    });
  }

  update(dt: number) {
    if (this.flashAge < 0.5) {
      this.flashAge += dt;
      const k = Math.min(1, this.flashAge / 0.5);
      this.flash.scaling.setAll(1 + k * 6);
      this.flashMat.alpha = 0.85 * (1 - k);
      if (k >= 1) this.flash.setEnabled(false);
    }
    if (this.smokeEmit > 0) {
      this.smokeEmit -= dt;
      if (Math.random() < dt * 14) this.puff();
    }
    for (const p of this.debris) {
      p.age += dt;
      if (p.y > p.size * 0.2 || p.vy > 0) {
        p.vy -= 9.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.mesh.rotation.x += p.spin * dt;
        p.mesh.rotation.y += p.spin * 0.7 * dt;
        if (p.y < p.size * 0.2) {
          p.y = p.size * 0.2;
          p.vy = -p.vy * 0.25;
          p.vx *= 0.5;
          p.vz *= 0.5;
          p.spin *= 0.4;
          if (Math.abs(p.vy) < 0.4) p.vy = 0;
        }
      }
      p.mesh.position.set(p.x, p.y, p.z);
    }
    for (const p of this.smoke) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy *= Math.exp(-0.6 * dt);
      const k = p.age / p.life;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.scaling.setAll(p.size + p.grow * p.age);
      if (p.mat) p.mat.alpha = 0.55 * Math.max(0, 1 - k);
    }
    this.smoke = this.smoke.filter((p) => {
      if (p.age < p.life) return true;
      p.mesh.dispose();
      p.mat?.dispose();
      return false;
    });
  }

  clear() {
    for (const p of [...this.smoke, ...this.debris]) {
      p.mesh.dispose();
      p.mat?.dispose();
    }
    for (const m of this.debrisMats) m.dispose();
    this.debrisMats = [];
    this.smoke = [];
    this.debris = [];
    this.smokeEmit = 0;
    this.flash.setEnabled(false);
    this.flashAge = 99;
  }
}
