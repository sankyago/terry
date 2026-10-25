import { EXERCISE } from '../config';
import type { Gear } from '../sim/vehicle';
import { EdgeTrigger } from './edgeTrigger';
import { buildRecommendations } from './texts';
import type {
  ExerciseEvent,
  ExerciseFrame,
  ExercisePhase,
  ExerciseResult,
  FailReason,
  FaultKind,
  FaultRecord,
  Mode,
  ResultStatus,
} from './types';

export interface ExerciseOptions {
  mode: Mode;
  /** Поступ s, на якому починається поворот (для перевірки покажчика). */
  curveStartS: number;
  speedLimitKmh?: number;
  speedClearKmh?: number;
  stopHoldSeconds?: number;
}

/**
 * Вправа «Зупинка в позначеній зоні»: явна машина станів і журнал помилок.
 * Не залежить від Babylon/DOM — отримує кадри симуляції і повертає події.
 */
export class Exercise {
  readonly mode: Mode;
  phase: ExercisePhase = 'waiting';
  /** Час від початку руху (с). */
  elapsed = 0;
  /** Скільки секунд поспіль авто стоїть повністю в зоні. */
  holdTime = 0;
  faults: FaultRecord[] = [];
  result: ExerciseResult | null = null;

  private readonly limit: number;
  private readonly clearLimit: number;
  private readonly hold: number;
  private readonly curveStartS: number;
  private prevGear: Gear | null = null;
  private signalChecked = false;
  private lastEarlyPark = -Infinity;
  private speeding = new EdgeTrigger(1, 3);
  private offroad = new EdgeTrigger(1, 2);
  private collisions = new Map<string, EdgeTrigger>();

  constructor(opts: ExerciseOptions) {
    this.mode = opts.mode;
    this.curveStartS = opts.curveStartS;
    this.limit = opts.speedLimitKmh ?? EXERCISE.speedLimitKmh;
    this.clearLimit = opts.speedClearKmh ?? EXERCISE.speedClearKmh;
    this.hold = opts.stopHoldSeconds ?? EXERCISE.stopHoldSeconds;
  }

  get stopHoldSeconds() {
    return this.hold;
  }

  get ready() {
    return this.phase === 'stopping' && this.holdTime >= this.hold;
  }

  countOf(kind: FaultKind) {
    return this.faults.filter((f) => f.kind === kind).length;
  }

  reset() {
    this.phase = 'waiting';
    this.elapsed = 0;
    this.holdTime = 0;
    this.faults = [];
    this.result = null;
    this.prevGear = null;
    this.signalChecked = false;
    this.lastEarlyPark = -Infinity;
    this.speeding.reset();
    this.offroad.reset();
    this.collisions.clear();
  }

  step(f: ExerciseFrame): ExerciseEvent[] {
    const events: ExerciseEvent[] = [];
    if (this.phase === 'finished') return events;
    const gearChangedToP = this.prevGear !== null && this.prevGear !== 'P' && f.gear === 'P';
    this.prevGear = f.gear;

    if (this.phase === 'waiting') {
      if (f.moved > EXERCISE.startMoveDistance || Math.abs(f.speedKmh) > 1.5) {
        this.setPhase('driving', events);
      } else {
        return events;
      }
    }

    this.elapsed += f.dt;
    const t = this.elapsed;
    const speed = Math.abs(f.speedKmh);

    if (this.speeding.update(t, speed > this.limit, speed < this.clearLimit)) {
      this.addFault('speeding', `Швидкість ${Math.round(speed)} км/год при навчальному ліміті ${this.limit}. Відпустіть газ і плавно пригальмуйте.`, events);
    }
    if (this.offroad.update(t, f.offRoad)) {
      this.addFault('offroad', 'Колесо вийшло за край дороги. Плавно поверніть кермо, щоб повернутися у свою смугу.', events);
    }
    for (const c of f.contacts) {
      let trig = this.collisions.get(c.id);
      if (!trig) this.collisions.set(c.id, (trig = new EdgeTrigger(0.6, 1.5)));
      if (trig.update(t, true)) {
        this.addFault('collision', `Зіткнення: ${c.label}. Зупиніться, оцініть відстань і об'їдьте перешкоду повільно.`, events);
      }
    }
    for (const [id, trig] of this.collisions) {
      if (!f.contacts.some((c) => c.id === id)) trig.update(t, false);
    }
    if (!this.signalChecked && f.s >= this.curveStartS) {
      this.signalChecked = true;
      if (f.indicator !== 'right') {
        this.addFault('noSignal', 'Поворот праворуч розпочато без правого покажчика. Вмикайте його заздалегідь.', events);
      }
    }

    const stopped = speed < EXERCISE.stoppedSpeedKmh;
    if (f.inZone && stopped) {
      this.holdTime += f.dt;
      if (this.phase !== 'stopping') this.setPhase('stopping', events);
    } else {
      this.holdTime = 0;
      if (this.phase !== 'driving') this.setPhase('driving', events);
    }

    if (gearChangedToP) this.onPark(events);
    return events;
  }

  private onPark(events: ExerciseEvent[]) {
    const failReasons: FailReason[] = [];
    if (this.holdTime >= this.hold) {
      this.finish(failReasons, events);
      return;
    }
    failReasons.push(this.phase === 'stopping' ? 'holdShort' : 'notInZone');
    if (this.mode === 'check') {
      this.finish(failReasons, events);
      return;
    }
    if (this.elapsed - this.lastEarlyPark >= 3) {
      this.lastEarlyPark = this.elapsed;
      const msg =
        failReasons[0] === 'holdShort'
          ? 'Зарано: після зупинки зачекайте 2 секунди. Перемкніть у D з натиснутим гальмом, зачекайте й знову увімкніть P.'
          : 'P увімкнено поза зоною. Перемкніть у D з натиснутим гальмом і зупиніться так, щоб увесь корпус був у зоні.';
      this.addFault('earlyPark', msg, events);
    }
  }

  private finish(failReasons: FailReason[], events: ExerciseEvent[]) {
    if (this.countOf('collision') > 0) failReasons.push('collision');
    const success = failReasons.length === 0;
    const status: ResultStatus = !success ? 'failed' : this.faults.length > 0 ? 'passedWithRemarks' : 'passed';
    this.result = {
      mode: this.mode,
      status,
      success,
      time: this.elapsed,
      faults: [...this.faults],
      failReasons,
      recommendations: buildRecommendations(this.faults, failReasons),
    };
    this.setPhase('finished', events);
    events.push({ type: 'finished', result: this.result });
  }

  private addFault(kind: FaultKind, message: string, events: ExerciseEvent[]) {
    const fault: FaultRecord = { kind, t: this.elapsed, message };
    this.faults.push(fault);
    events.push({ type: 'fault', fault });
  }

  private setPhase(phase: ExercisePhase, events: ExerciseEvent[]) {
    this.phase = phase;
    events.push({ type: 'phase', phase });
  }
}
