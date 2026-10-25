import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';

export type V3 = readonly [number, number, number];

/** Права половина перерізу знизу вгору: [x ≥ 0, y]. Ліва дзеркальна. */
export type Section = ReadonlyArray<readonly [number, number]>;
/** Переріз кузова на відстані z від центру (z — уперед). */
export interface Station {
  z: number;
  s: Section;
}

/**
 * Low-poly сітка з пласким затіненням: кожен трикутник має власні вершини.
 * Трикутники орієнтуються «назовні» відносно заданої внутрішньої точки — без ручного стеження за обходом.
 */
export class FlatGeometry {
  private pos: number[] = [];

  get empty() {
    return this.pos.length === 0;
  }

  tri(a: V3, b: V3, c: V3, inside: V3) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-12) return;
    const ox = (a[0] + b[0] + c[0]) / 3 - inside[0];
    const oy = (a[1] + b[1] + c[1]) / 3 - inside[1];
    const oz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    // У Babylon лицьова сторона — обхід, для якого (a−b)×(c−b) дивиться назовні, тобто протилежний до n.
    if (nx * ox + ny * oy + nz * oz >= 0) this.pos.push(...a, ...c, ...b);
    else this.pos.push(...a, ...b, ...c);
  }

  /** Опуклий многокутник віялом. */
  poly(pts: V3[], inside: V3) {
    for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0], pts[i], pts[i + 1], inside);
  }

  /** Прямокутник із центром c, напівосями u і v; лицем у бік normal. */
  quad(c: V3, u: V3, v: V3, normal: V3) {
    const p = (su: number, sv: number): V3 => [c[0] + u[0] * su + v[0] * sv, c[1] + u[1] * su + v[1] * sv, c[2] + u[2] * su + v[2] * sv];
    const inside: V3 = [c[0] - normal[0], c[1] - normal[1], c[2] - normal[2]];
    this.poly([p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)], inside);
  }

  /**
   * Паралелепіпед: центр, розміри, нахил pitch (передній край піднімається) і курс yaw.
   */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, yaw = 0, pitch = 0) {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy_ = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const v = (lx: number, ly: number, lz: number): V3 => {
      const y = ly * cp + lz * sp;
      const z = -ly * sp + lz * cp;
      return [cx + lx * cy_ + z * sy, cy + y, cz - lx * sy + z * cy_];
    };
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const c: V3 = [cx, cy, cz];
    const corners = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy_) => [-1, 1].map((sz) => v(sx * hw, sy_ * hh, sz * hd))));
    // Індекс кута: (sx>0)*4 + (sy>0)*2 + (sz>0).
    const faces = [
      [0, 1, 3, 2],
      [4, 5, 7, 6],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 3, 7, 5],
    ];
    for (const f of faces) this.poly(f.map((i) => corners[i]), c);
  }

  /** Циліндр з віссю вздовж локальної X (колеса, труби), повернутий на yaw. */
  cylinderX(cx: number, cy: number, cz: number, r: number, len: number, seg = 10, yaw = 0) {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const v = (lx: number, ly: number, lz: number): V3 => [cx + lx * cs + lz * sn, cy + ly, cz - lx * sn + lz * cs];
    const c: V3 = [cx, cy, cz];
    const ring = (lx: number) => Array.from({ length: seg }, (_, i) => v(lx, Math.sin((i / seg) * Math.PI * 2) * r, Math.cos((i / seg) * Math.PI * 2) * r));
    const a = ring(-len / 2);
    const b = ring(len / 2);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.poly([a[i], a[j], b[j], b[i]], c);
    }
    this.poly(a, c);
    this.poly(b, c);
  }

  /**
   * Лофт через перерізи вздовж Z. sidesOnly — лише бокові смуги (без верху, низу й торців):
   * так фарбуються стійки поверх скла.
   */
  loft(stations: Station[], opts: { caps?: boolean; sidesOnly?: boolean } = {}) {
    const { caps = true, sidesOnly = false } = opts;
    const rings = stations.map((st) => {
      const right = st.s.map(([x, y]): V3 => [x, y, st.z]);
      const left = st.s.map(([x, y]): V3 => [-x, y, st.z]).reverse();
      return [...right, ...left];
    });
    const midY = stations.map((st) => {
      const ys = st.s.map((p) => p[1]);
      return (Math.min(...ys) + Math.max(...ys)) / 2;
    });
    const n = rings[0].length;
    const half = n / 2;
    const z0 = stations[0].z;
    const z1 = stations[stations.length - 1].z;
    for (let i = 0; i + 1 < rings.length; i++) {
      const a = rings[i];
      const b = rings[i + 1];
      const zm = (stations[i].z + stations[i + 1].z) / 2;
      const inside: V3 = [0, (midY[i] + midY[i + 1]) / 2, zm];
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        // Ребро half-1 → half — верх (дах), n-1 → 0 — днище.
        if (sidesOnly && (k === half - 1 || k === n - 1)) continue;
        this.tri(a[k], a[k2], b[k2], inside);
        this.tri(a[k], b[k2], b[k], inside);
      }
    }
    if (caps && !sidesOnly) {
      const eps = Math.max(1e-3, (z1 - z0) * 0.01);
      this.poly([...rings[0]], [0, midY[0], z0 + eps]);
      this.poly([...rings[rings.length - 1]], [0, midY[midY.length - 1], z1 - eps]);
    }
  }

  /** Додати іншу геометрію, повернуту на yaw (курс) і зсунуту в (x, y, z). */
  append(other: FlatGeometry, x: number, y: number, z: number, yaw = 0) {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const src = other.pos;
    for (let i = 0; i < src.length; i += 3) {
      const lx = src[i];
      const lz = src[i + 2];
      this.pos.push(x + lx * c + lz * sn, y + src[i + 1], z - lx * sn + lz * c);
    }
  }

  toMesh(name: string, scene: Scene): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.indices = Array.from({ length: this.pos.length / 3 }, (_, i) => i);
    const normals: number[] = [];
    VertexData.ComputeNormals(vd.positions, vd.indices, normals);
    vd.normals = normals;
    // UV не потрібні, але з ними сітку можна злити з примітивами MeshBuilder того ж матеріалу.
    vd.uvs = new Array((this.pos.length / 3) * 2).fill(0);
    vd.applyToMesh(mesh);
    return mesh;
  }
}

