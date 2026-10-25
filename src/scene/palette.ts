import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

export const COLORS = {
  sky: '#dfe8ec',
  grass: '#93c47d',
  grassDark: '#86b876',
  asphalt: '#596068',
  asphaltDark: '#4d535a',
  marking: '#f4f6f5',
  sidewalk: '#d9dcd8',
  curb: '#b9bfc0',
  paving: '#c9c3b6',
  parking: '#6b7178',
  trunk: '#8a6a4f',
  foliage: '#5f9e6e',
  foliage2: '#79b27a',
  walls: ['#f1ede6', '#dfe6e8', '#e9d8c4', '#d4dde4', '#efe3d3', '#cfd8cf'],
  roof: '#8a959c',
  roofDark: '#6f7b82',
  window: '#9fb8c4',
  pole: '#4c555b',
  signBlue: '#2864c7',
  signRed: '#d8343a',
  signYellow: '#f2c230',
  signWhite: '#ffffff',
  carBody: '#e4572e',
  carGlass: '#26323a',
  tyre: '#24282b',
  rim: '#c9cfd2',
  skin: '#e0b48f',
} as const;

export function makeMaterial(scene: Scene, name: string, hex: string, emissive = 0.12): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.specularColor = Color3.Black();
  m.emissiveColor = c.scale(emissive);
  return m;
}

/** Кеш матеріалів за кольором — машини й пішоходи з однаковим кольором ділять матеріал. */
export class MaterialCache {
  private map = new Map<string, StandardMaterial>();
  constructor(private scene: Scene) {}
  get(hex: string, emissive = 0.12): StandardMaterial {
    const key = `${hex}|${emissive}`;
    let m = this.map.get(key);
    if (!m) this.map.set(key, (m = makeMaterial(this.scene, `m${this.map.size}`, hex, emissive)));
    return m;
  }
}
