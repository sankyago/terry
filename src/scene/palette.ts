import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

export const COLORS = {
  sky: '#e3ecef',
  grass: '#8fc07e',
  grassDark: '#86b876',
  asphalt: '#5d636a',
  marking: '#f4f6f5',
  curbLight: '#e6e8e6',
  curbDark: '#a9b0b3',
  cone: '#ff7a2f',
  coneStripe: '#ffffff',
  trunk: '#8a6a4f',
  foliage: '#5f9e6e',
  foliage2: '#79b27a',
  wall: '#f1ede6',
  wall2: '#dfe6e8',
  roof: '#7c8a93',
  window: '#9fb8c4',
  fence: '#c8b79c',
  barrier: '#eef0ef',
  barrierStripe: '#e5484d',
  zone: '#14b8a6',
  signBlue: '#2864c7',
  carBody: '#e4572e',
  carGlass: '#26323a',
  tyre: '#24282b',
  rim: '#c9cfd2',
} as const;

export function makeMaterial(scene: Scene, name: string, hex: string, emissive = 0.12): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.specularColor = Color3.Black();
  m.emissiveColor = c.scale(emissive);
  return m;
}