/** Переріз у довільній точці z — лінійна інтерполяція між сусідніми станціями. */
export function sectionAt(stations: Station[], z: number): Section {
  if (z <= stations[0].z) return stations[0].s;
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    if (z <= b.z) {
      const t = (z - a.z) / Math.max(1e-6, b.z - a.z);
      return a.s.map(([x, y], k) => [x + (b.s[k][0] - x) * t, y + (b.s[k][1] - y) * t] as const);
    }
  }
  return stations[stations.length - 1].s;
}

/** Висота верху перерізу (остання точка) в точці z. */
export function topAt(stations: Station[], z: number): number {
  const s = sectionAt(stations, z);
  return s[s.length - 1][1];
}

/** Частина лофта між za і zb. */
export function slice(stations: Station[], za: number, zb: number): Station[] {
  const inner = stations.filter((st) => st.z > za && st.z < zb);
  return [{ z: za, s: sectionAt(stations, za) }, ...inner, { z: zb, s: sectionAt(stations, zb) }];
}

/** Переріз кожної станції перетворено функцією. */
export function mapSections(stations: Station[], fn: (s: Section, z: number) => Section): Station[] {
  return stations.map((st) => ({ z: st.z, s: fn(st.s, st.z) }));
}

/** Розширити переріз назовні (x) на dx — для накладок поверх кузова. */
export const grow = (dx: number, dy = 0) => (s: Section) => s.map(([x, y]) => [x + dx, y + dy] as const);
