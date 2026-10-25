import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';

import { AudioEngine } from '../audio/AudioEngine';
import type { CameraFocus } from '../camera/CameraRig';
import { CameraRig } from '../camera/CameraRig';
import { MAX_STEPS_PER_FRAME, SIM_DT } from '../config';
import { Ambient } from '../scene/Ambient';
import { buildCity } from '../scene/buildCity';
import type { CityView } from '../scene/buildCity';
import { Effects } from '../scene/Effects';
import { Guides } from '../scene/Guides';
import { COLORS, MaterialCache } from '../scene/palette';
import { PedestrianView } from '../scene/PedestrianView';
import type { QualityProfile } from '../scene/quality';
import { VehicleView } from '../scene/VehicleView';
import { pickCarModel } from '../scene/vehicleModels';
import type { ActorKind } from '../sim/kinds';
import { KINDS } from '../sim/kinds';
import type { Pose } from '../sim/math';
import { lerp, lerpAngle, msToKmh } from '../sim/math';
import { curvatureAt } from '../sim/path';
import type { ActorState, IndicatorState } from '../sim/sim';
import { Sim } from '../sim/sim';
import type { RunPlan } from '../tickets/plan';
import type { AnswerRecord, CameraMode, Mode, RunResult } from '../storage/storage';
import { buildResult } from '../storage/storage';

export type GameStatus = 'menu' | 'playing' | 'decision' | 'crashed' | 'paused' | 'finished';
export type TicketMark = 'ok' | 'fail' | null;

export interface HudSnapshot {
  speedKmh: number;
  ticket: number;
  total: number;
  marks: TicketMark[];
  fps: number;
}

export type GameEvent =
  | { type: 'hud'; hud: HudSnapshot }
  | { type: 'status'; status: GameStatus }
  | { type: 'decision'; ticket: number; retry: boolean }
  | { type: 'answer'; ticket: number; option: number; correct: boolean; retry: boolean }
  | { type: 'crash'; ticket: number; kind: ActorKind }
  | { type: 'replay'; ticket: number }
  | { type: 'cleared'; ticket: number }
  | { type: 'finished'; result: RunResult }
  | { type: 'camera'; mode: CameraMode };

export interface GameOptions {
  /** Маршрут, який видно в меню й з якого почнеться перший заїзд. */
  plan: RunPlan;
  quality: QualityProfile;
  mode: Mode;
  camera: CameraMode;
  sound: boolean;
}

const HUD_INTERVAL = 0.1;
/** Пішоходи ситуацій трохи більші за реальних — інакше з висоти їх погано видно. */
const PED_SCALE = 1.25;
/** На скільки метрів на початку й наприкінці траєкторії учасник з'являється і зникає. */
const FADE = 8;
type ActorView = VehicleView | PedestrianView;

export class Game {
  sim: Sim;
  plan: RunPlan;
  status: GameStatus = 'menu';
  mode: Mode;

