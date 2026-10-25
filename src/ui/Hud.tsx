import type { HudSnapshot } from '../game/Game';
import type { Mode } from '../exercise/types';
import { EXERCISE } from '../config';
import { formatTime } from './format';
import { ArrowIcon, CameraIcon, PauseIcon, SoundOffIcon, SoundOnIcon } from './icons';

interface Props {
  hud: HudSnapshot;
  mode: Mode;
  sound: boolean;
  showFps: boolean;
  touch: boolean;
  onPause(): void;
  onCamera(): void;
  onSound(): void;
  onIndicator(side: 'left' | 'right'): void;
}

export function Hud({ hud, mode, sound, showFps, touch, onPause, onCamera, onSound, onIndicator }: Props) {
  const over = hud.speedKmh > EXERCISE.speedLimitKmh;
  return (
    <div className="hud">
      <div className="hud-left">
        <button className="icon-btn glass" onPointerDown={(e) => e.preventDefault()} onClick={onPause} aria-label="Пауза">
          <PauseIcon />
        </button>
        <button className="icon-btn glass" onClick={onCamera} aria-label="Змінити камеру">
          <CameraIcon />
        </button>
        <button className="icon-btn glass" onClick={onSound} aria-label={sound ? 'Вимкнути звук' : 'Увімкнути звук'}>
          {sound ? <SoundOnIcon /> : <SoundOffIcon />}
        </button>
        {showFps && <span className="fps glass">{hud.fps} FPS</span>}
      </div>

      <div className="hud-center">
        <button
          className={`indicator glass ${hud.indicator === 'left' ? 'on' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            onIndicator('left');
          }}
          aria-label="Лівий покажчик повороту"
          aria-pressed={hud.indicator === 'left'}
        >
          <ArrowIcon dir="left" />
        </button>
        <div className={`speedo glass ${over ? 'over' : ''}`}>
          <div className="speed">
            <span className="value">{hud.speedKmh}</span>
            <span className="unit">км/год</span>
          </div>
          <div className="speedo-meta">
            <span className="gear-badge">{hud.gear}</span>
            <span className="limit" title="Навчальний ліміт">
              {EXERCISE.speedLimitKmh}
            </span>
          </div>
        </div>
        <button
          className={`indicator glass ${hud.indicator === 'right' ? 'on' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            onIndicator('right');
          }}
          aria-label="Правий покажчик повороту"
          aria-pressed={hud.indicator === 'right'}
        >
          <ArrowIcon dir="right" />
        </button>
      </div>

      <div className="hud-right">
        <div className="task glass">
          <div className="task-head">
            <span className="eyebrow">
              {mode === 'training' && hud.hint.total > 0 ? `Крок ${hud.hint.step}/${hud.hint.total} · ${hud.hint.title}` : 'Завдання'}
            </span>
            <span className="timer">{formatTime(hud.elapsed)}</span>
          </div>
          <p>{hud.hint.text}</p>
          {hud.phase === 'stopping' && (
            <div className="hold" aria-label="Утримання зупинки">
              <div className="hold-fill" style={{ transform: `scaleX(${hud.holdProgress})` }} />
            </div>
          )}
        </div>
      </div>

      {!touch && (
        <div className="keys-hint muted tiny">
          W/↑ газ · S/↓ гальмо · Пробіл стоп · A/D кермо · 1–4 P/R/N/D · Q/E поворотники · C камера · Esc пауза
        </div>
      )}
    </div>
  );
}
