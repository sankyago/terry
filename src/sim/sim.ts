import { CAR, CRASH_SETTLE_TIME, DRIVE } from '../config';
import type { RunPlan } from '../tickets/plan';
import type { ActorSpec, Ticket } from '../tickets/types';
import type { LightState, SignalizedIntersection } from './city';
import type { Contact, OBB } from './collision';
import { collideObbCircle, collideObbObb, toLocal } from './collision';
import type { ActorKind } from './kinds';
import { EGO_KIND, KINDS, isVulnerable } from './kinds';
import type { Vec2 } from './math';
import { clamp, forwardOf } from './math';
import type { Path } from './path';
import { curvatureAt, findConflict, nearestOnPath, poseOnPath, roundedPath } from './path';

/**
 * driving  — автопілот їде до наступної ситуації;
 * decision — авто стоїть, світ на паузі, учень обирає відповідь;
 * yielding — правильна відповідь: чекаємо, доки звільниться дорога;
 * wrongGo  — неправильна відповідь: авто рушає й потрапляє в ДТП;
 * crash    — анімація ДТП.
 */
export type SimPhase = 'driving' | 'decision' | 'yielding' | 'wrongGo' | 'crash' | 'finished';
export type IndicatorState = 'none' | 'left' | 'right' | 'hazard';

/** Вільне тіло після удару: рухається з тертям і обертається. */
export interface Body {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  omega: number;
}

export interface EgoState {
  s: number;
  v: number;
  x: number;
  z: number;
  heading: number;
  steer: number;
  wheelSpin: number;
  braking: boolean;
  indicator: IndicatorState;
  body: Body | null;
}

export interface ActorState {
  id: string;
  ticket: number;
  kind: ActorKind;
  color: string;
  s: number;
  v: number;
  x: number;
  z: number;
  heading: number;
  alive: boolean;
  siren: boolean;
  /** Стоїть на місці (перешкода), не має точки конфлікту. */
  parked: boolean;
  hazard: boolean;
  child: boolean;
  cane: boolean;
  /** Їде заднім ходом. */
  reverse: boolean;
  /** Винуватець ДТП, у якому учень не винен. */
  atFault: boolean;
  /** Стоїть до відповіді учня, потім рушає (departs). */
  waiting: boolean;
  /** Гальмує до зупинки (винуватець, коли учень сам рушив на неправильну відповідь). */
  stopping: boolean;
  body: Body | null;
  /** Час з моменту наїзду (для анімації падіння пішохода), -1 — без удару. */
  hitTime: number;
}

export interface CrashInfo {
  ticket: number;
  actorId: string;
  kind: ActorKind;
  x: number;
  z: number;
  /** Відносна швидкість зіткнення (м/с). */
  strength: number;
  time: number;
  /** ДТП не з вини учня: у нього в'їхали, коли він діяв правильно. */
  innocent: boolean;
}

export interface SimState {
  time: number;
  phase: SimPhase;
  phaseTime: number;
  /** Індекс поточної (наступної) ситуації. */
  ticket: number;
  /** Час рішення для кожної активованої ситуації (NaN — ще не активована). */
  decisionTimes: number[];
  ego: EgoState;
  actors: ActorState[];
  lights: Record<string, LightState>;
  crash: CrashInfo | null;
  crashSettled: boolean;
  answer: number | null;
}

export type SimEvent =
  | { type: 'decision'; ticket: number }
  | { type: 'crash'; crash: CrashInfo }
  | { type: 'crashSettled'; ticket: number }
  | { type: 'ticketCleared'; ticket: number }
  | { type: 'finished' };

interface PreparedActor {
  spec: ActorSpec;
  path: Path;
  /** s учня й учасника в точці конфлікту (для припаркованих — NaN). */
  egoConflictS: number;
  conflictS: number;
  conflict: Vec2;
  sAtDecision: number;
  /** Учасник «звільнив» дорогу, коли його s більше за це значення. */
  clearS: number;
}

export interface PreparedTicket {
  ticket: Ticket;
  stopS: number;
  actors: PreparedActor[];
}

