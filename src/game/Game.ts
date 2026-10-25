import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';

import { AudioEngine } from '../audio/AudioEngine';
import { CameraRig } from '../camera/CameraRig';
import { CAR, EXERCISE, MAX_STEPS_PER_FRAME, SIM_DT } from '../config';
import { Exercise } from '../exercise/exercise';
import type { Hint } from '../exercise/hints';
import { exerciseHint } from '../exercise/hints';
import type { ExercisePhase, ExerciseResult, FaultRecord, Mode } from '../exercise/types';
import { InputManager } from '../input/InputManager';
import { CarView } from '../scene/CarView';
import { buildWorld } from '../scene/buildWorld';
import { COLORS } from '../scene/palette';
import type { QualityProfile } from '../scene/quality';
import type { IndicatorSide } from '../sim/indicators';
import { Indicators } from '../sim/indicators';
import type { Pose } from '../sim/math';
import { lerp, lerpAngle, msToKmh } from '../sim/math';
import type { Track } from '../sim/track';
import { createTrack } from '../sim/track';
import type { Gear, VehicleState } from '../sim/vehicle';
import { GEARS, createVehicle, requestGear, resetVehicle, steerAngle, stepVehicle } from '../sim/vehicle';
import type { CarTrackState } from '../sim/world';
import { evaluateCarOnTrack, resolveCollisions } from '../sim/world';
import type { CameraMode } from '../storage/storage';

export type GameStatus = 'menu' | 'playing' | 'paused' | 'finished';

export interface HudSnapshot {
  speedKmh: number;
  gear: Gear;
  indicator: IndicatorSide;
  phase: ExercisePhase;
  elapsed: number;
  holdProgress: number;
  inZone: boolean;
  hint: Hint;
  faults: number;
  fps: number;
}

export type GameEvent =
  | { type: 'hud'; hud: HudSnapshot }
  | { type: 'status'; status: GameStatus }
  | { type: 'fault'; fault: FaultRecord }
  | { type: 'toast'; text: string }
  | { type: 'finished'; result: ExerciseResult }
  | { type: 'camera'; mode: CameraMode };

export interface GameOptions {
  quality: QualityProfile;
  mode: Mode;
  camera: CameraMode;
  sound: boolean;
}

const HUD_INTERVAL = 0.1;

export class Game {
  readonly input = new InputManager();
  readonly track: Track;
  status: GameStatus = 'menu';
  mode: Mode;

