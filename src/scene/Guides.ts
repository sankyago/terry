import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Path } from '../sim/path';
import { poseOnPath } from '../sim/path';
import { makeMaterial } from './palette';

interface Marker {
  root: TransformNode;
  ring: Mesh;
}

/**
 * Підказки на паузі ситуації: пульсуюче кільце й стрілка напрямку під кожним учасником
 * та «шеврони» наміченої траєкторії авто учня.
 */
export class Guides {
  private markers: Marker[] = [];
  private chevrons: Mesh[] = [];
  private ringMat: StandardMaterial;
  private chevronMat: StandardMaterial;
  private active = false;

  constructor(private scene: Scene) {
    this.ringMat = makeMaterial(scene, 'guideRing', '#ffb020', 0.9);
    this.ringMat.alpha = 0.85;
    this.ringMat.disableLighting = true;
    this.chevronMat = makeMaterial(scene, 'guideChevron', '#ffffff', 1);
    this.chevronMat.alpha = 0.75;
    this.chevronMat.disableLighting = true;
    this.chevronMat.backFaceCulling = false;
    for (let i = 0; i < 12; i++) {
      const c = MeshBuilder.CreateDisc('chevron', { radius: 0.55, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE }, scene);
      c.material = this.chevronMat;
      c.isPickable = false;
      c.setEnabled(false);
      this.chevrons.push(c);
    }
  }

  private marker(i: number): Marker {
    while (this.markers.length <= i) {
      const root = new TransformNode('guide', this.scene);
      const ring = MeshBuilder.CreateTorus('guideRing', { diameter: 1, thickness: 0.08, tessellation: 32 }, this.scene);
      ring.material = this.ringMat;
      ring.parent = root;
      ring.isPickable = false;
      const arrow = MeshBuilder.CreateDisc('guideArrow', { radius: 0.7, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      arrow.material = this.ringMat;
      arrow.parent = root;
      arrow.rotation.set(Math.PI / 2, -Math.PI / 2, 0);
      arrow.isPickable = false;
      root.setEnabled(false);
      this.markers.push({ root, ring });
    }
    return this.markers[i];
  }

  /** actors — поточні положення учасників; size — діаметр кільця. */
  show(egoPath: Path, fromS: number, toS: number, actors: Array<{ x: number; z: number; heading: number; size: number }>) {
    this.active = true;
    actors.forEach((a, i) => {
      const m = this.marker(i);
      m.root.setEnabled(true);
      m.root.position.set(a.x, 0.22, a.z);
      m.root.rotation.y = a.heading;
      m.ring.scaling.set(a.size, a.size, a.size);
      m.root.getChildMeshes()[1].position.set(0, 0, a.size / 2 + 0.9);
    });
    for (let i = actors.length; i < this.markers.length; i++) this.markers[i].root.setEnabled(false);
    const n = this.chevrons.length;
    const step = Math.max(1.6, (toS - fromS) / n);
    this.chevrons.forEach((c, i) => {
      const s = fromS + 3.5 + i * step;
      if (s > toS) {
        c.setEnabled(false);
        return;
      }
      const p = poseOnPath(egoPath, s);
      c.setEnabled(true);
      c.position.set(p.x, 0.2, p.z);
      // Диск лежить на землі, вершиною вздовж руху.
      c.rotation.set(Math.PI / 2, p.heading - Math.PI / 2, 0);
    });
  }

  hide() {
    if (!this.active) return;
    this.active = false;
    for (const m of this.markers) m.root.setEnabled(false);
    for (const c of this.chevrons) c.setEnabled(false);
  }

  update(clock: number) {
    if (!this.active) return;
    const k = 0.5 + 0.5 * Math.sin(clock * 5);
    this.ringMat.alpha = 0.5 + 0.45 * k;
    this.chevronMat.alpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(clock * 5 + 1.5));
  }
}