const LIMIT_STEP = 0.5;
/** Після точки конфлікту транспорт розганяється до цієї швидкості, щоб не заважати учню. */
const EXIT_SPEED = 14;
const EXIT_ACCEL = 2.5;
/** Учасники минулих ситуацій, що лишилися позаду учня далі за цю відстань, зникають. */
const FORGET_BEHIND = 40;
const SPEC_COLORS: Record<ActorKind, string> = {
  car: '#3b6fd8',
  ambulance: '#f4f6f5',
  bus: '#f0a030',
  pedestrian: '#5b6bd6',
  cyclist: '#2f9e6e',
};
/** Винуватець ДТП не з вини учня: швидкість і час до удару після правильної відповіді. */
const AT_FAULT_SPEED = 9;
const AT_FAULT_HIT_TIME = 0.95;

/** Мінімальний стан для планувальника — і для руху, і для прогнозу часу прибуття. */
interface Kinematic {
  s: number;
  v: number;
}

export class Sim {
  readonly egoPath: Path;
  readonly prepared: PreparedTicket[];
  readonly finishS: number;
  readonly tickets: Ticket[];
  readonly signals: SignalizedIntersection[];
  state: SimState;
  private paths = new Map<string, Path>();
  private clearAt = new Map<string, number>();
  private speedLimit: Float64Array;

  constructor(readonly plan: RunPlan) {
    this.tickets = plan.tickets;
    this.signals = plan.world.signals;
    this.egoPath = roundedPath(plan.route);
    this.finishS = nearestOnPath(this.egoPath, plan.finish).s - CAR.length / 2;

    // Обмеження швидкості в поворотах, з урахуванням гальмування заздалегідь.
    const n = Math.ceil(this.egoPath.length / LIMIT_STEP) + 1;
    const lim = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.abs(curvatureAt(this.egoPath, i * LIMIT_STEP, 1.5));
      lim[i] = k > 1e-4 ? Math.min(DRIVE.cruise, Math.sqrt(DRIVE.lateralAccel / k)) : DRIVE.cruise;
    }
    for (let i = n - 2; i >= 0; i--) lim[i] = Math.min(lim[i], Math.sqrt(lim[i + 1] ** 2 + 2 * DRIVE.brake * LIMIT_STEP));
    this.speedLimit = lim;

