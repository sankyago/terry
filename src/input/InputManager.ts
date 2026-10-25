import type { DriveCommand, Gear } from '../sim/vehicle';
import { approach } from '../sim/math';

export interface InputActions {
  gear(g: Gear): void;
  shiftUp(): void;
  shiftDown(): void;
  indicator(side: 'left' | 'right'): void;
  camera(): void;
  pause(): void;
}

const GAS = ['KeyW', 'ArrowUp'];
const BRAKE = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Збирає команди з клавіатури та екранних елементів у змінний стан,
 * без React state. Симуляція читає його на кожному фіксованому кроці.
 */
export class InputManager {
  /** Екранне кермо: -1…1, null — не торкаються. */
  touchSteer: number | null = null;
  touchThrottle = 0;
  touchBrake = 0;

  private keys = new Set<string>();
  private kbSteer = 0;
  private kbThrottle = 0;
  private kbBrake = 0;
  private detach: (() => void) | null = null;

  attachKeyboard(target: Window, actions: InputActions) {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) {
        this.keys.add(e.code);
        return;
      }
      this.keys.add(e.code);
      switch (e.code) {
        case 'Digit1':
        case 'KeyP':
          actions.gear('P');
          break;
        case 'Digit2':
        case 'KeyR':
          actions.gear('R');
          break;
        case 'Digit3':
        case 'KeyN':
          actions.gear('N');
          break;
        case 'Digit4':
          actions.gear('D');
          break;
        case 'KeyZ':
          actions.shiftUp();
          break;
        case 'KeyX':
          actions.shiftDown();
          break;
        case 'KeyQ':
          actions.indicator('left');
          break;
        case 'KeyE':
          actions.indicator('right');
          break;
        case 'KeyC':
          actions.camera();
          break;
        case 'Escape':
          actions.pause();
          break;
      }
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    this.detach = () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
    };
  }

  dispose() {
    this.detach?.();
    this.detach = null;
  }

  private any(codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Скидає всі затиснуті команди (втрата фокусу, pointercancel, пауза). */
  resetAll() {
    this.keys.clear();
    this.touchSteer = null;
    this.touchThrottle = 0;
    this.touchBrake = 0;
    this.kbSteer = 0;
    this.kbThrottle = 0;
    this.kbBrake = 0;
  }

  /** Поточне натискання гальма без урахування рампи — для перевірки блокування P. */
  get brakeHeld(): number {
    return Math.max(this.touchBrake, this.any(BRAKE) || this.keys.has('Space') ? 1 : 0, this.kbBrake);
  }

  sample(dt: number): DriveCommand {
    const left = this.any(LEFT);
    const right = this.any(RIGHT);
    const steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
    this.kbSteer = approach(this.kbSteer, steerTarget, (steerTarget === 0 ? 5 : 2.4) * dt);

    // Клавіші дають плавну рампу, щоб короткими натисканнями можна було дозувати газ і гальмо.
    this.kbThrottle = this.any(GAS) ? approach(this.kbThrottle, 1, 1.4 * dt) : 0;
    if (this.keys.has('Space')) this.kbBrake = 1;
    else this.kbBrake = this.any(BRAKE) ? approach(this.kbBrake, 1, 2.2 * dt) : 0;

    return {
      throttle: Math.max(this.kbThrottle, this.touchThrottle),
      brake: Math.max(this.kbBrake, this.touchBrake),
      steer: this.touchSteer ?? this.kbSteer,
    };
  }
}
