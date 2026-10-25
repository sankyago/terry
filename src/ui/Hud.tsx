import type { HudSnapshot } from '../game/Game';
import type { CameraMode, Mode } from '../storage/storage';
import { CameraIcon, CompassIcon, PauseIcon, SoundOffIcon, SoundOnIcon } from './icons';

interface Props {
  hud: HudSnapshot;
  mode: Mode;
  camera: CameraMode;
  sound: boolean;
  showFps: boolean;
  onPause(): void;
  onCamera(): void;
  onSound(): void;
}

export function Hud({ hud, mode, camera, sound, showFps, onPause, onCamera, onSound }: Props) {
  return (
    <div className="hud">
      <div className="hud-left">
        <button className="icon-btn glass" onClick={onPause} aria-label="Пауза">
          <PauseIcon />
        </button>
        <button
          className="icon-btn glass"
          onClick={onCamera}
          aria-label={camera === 'follow' ? 'Камера: північ угорі' : 'Камера: за авто'}
        >
          {camera === 'follow' ? <CameraIcon /> : <CompassIcon />}
        </button>
        <button className="icon-btn glass" onClick={onSound} aria-label={sound ? 'Вимкнути звук' : 'Увімкнути звук'}>
          {sound ? <SoundOnIcon /> : <SoundOffIcon />}
        </button>
        {showFps && <span className="fps glass">{hud.fps} FPS</span>}
      </div>

      <div className="hud-center glass progress" aria-label={`Білет ${hud.ticket + 1} з ${hud.total}`}>
        <span className="eyebrow">{mode === 'training' ? 'Навчання' : 'Іспит'}</span>
        <ol className="dots">
          {hud.marks.map((m, i) => (
            <li key={i} className={`${m ?? ''} ${i === hud.ticket && !m ? 'current' : ''}`}>
              {i + 1}
            </li>
          ))}
        </ol>
      </div>

      <div className="hud-right">
        <div className="speed-chip glass">
          <span className="value">{hud.speedKmh}</span>
          <span className="unit">км/год</span>
          <span className="autopilot">автопілот</span>
        </div>
      </div>
    </div>
  );
}
