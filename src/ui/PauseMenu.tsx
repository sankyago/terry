import type { Settings } from '../storage/storage';
import { CameraIcon, PlayIcon, RestartIcon, SoundOffIcon, SoundOnIcon } from './icons';

interface Props {
  settings: Settings;
  onResume(): void;
  onRestart(): void;
  onCamera(): void;
  onSound(): void;
  onFps(): void;
  onMenu(): void;
}

export function PauseMenu({ settings, onResume, onRestart, onCamera, onSound, onFps, onMenu }: Props) {
  return (
    <div className="overlay center dim">
      <div className="glass card pause-card scrollable" role="dialog" aria-label="Пауза">
        <h2>Пауза</h2>
        <button className="primary big" onClick={onResume} autoFocus>
          <PlayIcon width={18} height={18} /> Продовжити
        </button>
        <div className="grid2">
          <button className="secondary" onClick={onRestart}>
            <RestartIcon width={18} height={18} /> Почати заново
          </button>
          <button className="secondary" onClick={onCamera}>
            <CameraIcon width={18} height={18} /> {settings.camera === 'chase' ? 'Камера: ззаду' : 'Камера: водій'}
          </button>
          <button className="secondary" onClick={onSound}>
            {settings.sound ? <SoundOnIcon width={18} height={18} /> : <SoundOffIcon width={18} height={18} />}
            {settings.sound ? 'Звук увімкнено' : 'Звук вимкнено'}
          </button>
          <button className="secondary" onClick={onFps} aria-pressed={settings.showFps}>
            {settings.showFps ? 'Сховати FPS' : 'Показати FPS'}
          </button>
        </div>
        <button className="link" onClick={onMenu}>
          До меню
        </button>
      </div>
    </div>
  );
}