    this.prepared = this.tickets.map((ticket, ti) => {
      const stopS = nearestOnPath(this.egoPath, ticket.stopLine).s - CAR.length / 2;
      const specs = ticket.innocent ? [...ticket.actors, this.atFaultSpec(stopS)] : ticket.actors;
      const actors = specs.map((spec): PreparedActor => {
        const path = roundedPath(spec.path, spec.kind === 'pedestrian' ? 0.25 : 0.5);
        this.paths.set(`${ti}:${spec.id}`, path);
        if (spec.parked)
          return { spec, path, egoConflictS: NaN, conflictS: NaN, conflict: path.pts[0], sAtDecision: 0, clearS: -Infinity };
        const c = findConflict(this.egoPath, stopS, path);
        if (!c) throw new Error(`Ситуація ${ticket.id}: учасник ${spec.id} не перетинає маршрут`);
        const k = KINDS[spec.kind];
        const clearS = c.sb + k.length / 2 + (isVulnerable(spec.kind) ? 2.5 : 3.2);
        if (!isVulnerable(spec.kind)) this.clearAt.set(`${ti}:${spec.id}`, clearS);
        return {
          spec,
          path,
          egoConflictS: c.sa,
          conflictS: c.sb,
          conflict: { x: c.x, z: c.z },
          sAtDecision: c.sb - spec.gap,
          clearS,
        };
      });
      return { ticket, stopS, actors };
    });
    this.state = this.initialState();
    this.activate(0);
    this.updateEgoPose();
  }

  /**
   * Неуважний водій ззаду: їде траєкторією учня й не гальмує. У момент рішення він за кілька метрів
   * позаду, тож після правильної відповіді, поки учень стоїть і пропускає, в'їжджає в нього.
   */
  private atFaultSpec(stopS: number): ActorSpec {
    const from = Math.max(0, stopS - 70);
    const path = [];
    for (let s = from; s < stopS + 10; s += 2) {
      const p = poseOnPath(this.egoPath, s);
      path.push({ x: p.x, z: p.z });
    }
    const contact = (KINDS.car.length + CAR.length) / 2;
    return {
      id: 'atFault',
      kind: 'car',
      color: '#7d8a91',
      model: 'suv',
      path,
      speed: AT_FAULT_SPEED,
      gap: contact + AT_FAULT_SPEED * AT_FAULT_HIT_TIME,
      atFault: true,
    };
  }

  private initialState(): SimState {
    const lights: Record<string, LightState> = {};
    for (const s of this.signals) lights[s.id] = { ...s.initial };
    const p = poseOnPath(this.egoPath, 0);
    return {
      time: 0,
      phase: 'driving',
      phaseTime: 0,
      ticket: 0,
      decisionTimes: this.tickets.map(() => NaN),
      ego: { s: 0, v: 0, ...p, steer: 0, wheelSpin: 0, braking: true, indicator: 'none', body: null },
      actors: [],
      lights,
      crash: null,
      crashSettled: false,
      answer: null,
    };
  }

  reset() {
    this.state = this.initialState();
    this.activate(0);
    this.updateEgoPose();
  }

  snapshot(): SimState {
    return structuredClone(this.state);
  }

  restore(s: SimState) {
    this.state = structuredClone(s);
  }

  get currentTicket(): PreparedTicket | null {
    return this.prepared[this.state.ticket] ?? null;
  }

  actorPath(a: ActorState): Path {
    return this.paths.get(a.id)!;
  }

  /** Відповідь на поточний білет. Повертає, чи вона правильна. */
  answer(option: number): boolean {
    const st = this.state;
    const t = this.currentTicket;
    if (st.phase !== 'decision' || !t) return false;
    const correct = t.ticket.options[option]?.correct ?? false;
    st.answer = option;
    st.phaseTime = 0;
    for (const a of st.actors)
      if (a.waiting && a.ticket === st.ticket) {
        a.waiting = false;
        a.v = t.actors.find((pa) => `${st.ticket}:${pa.spec.id}` === a.id)?.spec.speed ?? 0;
      }
    if (correct) {
      st.phase = 'yielding';
      return true;
    }
    st.phase = 'wrongGo';
    // Учасник, з яким неминуче ДТП, приходить у точку конфлікту одночасно з учнем.
    for (const pa of t.actors) {
      if (pa.spec.parked) continue;
      if (pa.spec.atFault) {
        // Учень рушив сам — водій ззаду встигає загальмувати.
        const a = st.actors.find((x) => x.id === `${st.ticket}:${pa.spec.id}`);
        if (a) a.stopping = true;
        continue;
      }
      const te = Math.sqrt((2 * Math.max(0.5, pa.egoConflictS - st.ego.s)) / DRIVE.wrongGoAccel);
      const a = st.actors.find((x) => x.id === `${st.ticket}:${pa.spec.id}`);
      if (!a) continue;
      const remaining = pa.conflictS - a.s;
      if (remaining > 0) a.v = clamp(remaining / te, pa.spec.speed * 0.3, pa.spec.speed * 2);
    }
    return false;
  }

  /** Прибирає винуватця ДТП поточної ситуації (після оформлення ДТП маршрут продовжується без нього). */
  dropAtFault() {
    const st = this.state;
    st.actors = st.actors.filter((a) => !(a.atFault && a.ticket === st.ticket));
  }

  correctOption(ticket = this.state.ticket): number {
    return this.tickets[ticket]?.options.findIndex((o) => o.correct) ?? -1;
  }

  /** Крок планувальника: розгін до крейсерської, повороти, плавна зупинка в stopS. */
  private planStep(k: Kinematic, dt: number, stopS: number): { arrived: boolean; braking: boolean } {
    const i = Math.min(this.speedLimit.length - 1, Math.max(0, Math.floor(k.s / LIMIT_STEP)));
    const d = stopS - k.s;
    const target = Math.min(this.speedLimit[i], Math.sqrt(2 * DRIVE.brake * Math.max(0, d)));
    const before = k.v;
    if (k.v < target) k.v = Math.min(target, k.v + DRIVE.accel * dt);
    else k.v = Math.max(target, k.v - DRIVE.brake * 1.6 * dt);
    k.s += k.v * dt;
    if (stopS - k.s < 0.04) {
      k.s = Math.min(k.s, stopS);
      k.v = 0;
      return { arrived: true, braking: true };
    }
    return { arrived: false, braking: k.v < before - 1e-4 };
  }

  private predictArrival(stopS: number, dt: number): number {
    const k = { s: this.state.ego.s, v: this.state.ego.v };
    for (let n = 1; n < 60 * 120; n++) if (this.planStep(k, dt, stopS).arrived) return n * dt;
    return 0;
  }

  private dt = 1 / 60;

  /** Активує ситуацію: розставляє учасників так, щоб у момент рішення вони були в заданих точках. */
  private activate(index: number) {
    const st = this.state;
    const t = this.prepared[index];
    if (!t || !Number.isNaN(st.decisionTimes[index])) return;
    const T = this.predictArrival(t.stopS, this.dt);
    st.decisionTimes[index] = st.time + T;
    for (const pa of t.actors) {
      const parked = pa.spec.parked ?? false;
      const a: ActorState = {
        id: `${index}:${pa.spec.id}`,
        ticket: index,
        kind: pa.spec.kind,
        color: pa.spec.color ?? SPEC_COLORS[pa.spec.kind],
        s: parked ? 0 : pa.spec.departs ? pa.sAtDecision : pa.sAtDecision - pa.spec.speed * T,
        v: parked || pa.spec.departs ? 0 : pa.spec.speed,
        x: 0,
        z: 0,
        heading: 0,
        alive: false,
        siren: pa.spec.siren ?? false,
        parked,
        hazard: pa.spec.hazard ?? false,
        child: pa.spec.child ?? false,
        cane: pa.spec.cane ?? false,
        reverse: pa.spec.reverse ?? false,
        atFault: pa.spec.atFault ?? false,
        stopping: false,
        waiting: pa.spec.departs ?? false,
        body: null,
        hitTime: -1,
      };
      this.updateActorPose(a, pa.path);
      st.actors.push(a);
    }
  }

  private updateActorPose(a: ActorState, path: Path) {
    if (a.body) {
      a.x = a.body.x;
      a.z = a.body.z;
      a.heading = a.body.heading;
      a.alive = true;
      return;
    }
    const p = poseOnPath(path, a.s);
    a.x = p.x;
    a.z = p.z;
    a.heading = a.reverse ? p.heading + Math.PI : p.heading;
    a.alive = a.s >= 0 && a.s <= path.length;
  }

  private updateLights() {
    const st = this.state;
    for (const s of this.signals) st.lights[s.id] = { ...s.initial };
    this.tickets.forEach((t, i) => {
      const td = st.decisionTimes[i];
      if (!t.lights || Number.isNaN(td)) return;
      const rel = st.time - td;
      for (const script of t.lights)
        for (const step of script.steps) if (rel >= step.t - 1e-6) Object.assign(st.lights[script.signal], step.state);
    });
  }

  private updateEgoPose() {
    const e = this.state.ego;
    if (e.body) {
      e.x = e.body.x;
      e.z = e.body.z;
      e.heading = e.body.heading;
      return;
    }
    const p = poseOnPath(this.egoPath, e.s);
    e.x = p.x;
    e.z = p.z;
    e.heading = p.heading;
    e.steer = Math.atan(CAR.wheelbase * curvatureAt(this.egoPath, e.s + 1, 1.5));
    // Покажчик повороту — за 30 м до повороту і до виходу з нього.
    let ind: IndicatorState = 'none';
    for (let d = 0; d <= 30; d += 2) {
      const k = curvatureAt(this.egoPath, e.s + d, 1.5);
      if (Math.abs(k) > 0.05) {
        ind = k > 0 ? 'right' : 'left';
        break;
      }
    }
    e.indicator = ind;
  }

  egoObb(): OBB {
    const e = this.state.ego;
    return { x: e.x, z: e.z, heading: e.heading, halfLength: EGO_KIND.length / 2, halfWidth: EGO_KIND.width / 2 };
  }

  actorObb(a: ActorState): OBB {
    const k = KINDS[a.kind];
    return { x: a.x, z: a.z, heading: a.heading, halfLength: k.length / 2, halfWidth: k.width / 2 };
  }

  step(dt: number): SimEvent[] {
    this.dt = dt;
    const st = this.state;
    const events: SimEvent[] = [];
    if (st.phase === 'decision' || st.phase === 'finished') return events;
    st.time += dt;
    st.phaseTime += dt;
    this.updateLights();

    for (const a of st.actors) {
      if (a.body) {
        integrateBody(a.body, dt, isVulnerable(a.kind) ? 6 : 5.5);
        a.hitTime += dt;
      } else {
        if (a.stopping) a.v = Math.max(0, a.v - 6 * dt);
        // Проїхавши точку конфлікту, транспорт розганяється й не заважає учню далі.
        if (!a.stopping && !a.reverse && a.s > (this.clearAt.get(a.id) ?? Infinity) && a.v < EXIT_SPEED) a.v = Math.min(EXIT_SPEED, a.v + EXIT_ACCEL * dt);
        a.s += a.v * dt;
      }
      this.updateActorPose(a, this.actorPath(a));
    }
    const e0 = st.ego;
    const fwd = forwardOf(e0.heading);
    st.actors = st.actors.filter((a) => {
      if (a.body) return true;
      if (a.s > this.actorPath(a).length + 1) return false;
      // Учасники минулих ситуацій, що лишилися далеко позаду, більше не потрібні.
      if (a.ticket < st.ticket && (a.x - e0.x) * fwd.x + (a.z - e0.z) * fwd.z < -FORGET_BEHIND) return false;
      return true;
    });

    const e = st.ego;
    const t = this.currentTicket;
    switch (st.phase) {
      case 'driving': {
        const stopS = t ? t.stopS : this.finishS;
        const r = this.planStep(e, dt, stopS);
        e.braking = r.braking;
        if (r.arrived) {
          st.phaseTime = 0;
          if (t) {
            st.phase = 'decision';
            st.answer = null;
            events.push({ type: 'decision', ticket: st.ticket });
          } else {
            st.phase = 'finished';
            events.push({ type: 'finished' });
          }
        }
        break;
      }
      case 'yielding': {
        e.v = 0;
        e.braking = true;
        const clear =
          !t ||
          t.actors.every((pa) => {
            if (pa.spec.parked) return true;
            const a = st.actors.find((x) => x.id === `${st.ticket}:${pa.spec.id}`);
            return !a || a.s > pa.clearS;
          });
        if (clear && st.phaseTime >= DRIVE.yieldMinWait) {
          events.push({ type: 'ticketCleared', ticket: st.ticket });
          st.phase = 'driving';
          st.phaseTime = 0;
          st.ticket++;
          this.activate(st.ticket);
        }
        break;
      }
      case 'wrongGo':
        e.braking = false;
        e.v = Math.min(DRIVE.cruise * 1.2, e.v + DRIVE.wrongGoAccel * dt);
        e.s += e.v * dt;
        break;
      case 'crash':
        if (e.body) integrateBody(e.body, dt, 7);
        e.v = e.body ? Math.hypot(e.body.vx, e.body.vz) : 0;
        e.braking = true;
        break;
    }
    if (!e.body) e.wheelSpin += (e.v / CAR.wheelRadius) * dt;
    this.updateEgoPose();
    if (st.crash) e.indicator = 'hazard';

    this.collide(events);

    if (st.phase === 'wrongGo' && st.phaseTime > 8) {
      // Запобіжник: ДТП не сталося (не повинно трапитися) — однаково показуємо наслідок.
      this.startCrash(null, events, 0);
    }
    if (st.phase === 'crash' && st.crash && !st.crashSettled && st.time - st.crash.time >= CRASH_SETTLE_TIME) {
      st.crashSettled = true;
      events.push({ type: 'crashSettled', ticket: st.ticket });
    }
    return events;
  }

  private startCrash(a: ActorState | null, events: SimEvent[], strength: number) {
    const st = this.state;
    const e = st.ego;
    st.phase = 'crash';
    st.phaseTime = 0;
    if (!e.body) {
      const f = forwardOf(e.heading);
      e.body = { x: e.x, z: e.z, heading: e.heading, vx: f.x * e.v, vz: f.z * e.v, omega: 0 };
    }
    st.crash = {
      ticket: st.ticket,
      actorId: a?.id ?? '',
      kind: a?.kind ?? 'car',
      x: a ? (a.x + e.x) / 2 : e.x,
      z: a ? (a.z + e.z) / 2 : e.z,
      strength,
      time: st.time,
      innocent: a?.atFault ?? false,
    };
    st.crashSettled = false;
    events.push({ type: 'crash', crash: { ...st.crash } });
  }

  private collide(events: SimEvent[]) {
    const st = this.state;
    if (st.phase === 'finished') return;
    const e = st.ego;
    for (const a of st.actors) {
      // Зіткнення рахуються лише з учасниками поточної ситуації: решта вже не перетинає маршрут.
      if (!a.alive || a.ticket !== st.ticket) continue;
      const eo = this.egoObb();
      const ped = isVulnerable(a.kind);
      const c: Contact | null = a.kind === 'pedestrian'
        ? collideObbCircle(eo, { x: a.x, z: a.z, r: KINDS.pedestrian.width / 2 })
        : collideObbObb(eo, this.actorObb(a));
      if (!c) continue;
      // Нормаль спрямована від учасника до авто учня.
      const n = { x: c.nx, z: c.nz };
      const fe = forwardOf(e.heading);
      const ve = e.body ? { x: e.body.vx, z: e.body.vz } : { x: fe.x * e.v, z: fe.z * e.v };
      const fa = forwardOf(a.heading);
      const va = a.body ? { x: a.body.vx, z: a.body.vz } : { x: fa.x * a.v, z: fa.z * a.v };
      const rel = (ve.x - va.x) * n.x + (ve.z - va.z) * n.z;
      // Пішохода збиває навіть дотичний удар — для нього сила удару — повна відносна швидкість.
      const strength = ped ? Math.hypot(ve.x - va.x, ve.z - va.z) : Math.abs(rel);
      if (!st.crash) this.startCrash(a, events, strength);
      if (!e.body) e.body = { x: e.x, z: e.z, heading: e.heading, vx: ve.x, vz: ve.z, omega: 0 };
      if (!a.body) {
        a.body = { x: a.x, z: a.z, heading: a.heading, vx: va.x, vz: va.z, omega: 0 };
        a.hitTime = 0;
      }
      resolveImpact(e.body, EGO_KIND.mass, eo, a.body, KINDS[a.kind].mass, this.actorObb(a), n, c.depth, ped);
      this.updateEgoPose();
      this.updateActorPose(a, this.actorPath(a));
    }
  }
}

