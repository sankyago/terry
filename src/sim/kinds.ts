import { CAR } from '../config';

export type ActorKind = 'car' | 'ambulance' | 'bus' | 'pedestrian';

export interface KindSpec {
  length: number;
  width: number;
  mass: number;
  label: string;
}

export const KINDS: Record<ActorKind, KindSpec> = {
  car: { length: 4.5, width: 1.8, mass: 1400, label: 'автомобілем' },
  ambulance: { length: 5.9, width: 2.05, mass: 2900, label: 'автомобілем швидкої допомоги' },
  bus: { length: 12, width: 2.55, mass: 11000, label: 'автобусом' },
  pedestrian: { length: 0.6, width: 0.6, mass: 75, label: 'пішоходом' },
};

export const EGO_KIND: KindSpec = { length: CAR.length, width: CAR.width, mass: CAR.mass, label: 'авто учня' };
