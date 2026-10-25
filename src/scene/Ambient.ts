import type { Scene } from '@babylonjs/core/scene';
import type { Vec2 } from '../sim/math';
import { headingOf, lerpAngle } from '../sim/math';
import { seededRandom } from '../sim/random';
import type { MaterialCache } from './palette';
import { PedestrianView } from './PedestrianView';

/** Відрізки тротуарів далеко від сценаріїв — тут гуляють перехожі. */
const WALKS: Array<[Vec2, Vec2]> = [
  [{ x: 100, z: 95 }, { x: 168, z: 95 }],
  [{ x: 185, z: 100 }, { x: 185, z: 168 }],
  [{ x: 100, z: 175 }, { x: 168, z: 175 }],
  [{ x: 102, z: 185.5 }, { x: 170, z: 185.5 }],
  [{ x: 12, z: 185.5 }, { x: 80, z: 185.5 }],
  [{ x: 12, z: 175 }, { x: 80, z: 175 }],
  [{ x: 95, z: 100 }, { x: 95, z: 168 }],
  [{ x: 100, z: 85 }, { x: 168, z: 85 }],
  [{ x: -5, z: 100 }, { x: -5, z: 168 }],
  [{ x: -80, z: 185.5 }, { x: -12, z: 185.5 }],
  [{ x: 175, z: 100 }, { x: 175, z: 168 }],
  [{ x: 30, z: 95 }, { x: 80, z: 95 }],
];
const SHIRTS = ['#e4572e', '#2f9e6e', '#3b6fd8', '#f2c14e', '#9b59b6', '#16a3b8', '#ec6f9a', '#56636b'];

interface Walker {
  view: PedestrianView;
  a: Vec2;
  b: Vec2;
  len: number;
  t: number;
  dir: 1 | -1;
  speed: number;
  heading: number;
}

/** Перехожі лише для атмосфери: не беруть участі в симуляції й не перетинають дорогу. */
export class Ambient {
  private walkers: Walker[] = [];

  constructor(scene: Scene, cache: MaterialCache) {
    const rnd = seededRandom(5);
    for (const [a, b] of WALKS) {
      const count = 1 + Math.floor(rnd() * 2);
      for (let k = 0; k < count; k++) {
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const view = new PedestrianView(scene, cache, SHIRTS[Math.floor(rnd() * SHIRTS.length)]);
        const dir = rnd() > 0.5 ? 1 : -1;
        this.walkers.push({ view, a, b, len, t: rnd() * len, dir, speed: 1.1 + rnd() * 0.5, heading: 0 });
      }
    }
  }

  update(dt: number) {
    for (const w of this.walkers) {
      w.t += w.dir * w.speed * dt;
      if (w.t > w.len) {
        w.t = w.len;
        w.dir = -1;
      } else if (w.t < 0) {
        w.t = 0;
        w.dir = 1;
      }
      const k = w.t / w.len;
      const target = headingOf((w.b.x - w.a.x) * w.dir, (w.b.z - w.a.z) * w.dir);
      w.heading = lerpAngle(w.heading, target, 1 - Math.exp(-8 * dt));
      // Зсув убік, щоб зустрічні не проходили одне крізь одного.
      const side = w.dir * 0.5;
      const nx = -(w.b.z - w.a.z) / w.len;
      const nz = (w.b.x - w.a.x) / w.len;
      w.view.update(
        { x: w.a.x + (w.b.x - w.a.x) * k + nx * side, z: w.a.z + (w.b.z - w.a.z) * k + nz * side, heading: w.heading },
        w.t,
        true,
        0,
        1.15,
      );
    }
  }
}