  private engine: Engine;
  private scene: Scene;
  private rig: CameraRig;
  private cache: MaterialCache;
  private city: CityView;
  private ego: VehicleView;
  private views = new Map<string, ActorView>();
  private spawnClock = new Map<string, number>();
  private prevEgo: Pose;
  private prevActors = new Map<string, Pose>();
  private guides: Guides;
  private effects: Effects;
  private ambient: Ambient;
  private audio = new AudioEngine();
  private listeners = new Set<(e: GameEvent) => void>();
  private answers: AnswerRecord[] = [];
  private snapshotAtDecision: ReturnType<Sim['snapshot']> | null = null;
  private retrying = false;
  private pausedFrom: GameStatus = 'playing';
  private cameraMode: CameraMode;
  private accumulator = 0;
  private cameraHeading = 0;
  private clock = 0;
  private hudTimer = 0;
  private lastHudKey = '';
  private lastHud: HudSnapshot | null = null;
  private cleanup: Array<() => void> = [];
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: GameOptions) {
    this.plan = opts.plan;
    this.sim = new Sim(opts.plan);
    this.mode = opts.mode;
    this.cameraMode = opts.camera;
    this.audio.setMuted(!opts.sound);

    this.engine = new Engine(canvas, opts.quality.antialias, {
      preserveDrawingBuffer: false,
      stencil: false,
      powerPreference: 'high-performance',
      audioEngine: false,
    }, false);
    const applyScaling = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, opts.quality.maxPixelRatio);
      this.engine.setHardwareScalingLevel(1 / ratio);
    };
    applyScaling();

    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.detachControl();
    scene.skipPointerMovePicking = true;
    const sky = Color3.FromHexString(COLORS.sky);
    scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    scene.ambientColor = new Color3(0.3, 0.32, 0.34);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = sky;
    scene.fogStart = 110;
    scene.fogEnd = 300;

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.66;
    hemi.groundColor = new Color3(0.5, 0.55, 0.56);
    const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35), scene);
    sun.intensity = 0.6;

    this.cache = new MaterialCache(scene);
    this.city = buildCity(scene, false, this.plan.world);
    this.ego = new VehicleView(scene, this.cache, 'coupe', COLORS.carBody, true);
    this.guides = new Guides(scene);
    this.effects = new Effects(scene);
    this.ambient = new Ambient(scene, this.cache, this.plan.world, this.plan.route, this.plan.seed);
    this.prevEgo = this.egoPose();

    this.rig = new CameraRig(scene, { x: 70, z: 110 });
    scene.activeCamera = this.rig.camera;
    this.render(0, 1);

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const n = Number(e.key);
      if (this.status === 'decision' && n >= 1 && n <= 4) {
        const t = this.sim.currentTicket?.ticket;
        if (t && n <= t.options.length) this.answer(n - 1);
      } else if (e.key === 'Escape') {
        if (this.status === 'paused') this.resume();
        else this.pause();
      } else if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') this.toggleCamera();
      else if ((e.key === 'Enter' || e.key === ' ') && this.status === 'crashed') {
        e.preventDefault();
        this.continueAfterCrash();
      }
    };
    const onResize = () => {
      applyScaling();
      this.engine.resize();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && this.status === 'playing') this.pause();
    };
    const onBlur = () => {
      if (this.status === 'playing') this.pause();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHidden);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHidden);
      ro?.disconnect();
    });

    this.engine.runRenderLoop(() => this.frame());
  }

  on(listener: (e: GameEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: GameEvent) {
    for (const l of this.listeners) l(e);
  }

  private setStatus(s: GameStatus) {
    if (this.status === s) return;
    this.status = s;
    this.audio.setActive(s === 'playing' || s === 'crashed');
    this.emit({ type: 'status', status: s });
  }

  get ticketCount() {
    return this.sim.tickets.length;
  }

  /** Білети поточного заїзду в порядку маршруту. */
  get tickets() {
    return this.sim.tickets;
  }

  /** Новий маршрут: нова симуляція й місто з його знаками, світлофорами й розміткою. */
  private setPlan(plan: RunPlan) {
    if (plan === this.plan) return;
    this.plan = plan;
    this.sim = new Sim(plan);
    this.city.dispose();
    this.city = buildCity(this.scene, false, plan.world);
    this.ambient.dispose();
    this.ambient = new Ambient(this.scene, this.cache, plan.world, plan.route, plan.seed);
  }

  // ---------- Керування спробою ----------

  private resetRun() {
    this.sim.reset();
    this.answers = [];
    this.snapshotAtDecision = null;
    this.retrying = false;
    this.accumulator = 0;
    this.effects.clear();
    this.guides.hide();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.spawnClock.clear();
    this.snapInterpolation();
    this.rig.snap();
  }

  /** plan — новий маршрут (без нього заїзд повторює поточний). */
  start(mode: Mode, plan?: RunPlan) {
    this.mode = mode;
    this.audio.unlock();
    this.audio.resume();
    if (plan) this.setPlan(plan);
    this.resetRun();
    this.rig.setMode(this.cameraMode);
    this.setStatus('playing');
    this.emitHud(true);
  }

  toMenu() {
    this.resetRun();
    this.rig.setMode('orbit');
    this.setStatus('menu');
  }

  pause() {
    if (this.status !== 'playing' && this.status !== 'decision' && this.status !== 'crashed') return;
    this.pausedFrom = this.status;
    this.audio.suspend();
    this.setStatus('paused');
  }

  resume() {
    if (this.status !== 'paused') return;
    this.accumulator = 0;
    this.audio.resume();
    this.setStatus(this.pausedFrom);
  }

  setMuted(m: boolean) {
    if (!m) this.audio.unlock();
    this.audio.setMuted(m);
  }

  toggleCamera() {
    if (this.status === 'menu') return;
    this.setCameraMode(this.cameraMode === 'follow' ? 'north' : 'follow');
    this.emit({ type: 'camera', mode: this.cameraMode });
  }

  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
    if (this.status !== 'menu') this.rig.setMode(mode);
  }

  /** Відповідь на білет. Зараховується лише перша відповідь; повтор після ДТП — для практики. */
  answer(option: number) {
    if (this.status !== 'decision') return;
    const ticket = this.sim.state.ticket;
    const correct = this.sim.answer(option);
    if (!this.retrying) this.answers.push({ ticket, option, correct });
    this.guides.hide();
    if (correct) this.audio.success();
    this.emit({ type: 'answer', ticket, option, correct, retry: this.retrying });
    this.setStatus('playing');
    this.emitHud(true);
  }

  /** Після ДТП: повернутися в момент рішення й обрати ще раз. */
  retryTicket() {
    if (this.status !== 'crashed' || !this.snapshotAtDecision) return;
    this.restoreDecision();
    this.retrying = true;
    this.showGuides();
    this.setStatus('decision');
    this.emit({ type: 'decision', ticket: this.sim.state.ticket, retry: true });
  }

  /** Після ДТП: показати, як треба було діяти, і їхати далі. */
  continueAfterCrash() {
    if (this.status !== 'crashed' || !this.snapshotAtDecision) return;
    this.restoreDecision();
    this.sim.answer(this.sim.correctOption());
    this.retrying = false;
    this.setStatus('playing');
    this.emit({ type: 'replay', ticket: this.sim.state.ticket });
  }

  private restoreDecision() {
    this.sim.restore(this.snapshotAtDecision!);
    this.effects.clear();
    this.accumulator = 0;
    this.snapInterpolation();
  }

  // ---------- Цикл ----------

  private frame() {
    if (this.disposed) return;
    const dt = Math.min(0.1, this.engine.getDeltaTime() / 1000);
    const running = this.status === 'playing' || this.status === 'crashed';
    if (running) {
      this.clock += dt;
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        this.captureInterpolation();
        this.handle(this.sim.step(SIM_DT));
        this.accumulator -= SIM_DT;
        steps++;
        if (this.status !== 'playing' && this.status !== 'crashed') break;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
      this.effects.update(dt);
      this.ambient.update(dt);
    } else if (this.status === 'decision' || this.status === 'menu') {
      // Світ на паузі, але кільця підказок пульсують.
      this.clock += dt;
      if (this.status === 'menu') this.ambient.update(dt);
    }
    const alpha = this.status === 'playing' || this.status === 'crashed' ? this.accumulator / SIM_DT : 1;
    this.render(dt, alpha);

    const e = this.sim.state.ego;
    this.audio.updateEngine(e.v, e.braking ? 0 : Math.min(1, e.v / 6), running);
    this.audio.updateSiren(running ? this.sirenVolume() : 0, this.clock);

    this.hudTimer += dt;
    if (this.hudTimer >= HUD_INTERVAL) {
      this.hudTimer = 0;
      this.emitHud(false);
    }
    this.scene.render();
  }

  private handle(events: ReturnType<Sim['step']>) {
    for (const ev of events) {
      switch (ev.type) {
        case 'decision':
          this.snapshotAtDecision = this.sim.snapshot();
          this.retrying = false;
          this.showGuides();
          this.audio.ding();
          this.setStatus('decision');
          this.emit({ type: 'decision', ticket: ev.ticket, retry: false });
          break;
        case 'crash': {
          const ped = ev.crash.kind === 'pedestrian';
          this.effects.burst(ev.crash.x, ev.crash.z, ev.crash.strength, ped);
          this.rig.kick(ped ? 0.6 : Math.min(2.2, 0.8 + ev.crash.strength * 0.1));
          this.audio.crash(ev.crash.strength, ped);
          this.emit({ type: 'crash', ticket: ev.crash.ticket, kind: ev.crash.kind });
          break;
        }
        case 'crashSettled':
          this.setStatus('crashed');
          break;
        case 'ticketCleared':
          this.retrying = false;
          this.emit({ type: 'cleared', ticket: ev.ticket });
          break;
        case 'finished': {
          const result = buildResult(this.mode, this.answers, this.sim.tickets.length, this.sim.state.time, this.plan.ids);
          this.audio.setActive(false);
          if (result.passed) this.audio.success();
          else this.audio.fail();
          this.setStatus('finished');
          this.emit({ type: 'finished', result });
          break;
        }
      }
    }
  }

  private showGuides() {
    const t = this.sim.currentTicket;
    if (!t) return;
    const st = this.sim.state;
    const actors = st.actors
      .filter((a) => a.ticket === st.ticket && a.alive && !a.parked)
      .map((a) => ({ x: a.x, z: a.z, heading: a.heading, size: a.kind === 'pedestrian' ? 2.6 : KINDS[a.kind].length + 1.4 }));
    const toS = Math.max(...t.actors.filter((a) => !a.spec.parked).map((a) => a.egoConflictS)) + 6;
    this.guides.show(this.sim.egoPath, st.ego.s, toS, actors);
  }

  private sirenVolume() {
    const e = this.sim.state.ego;
    let v = 0;
    for (const a of this.sim.state.actors)
      if (a.siren && a.alive && !a.body) v = Math.max(v, 1 - Math.hypot(a.x - e.x, a.z - e.z) / 110);
    return Math.max(0, v);
  }

  // ---------- Рендер ----------

  private egoPose(): Pose {
    const e = this.sim.state.ego;
    return { x: e.x, z: e.z, heading: e.heading };
  }

  private captureInterpolation() {
    this.prevEgo = this.egoPose();
    this.prevActors.clear();
    for (const a of this.sim.state.actors) this.prevActors.set(a.id, { x: a.x, z: a.z, heading: a.heading });
  }

  private snapInterpolation() {
    this.captureInterpolation();
  }

  private lerpPose(prev: Pose | undefined, cur: Pose, alpha: number): Pose {
    if (!prev) return cur;
    return { x: lerp(prev.x, cur.x, alpha), z: lerp(prev.z, cur.z, alpha), heading: lerpAngle(prev.heading, cur.heading, alpha) };
  }

  private render(dt: number, alpha: number) {
    const st = this.sim.state;
    const e = st.ego;
    const egoPose = this.lerpPose(this.prevEgo, this.egoPose(), alpha);
    const since = st.crash ? st.time - st.crash.time : -1;
    this.ego.update(egoPose, {
      steerAngle: e.body ? 0 : e.steer,
      wheelSpin: e.wheelSpin,
      braking: e.braking,
      indicator: e.indicator,
      clock: this.clock,
      siren: false,
      bounce: since >= 0 ? 0.14 * Math.exp(-4 * since) * Math.abs(Math.sin(since * 16)) : 0,
    });

    const ids = new Set(st.actors.map((a) => a.id));
    for (const [id, v] of this.views)
      if (!ids.has(id)) {
        v.dispose();
        this.views.delete(id);
        this.spawnClock.delete(id);
      }
    for (const a of st.actors) this.renderActor(a, alpha);

    this.city.trafficLights.update(st.lights, this.clock);
    this.guides.update(this.clock);
    // Під час ДТП авто крутиться — камера тримає напрямок, який був до удару.
    if (!st.crash) this.cameraHeading = egoPose.heading;
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    this.rig.aspect = w / Math.max(1, h);
    const card = this.status === 'decision' || this.status === 'crashed';
    const wide = (this.scene.getEngine().getRenderingCanvas()?.clientWidth ?? 0) > 640;
    this.rig.update(egoPose, dt, {
      focus: this.focus(),
      heading: this.cameraHeading,
      rightInset: card && wide ? 0.34 : 0,
      bottomInset: card && !wide ? 0.5 : 0,
    });
  }

  private renderActor(a: ActorState, alpha: number) {
    let view = this.views.get(a.id);
    if (!a.alive) {
      view?.setVisible(false);
      return;
    }
    const path = this.sim.actorPath(a);
    if (!view) {
      const specId = a.id.slice(a.id.indexOf(':') + 1);
      const spec = this.sim.prepared[a.ticket]?.actors.find((p) => p.spec.id === specId)?.spec;
      view =
        a.kind === 'pedestrian'
          ? new PedestrianView(this.scene, this.cache, a.color, undefined, a.cane)
          : new VehicleView(this.scene, this.cache, a.kind, a.color, true, spec?.model ?? pickCarModel(a.ticket, specId));
      this.views.set(a.id, view);
      this.spawnClock.set(a.id, this.clock);
    }
    view.setVisible(true);
    const pose = this.lerpPose(this.prevActors.get(a.id), { x: a.x, z: a.z, heading: a.heading }, alpha);
    const appear = Math.min(1, (this.clock - (this.spawnClock.get(a.id) ?? 0)) / 0.4);
    // Учасник проявляється на початку траєкторії й розчиняється наприкінці, а не з'являється раптово.
    const edge = a.body || a.parked ? 1 : Math.min(1, a.s / FADE, (path.length - a.s) / FADE);
    view.setAlpha(Math.max(0, Math.min(appear, edge)));
    if (view instanceof PedestrianView) {
      const fall = a.body ? Math.min(1, a.hitTime / 0.45) : 0;
      view.update(pose, a.s, a.v > 0 && !a.body, fall, (a.child ? 0.72 : 1) * PED_SCALE);
    } else {
      const r = a.kind === 'bus' ? 0.5 : 0.33;
      view.update(pose, {
        steerAngle: 0,
        wheelSpin: a.s / r,
        braking: !!a.body || (a.parked && !a.hazard),
        indicator: a.body || a.hazard ? 'hazard' : a.parked ? 'none' : this.turnSignal(path, a.s),
        clock: this.clock,
        siren: a.siren,
        bounce: 0,
      });
    }
  }

  /** Покажчик повороту учасника: за 25 м до повороту на його траєкторії. */
  private turnSignal(path: ReturnType<Sim['actorPath']>, s: number): IndicatorState {
    for (let d = 0; d <= 25; d += 2.5) {
      if (s + d > path.length) break;
      const k = curvatureAt(path, s + d, 1.5);
      if (Math.abs(k) > 0.08) return k > 0 ? 'right' : 'left';
    }
    return 'none';
  }

  private focus(): CameraFocus | null {
    const st = this.sim.state;
    const t = this.sim.currentTicket;
    if (!t || st.phase === 'driving' || st.phase === 'finished') return null;
    const main = t.actors.find((a) => !a.spec.parked) ?? t.actors[0];
    const p = st.crash ? { x: st.crash.x, z: st.crash.z } : main.conflict;
    return { point: p, weight: st.crash ? 0.6 : 0.45, dist: st.crash ? 40 : 48 };
  }

  private emitHud(force: boolean) {
    const st = this.sim.state;
    const marks: TicketMark[] = this.sim.tickets.map((_, i) => {
      const a = this.answers.find((x) => x.ticket === i);
      return a ? (a.correct ? 'ok' : 'fail') : null;
    });
    const hud: HudSnapshot = {
      speedKmh: Math.round(msToKmh(st.ego.v)),
      ticket: Math.min(st.ticket, this.sim.tickets.length - 1),
      total: this.sim.tickets.length,
      marks,
      fps: Math.round(this.engine.getFps()),
    };
    const key = JSON.stringify(hud);
    if (!force && key === this.lastHudKey) return;
    this.lastHudKey = key;
    this.lastHud = hud;
    this.emit({ type: 'hud', hud });
  }

  get hud() {
    return this.lastHud;
  }

  /** Відповідь, обрана для поточного білета (для екрана ДТП). */
  get lastAnswer() {
    return this.sim.state.answer;
  }

  dispose() {
    this.disposed = true;
    this.cleanup.forEach((c) => c());
    this.audio.dispose();
    this.listeners.clear();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