  private engine: Engine;
  private scene: Scene;
  private rig: CameraRig;
  private car: CarView;
  private zoneMat: ReturnType<typeof buildWorld>['zoneMaterial'];
  private audio = new AudioEngine();
  private vehicle: VehicleState;
  private prev: Pose;
  private exercise: Exercise;
  private indicators = new Indicators();
  private carState: CarTrackState = { inZone: false, offRoad: false, s: 0, lateral: 0 };
  private listeners = new Set<(e: GameEvent) => void>();
  private accumulator = 0;
  private simTime = 0;
  private hudTimer = 0;
  private wheelSpin = 0;
  private lastLit = false;
  private cameraMode: CameraMode;
  private lastHintKey = '';
  private lastHud: HudSnapshot | null = null;
  private zoneLit: boolean | null = null;
  private cleanup: Array<() => void> = [];
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, opts: GameOptions) {
    this.mode = opts.mode;
    this.cameraMode = opts.camera;
    this.track = createTrack();
    this.vehicle = createVehicle(this.track.start);
    this.prev = { ...this.track.start };
    this.exercise = new Exercise({ mode: opts.mode, curveStartS: this.track.curve.startS });
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
    scene.autoClearDepthAndStencil = true;
    const sky = Color3.FromHexString(COLORS.sky);
    scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    scene.ambientColor = new Color3(0.3, 0.32, 0.34);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = sky;
    scene.fogStart = 70;
    scene.fogEnd = 220;

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.62;
    hemi.groundColor = new Color3(0.55, 0.6, 0.58);
    const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35), scene);
    sun.intensity = 0.62;
    sun.position = new Vector3(40, 60, -20);

    const world = buildWorld(scene, this.track);
    this.zoneMat = world.zoneMaterial;
    this.car = new CarView(scene, !opts.quality.shadows);
    if (opts.quality.shadows) {
      const sg = new ShadowGenerator(1024, sun);
      sg.usePercentageCloserFiltering = true;
      sg.bias = 0.002;
      for (const m of this.car.casters) sg.addShadowCaster(m, false);
    }

    const center = {
      x: (this.track.bounds.minX + this.track.bounds.maxX) / 2,
      z: (this.track.bounds.minZ + this.track.bounds.maxZ) / 2,
    };
    this.rig = new CameraRig(scene, center);
    scene.activeCamera = this.rig.camera;
    this.updateVisuals(1);

    this.input.attachKeyboard(window, {
      gear: (g) => this.requestGear(g),
      shiftUp: () => this.shiftBy(-1),
      shiftDown: () => this.shiftBy(1),
      indicator: (s) => this.toggleIndicator(s),
      camera: () => this.toggleCamera(),
      pause: () => (this.status === 'paused' ? this.resume() : this.pause()),
    });

    const onResize = () => {
      applyScaling();
      this.engine.resize();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') this.interrupt();
    };
    const onBlur = () => this.interrupt();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHidden);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    this.cleanup.push(() => {
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
    this.audio.setActive(s === 'playing');
    this.emit({ type: 'status', status: s });
  }

  /** Повний скидання спроби: авто, вправа, покажчики, ввід, камера. */
  private resetAttempt() {
    resetVehicle(this.vehicle, this.track.start);
    this.prev = { ...this.track.start };
    this.exercise = new Exercise({ mode: this.mode, curveStartS: this.track.curve.startS });
    this.indicators.reset();
    this.input.resetAll();
    this.accumulator = 0;
    this.simTime = 0;
    this.wheelSpin = 0;
    this.lastHintKey = '';
    this.carState = evaluateCarOnTrack(this.vehicle, this.track);
    this.rig.snap();
  }

  start(mode: Mode) {
    this.mode = mode;
    this.audio.unlock();
    this.audio.resume();
    this.resetAttempt();
    this.applyCamera();
    this.setStatus('playing');
    this.emitHud(true);
  }

  restart() {
    this.start(this.mode);
  }

  toMenu() {
    this.resetAttempt();
    this.rig.setMode('orbit');
    this.car.setDriverView(false);
    this.setStatus('menu');
  }

  pause() {
    if (this.status !== 'playing') return;
    this.input.resetAll();
    this.audio.suspend();
    this.setStatus('paused');
  }

  resume() {
    if (this.status !== 'paused') return;
    this.input.resetAll();
    this.accumulator = 0;
    this.audio.resume();
    this.setStatus('playing');
  }

  /** Втрата фокусу, приховування вкладки чи pointercancel: скидаємо команди і ставимо паузу. */
  interrupt() {
    this.input.resetAll();
    this.pause();
  }

  setMuted(m: boolean) {
    if (!m) this.audio.unlock();
    this.audio.setMuted(m);
  }

  toggleCamera() {
    if (this.status === 'menu') return;
    this.cameraMode = this.cameraMode === 'chase' ? 'driver' : 'chase';
    this.applyCamera();
    this.emit({ type: 'camera', mode: this.cameraMode });
  }

  private applyCamera() {
    this.rig.setMode(this.cameraMode);
    this.car.setDriverView(this.cameraMode === 'driver');
  }

  toggleIndicator(side: 'left' | 'right') {
    if (this.status !== 'playing') return;
    this.indicators.toggle(side);
    this.emitHud(true);
  }

  requestGear(g: Gear) {
    if (this.status !== 'playing') return;
    const res = requestGear(this.vehicle, g, this.input.brakeHeld);
    if (!res.ok) {
      this.emit({
        type: 'toast',
        text:
          res.reason === 'brake'
            ? 'Натисніть гальмо, щоб вивести селектор із P.'
            : 'Спершу повністю зупиніться — на ходу цю передачу не ввімкнути.',
      });
    }
    this.emitHud(true);
  }

  private shiftBy(delta: number) {
    const i = GEARS.indexOf(this.vehicle.gear) + delta;
    if (i >= 0 && i < GEARS.length) this.requestGear(GEARS[i]);
  }

  private frame() {
    if (this.disposed) return;
    const dt = Math.min(0.25, this.engine.getDeltaTime() / 1000);
    if (this.status === 'playing') {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        this.simStep();
        this.accumulator -= SIM_DT;
        steps++;
        if (this.status !== 'playing') break;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    const alpha = this.status === 'playing' ? this.accumulator / SIM_DT : 1;
    this.updateVisuals(alpha);
    this.rig.update(this.renderPose(alpha), dt);
    this.audio.updateEngine(this.vehicle.speed, this.vehicle.throttle, this.status === 'playing');

    this.hudTimer += dt;
    if (this.hudTimer >= HUD_INTERVAL) {
      this.hudTimer = 0;
      this.emitHud(false);
    }
    this.scene.render();
  }

  private simStep() {
    const v = this.vehicle;
    this.prev = { x: v.x, z: v.z, heading: v.heading };
    const cmd = this.input.sample(SIM_DT);
    stepVehicle(v, cmd, SIM_DT);
    const contacts = resolveCollisions(v, this.track.obstacles);
    for (const c of contacts) if (c.impact > 0.4) this.audio.thud(c.impact);
    this.indicators.update(v.steer);
    this.simTime += SIM_DT;
    this.wheelSpin += (v.speed / CAR.wheelRadius) * SIM_DT;
    const lit = this.indicators.side !== 'none' && Indicators.lit(this.simTime);
    if (lit !== this.lastLit && this.indicators.side !== 'none') this.audio.tick(lit);
    this.lastLit = lit;

    this.carState = evaluateCarOnTrack(v, this.track);
    const events = this.exercise.step({
      dt: SIM_DT,
      speedKmh: msToKmh(v.speed),
      gear: v.gear,
      inZone: this.carState.inZone,
      offRoad: this.carState.offRoad,
      contacts,
      s: this.carState.s,
      moved: v.odometer,
      indicator: this.indicators.side,
    });
    for (const e of events) {
      if (e.type === 'fault') this.emit({ type: 'fault', fault: e.fault });
      else if (e.type === 'finished') {
        this.indicators.reset();
        this.input.resetAll();
        if (e.result.success) this.audio.success();
        else this.audio.fail();
        this.setStatus('finished');
        this.emit({ type: 'finished', result: e.result });
      }
    }
  }

  private renderPose(alpha: number): Pose {
    const v = this.vehicle;
    return {
      x: lerp(this.prev.x, v.x, alpha),
      z: lerp(this.prev.z, v.z, alpha),
      heading: lerpAngle(this.prev.heading, v.heading, alpha),
    };
  }

  private updateVisuals(alpha: number) {
    const v = this.vehicle;
    const lit = this.indicators.side !== 'none' && Indicators.lit(this.simTime);
    this.car.update(this.renderPose(alpha), {
      steerAngle: steerAngle(v),
      steer: v.steer,
      wheelSpin: this.wheelSpin,
      braking: v.brake > 0.05 || v.gear === 'P',
      reversing: v.gear === 'R',
      leftLit: lit && this.indicators.side === 'left',
      rightLit: lit && this.indicators.side === 'right',
    });
    // Підсвічування зони — підказка лише в режимі навчання.
    const zoneLit = this.mode === 'training' && this.status !== 'menu' && this.carState.inZone;
    if (zoneLit !== this.zoneLit) {
      this.zoneLit = zoneLit;
      this.zoneMat.emissiveColor = zoneLit ? new Color3(0.2, 0.75, 0.45) : Color3.FromHexString(COLORS.zone).scale(0.4);
      this.zoneMat.alpha = zoneLit ? 0.5 : 0.32;
    }
  }

  private emitHud(force: boolean) {
    const v = this.vehicle;
    const ex = this.exercise;
    const hint = exerciseHint({
      mode: this.mode,
      phase: ex.phase,
      gear: v.gear,
      brake: this.input.brakeHeld,
      speedKmh: msToKmh(v.speed),
      s: this.carState.s,
      curveStartS: this.track.curve.startS,
      curveEndS: this.track.curve.endS,
      zoneStartS: this.track.zoneS.start,
      zoneEndS: this.track.zoneS.end,
      holdTime: ex.holdTime,
      stopHold: ex.stopHoldSeconds,
      inZone: this.carState.inZone,
      indicator: this.indicators.side,
      limitKmh: EXERCISE.speedLimitKmh,
    });
    const hud: HudSnapshot = {
      speedKmh: Math.round(Math.abs(msToKmh(v.speed))),
      gear: v.gear,
      indicator: this.indicators.side,
      phase: ex.phase,
      elapsed: Math.floor(ex.elapsed * 10) / 10,
      holdProgress: Math.min(1, ex.holdTime / ex.stopHoldSeconds),
      inZone: this.carState.inZone,
      hint,
      faults: ex.faults.length,
      fps: Math.round(this.engine.getFps()),
    };
    const key = JSON.stringify(hud);
    if (!force && key === this.lastHintKey) return;
    this.lastHintKey = key;
    this.lastHud = hud;
    this.emit({ type: 'hud', hud });
  }

  get hud() {
    return this.lastHud;
  }

  dispose() {
    this.disposed = true;
    this.cleanup.forEach((c) => c());
    this.input.dispose();
    this.audio.dispose();
    this.listeners.clear();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
