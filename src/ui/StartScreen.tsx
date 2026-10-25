import type { Mode } from '../exercise/types';
import type { Progress, QualitySetting, Settings, TouchSetting } from '../storage/storage';
import { formatTime } from './format';
import { SoundOffIcon, SoundOnIcon } from './icons';

interface Props {
  settings: Settings;
  progress: Progress;
  touch: boolean;
  onChange(patch: Partial<Settings>): void;
  onStart(mode: Mode): void;
}

const MODES: Array<{ id: Mode; title: string; text: string }> = [
  { id: 'training', title: 'Навчання', text: 'Покрокові підказки й пояснення помилок одразу.' },
  { id: 'check', title: 'Перевірка', text: 'Без підказок. Оцінка — після завершення.' },
];

export function StartScreen({ settings, progress, touch, onChange, onStart }: Props) {
  const p = progress[settings.mode];
  return (
    <div className="overlay start">
      <div className="glass card start-card scrollable">
        <header className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 32 32" width="30" height="30">
              <rect width="32" height="32" rx="9" fill="currentColor" />
              <path d="M7 20l3-7h12l3 7v3H7z" fill="#fff" />
              <circle cx="11" cy="23" r="2" fill="currentColor" stroke="#fff" strokeWidth="1.5" />
              <circle cx="21" cy="23" r="2" fill="currentColor" stroke="#fff" strokeWidth="1.5" />
            </svg>
          </div>
          <div>
            <h1>Cruise</h1>
            <p className="muted small">Практика водіння у 3D</p>
          </div>
        </header>

        <section className="exercise">
          <span className="eyebrow">Вправа</span>
          <h2>Зупинка в позначеній зоні</h2>
          <p className="muted small">
            Рушайте зі старту, проїдьте дорогою з поворотом, плавно зупиніться всім корпусом у зоні, зачекайте 2 с і
            увімкніть P.
          </p>
        </section>

        <div className="segmented" role="radiogroup" aria-label="Режим">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={settings.mode === m.id}
              className={settings.mode === m.id ? 'active' : ''}
              onClick={() => onChange({ mode: m.id })}
            >
              {m.title}
            </button>
          ))}
        </div>
        <p className="muted small mode-text">{MODES.find((m) => m.id === settings.mode)!.text}</p>

        <button className="primary big" onClick={() => onStart(settings.mode)}>
          Почати
        </button>

        <p className="stats small">
          Спроб: <b>{p.attempts}</b> · Успішних: <b>{p.successes}</b>
          {p.bestTime !== null && (
            <>
              {' '}
              · Найкращий час: <b>{formatTime(p.bestTime)}</b>
            </>
          )}
        </p>

        <div className="settings-row">
          <button
            className="chip"
            onClick={() => onChange({ sound: !settings.sound })}
            aria-pressed={settings.sound}
            aria-label={settings.sound ? 'Вимкнути звук' : 'Увімкнути звук'}
          >
            {settings.sound ? <SoundOnIcon width={18} height={18} /> : <SoundOffIcon width={18} height={18} />}
            {settings.sound ? 'Звук' : 'Без звуку'}
          </button>
          <label className="chip select">
            Якість
            <select value={settings.quality} onChange={(e) => onChange({ quality: e.target.value as QualitySetting })}>
              <option value="auto">Авто</option>
              <option value="low">Економна</option>
              <option value="high">Висока</option>
            </select>
          </label>
          <label className="chip select">
            Керування
            <select
              value={settings.touchControls}
              onChange={(e) => onChange({ touchControls: e.target.value as TouchSetting })}
            >
              <option value="auto">Авто</option>
              <option value="on">Екранне</option>
              <option value="off">Клавіатура</option>
            </select>
          </label>
        </div>

        {!touch && (
          <p className="muted tiny keys">
            W/↑ газ · S/↓ гальмо · Пробіл — повне гальмо · A/D, ←/→ кермо · 1–4 або P/R/N — селектор · Q/E
            поворотники · C камера · Esc пауза
          </p>
        )}
        <p className="muted tiny disclaimer">
          Авторська навчальна вправа. Оцінювання не є офіційними критеріями практичного іспиту.
        </p>
      </div>
    </div>
  );
}
