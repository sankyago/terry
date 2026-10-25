import type { Scene } from '@babylonjs/core/scene';
import { CITY } from '../config';
import type { WorldFeatures } from '../sim/city';
import type { Vec2 } from '../sim/math';
import { headingOf, lerpAngle } from '../sim/math';
import { seededRandom } from '../sim/random';
import type { MaterialCache } from './palette';
import { PedestrianView } from './PedestrianView';

const RX = CITY.roadsX;
const RZ = CITY.roadsZ;

/** Відрізки тротуарів уздовж маршруту, але далеко від ситуацій — тут гуляють перехожі. */
function walks(world: WorldFeatures, route: Vec2[], rnd: () => number, count: number): Array<[Vec2, Vec2]> {
  const d = CITY.roadHalfWidth + CITY.sidewalk / 2;
  const all: Array<[Vec2, Vec2]> = [];
  for (let i = 0; i < RX.length - 1; i++)
    for (let j = 0; j < RZ.length - 1; j++) {
      const x0 = RX[i] + d;
      const x1 = RX[i + 1] - d;
      const z0 = RZ[j] + d;
      const z1 = RZ[j + 1] - d;
      all.push(
        [{ x: x0 + 10, z: z0 }, { x: x1 - 10, z: z0 }],
        [{ x: x0 + 10, z: z1 }, { x: x1 - 10, z: z1 }],
        [{ x: x0, z: z0 + 10 }, { x: x0, z: z1 - 10 }],
        [{ x: x1, z: z0 + 10 }, { x: x1, z: z1 - 10 }],
      );
    }
  const far = (p: Vec2) =>
    world.open.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > o.r + 12) &&
    world.avoid.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > 15);
  // Точки маршруту через кожні ~10 м: перехожих видно лише поблизу авто учня.
  const along: Vec2[] = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 10));
    for (let k = 0; k <= n; k++) along.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  const visible = (p: Vec2) => along.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 12);
  const ok = all.filter(
    ([a, b]) =>
      visible({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }) &&
      [0, 0.25, 0.5, 0.75, 1].every((t) => far({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })),
  );
  for (let i = ok.length - 1; i > 0; i--) {
    const k = Math.floor(rnd() * (i + 1));
    [ok[i], ok[k]] = [ok[k], ok[i]];
  }
  return ok.slice(0, count);
}
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

  constructor(scene: Scene, cache: MaterialCache, world: WorldFeatures, route: Vec2[], seed: number) {
    const rnd = seededRandom(seed);
    for (const [a, b] of walks(world, route, rnd, 14)) {
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

  dispose() {
    for (const w of this.walkers) w.view.dispose();
    this.walkers = [];
  }
}
