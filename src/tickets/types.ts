import type { LightColor, LightState, Prop, Sign } from '../sim/city';
import type { ActorKind, TrafficModel } from '../sim/kinds';
import type { Corner } from '../sim/path';
import type { Vec2 } from '../sim/math';

export interface TicketOption {
  text: string;
  correct: boolean;
}

/** Учасник ситуації. Його положення задається відносно моменту рішення. */
export interface ActorSpec {
  id: string;
  kind: ActorKind;
  color?: string;
  /** Модель легковика (інакше обирається автоматично). */
  model?: TrafficModel;
  path: Corner[];
  /** Швидкість до моменту рішення (м/с). */
  speed: number;
  /** На скільки метрів центр учасника не доїхав до точки конфлікту в момент рішення. */
  gap: number;
  siren?: boolean;
  /** Стоїть на місці (зламане авто, автобус на зупинці): лише перешкода, без точки конфлікту. */
  parked?: boolean;
  /** Увімкнена аварійна сигналізація. */
  hazard?: boolean;
  /** Пішохід — дитина (менший на сцені). */
  child?: boolean;
  /** Незрячий пішохід із білою тростиною. */
  cane?: boolean;
  /** Їде заднім ходом (виїзд із паркування): модель розвернута проти напрямку руху. */
  reverse?: boolean;
  /** Стоїть у точці, де має бути в момент рішення, і рушає лише після відповіді (автобус від зупинки). */
  departs?: boolean;
  /** Винуватець ДТП, у якому учень не винен: їде ззаду й не гальмує. */
  atFault?: boolean;
}

/** Зміна сигналів світлофора; t — секунди відносно моменту рішення (від'ємні — до нього). */
export interface LightScript {
  signal: string;
  steps: Array<{ t: number; state: Partial<LightState> }>;
}

/** Білет, розставлений на конкретному маршруті: усе — у світових координатах. */
export interface Ticket {
  id: string;
  title: string;
  question: string;
  options: TicketOption[];
  explanation: string;
  rule: string;
  /** Точка, до якої учень під'їжджає переднім бампером і зупиняється. */
  stopLine: Vec2;
  actors: ActorSpec[];
  lights?: LightScript[];
  /** У цьому білеті в учня, що відповів правильно, в'їжджає ззаду неуважний водій. */
  innocent?: boolean;
}

// ---------- Шаблони білетів ----------
//
// Шаблон описує ситуацію в локальній системі координат: авто учня під'їжджає з півдня (рух у +Z),
// праворуч — +X. Для перехрестя початок координат — центр перехрестя, для ділянки між перехрестями —
// середина кварталу, для виїзду з двору — вісь виїзду на осьовій дороги. Генератор маршруту
// повертає й переносить шаблон у потрібне місце міста.

export type Arm = 'N' | 'E' | 'S' | 'W';
export type Turn = 'straight' | 'left' | 'right';

/**
 * equal — рівнозначні дороги; giveWay / stop — учень на другорядній; main — учень на головній;
 * signal — світлофор; flash — миготливий жовтий без знаків; flashGiveWay — миготливий жовтий і «Дати дорогу».
 */
export type Control = 'equal' | 'giveWay' | 'stop' | 'main' | 'signal' | 'flash' | 'flashGiveWay';

/** along — сигнал для напрямку учня, cross — для поперечної дороги. */
export interface LocalLights {
  along: LightColor;
  cross: LightColor;
}

export interface LocalCrosswalk {
  x: number;
  z: number;
  /** true — зебра перетинає дорогу учня (дорога йде вздовж локальної осі Z). */
  acrossEgoRoad: boolean;
  /** Ширина зебри (м), за замовчуванням 3. */
  width?: number;
}

interface TemplateBase {
  id: string;
  title: string;
  question: string;
  options: TicketOption[];
  explanation: string;
  rule: string;
  stopLine: Vec2;
  actors: ActorSpec[];
  signs?: Sign[];
  crosswalks?: LocalCrosswalk[];
  props?: Prop[];
  /** Велодоріжки й велопереїзди ситуації (ширина за замовчуванням 1,5 м). */
  bikePaths?: Array<{ a: Vec2; b: Vec2; width?: number }>;
}

export interface NodeTemplate extends TemplateBase {
  site: 'node';
  turn: Turn;
  control: Control;
  /** Початковий стан світлофора (за замовчуванням зелений для учня). */
  initial?: LocalLights;
  lights?: Array<{ t: number; state: Partial<LocalLights> }>;
  /**
   * Перехрестя на проспекті: учень під'їжджає проспектом (lanes смуг у кожен бік) смугою laneIn,
   * поперечна дорога — звичайна. Після проїзду прямо учень у смузі laneOut (за замовчуванням laneIn).
   */
  lanes?: 2 | 3;
  laneIn?: number;
  laneOut?: number;
}

export interface BlockTemplate extends TemplateBase {
  site: 'block';
  /** Об'їзд: кути траєкторії учня в межах кварталу (z від −40 до 40); без них — прямо. */
  ego?: Corner[];
}

/**
 * Ділянка проспекту між перехрестями (lanes смуг у кожен бік, смуги нумеруються від осьової: 0, 1, 2).
 * Учень заїжджає на ділянку смугою laneIn і покидає смугою laneOut; кути ego — у межах z від −14 до 14.
 */
export interface AvenueTemplate extends TemplateBase {
  site: 'avenue';
  lanes: 2 | 3;
  laneIn: number;
  laneOut: number;
  ego?: Corner[];
}

export interface StartTemplate extends TemplateBase {
  site: 'start';
  turn: 'left' | 'right';
}

export type TicketTemplate = NodeTemplate | BlockTemplate | AvenueTemplate | StartTemplate;