function integrateBody(b: Body, dt: number, friction: number) {
  const sp = Math.hypot(b.vx, b.vz);
  if (sp > 1e-6) {
    const k = Math.max(0, sp - friction * dt) / sp;
    b.vx *= k;
    b.vz *= k;
  }
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.heading += b.omega * dt;
  b.omega *= Math.exp(-2.2 * dt);
}

/** Імпульс удару з обертанням: важчий учасник майже не змінює руху. */
function resolveImpact(
  eb: Body,
  me: number,
  eo: OBB,
  ab: Body,
  ma: number,
  ao: OBB,
  n: Vec2,
  depth: number,
  pedestrian: boolean,
) {
  const ie = 1 / me;
  const ia = 1 / ma;
  const sum = ie + ia;
  eb.x += n.x * depth * (ie / sum);
  eb.z += n.z * depth * (ie / sum);
  ab.x -= n.x * depth * (ia / sum);
  ab.z -= n.z * depth * (ia / sum);
  const vn = (eb.vx - ab.vx) * n.x + (eb.vz - ab.vz) * n.z;
  if (vn >= 0) return;
  const restitution = pedestrian ? 0.1 : 0.2;
  const j = (-(1 + restitution) * vn) / sum;
  eb.vx += n.x * j * ie;
  eb.vz += n.z * j * ie;
  ab.vx -= n.x * j * ia;
  ab.vz -= n.z * j * ia;
  if (pedestrian) return;
  // Обертання від позацентрового удару: точка контакту — найближча точка корпусу до центру іншого.
  const spin = (b: Body, o: OBB, other: OBB, jx: number, jz: number, m: number) => {
    const l = toLocal(o, other);
    const along = clamp(l.along, -o.halfLength, o.halfLength);
    const across = clamp(l.across, -o.halfWidth, o.halfWidth);
    const f = forwardOf(o.heading);
    const rx = f.x * along + f.z * across;
    const rz = f.z * along - f.x * across;
    const inertia = (m * ((o.halfLength * 2) ** 2 + (o.halfWidth * 2) ** 2)) / 12;
    b.omega += (1.6 * (rz * jx - rx * jz)) / inertia;
  };
  spin(eb, eo, ao, n.x * j, n.z * j, me);
  spin(ab, ao, eo, -n.x * j, -n.z * j, ma);
}
