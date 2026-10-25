import type { IndicatorSide } from '../sim/indicators';
import type { Gear } from '../sim/vehicle';

export type Mode = 'training' | 'check';
export type ExercisePhase = 'waiting' | 'driving' | 'stopping' | 'finished';
export type FaultKind = 'speeding' | 'collision' | 'offroad' | 'noSignal' | 'earlyPark';
export type FailReason = 'notInZone' | 'holdShort' | 'collision';
export type ResultStatus = 'passed' | 'passedWithRemarks' | 'failed';

export interface FaultRecord {
  kind: FaultKind;
  /** Час від початку руху, с. */
  t: number;
  message: string;
}

export interface ExerciseFrame {
  dt: number;
  speedKmh: number;
  gear: Gear;
  inZone: boolean;
  offRoad: boolean;
  contacts: ReadonlyArray<{ id: string; label: string }>;
  /** Поступ уздовж дороги, м. */
  s: number;
  /** Пройдений шлях від старту, м. */
  moved: number;
  indicator: IndicatorSide;
}

export interface ExerciseResult {
  mode: Mode;
  status: ResultStatus;
  success: boolean;
  time: number;
  faults: FaultRecord[];
  failReasons: FailReason[];
  recommendations: string[];
}

export type ExerciseEvent =
  | { type: 'phase'; phase: ExercisePhase }
  | { type: 'fault'; fault: FaultRecord }
  | { type: 'finished'; result: ExerciseResult };
