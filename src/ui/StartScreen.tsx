import type { Mode, Progress, QualitySetting, Settings } from '../storage/storage';
import { EXAM_MAX_MISTAKES } from '../storage/storage';
import { TICKETS } from '../tickets/tickets';
import { SoundOffIcon, SoundOnIcon } from './icons';

interface Props {
  settings: Settings;
  progress: Progress;
  onChange(patch: Partial<Settings>): void;
  onStart(mode: Mode): void;
}

const MODES: Array<{ id: Mode; title: string; text: string }> = [
  {
    id: 'training',
    title: 'Навчання',
    text: 'Пояснення після кожної відповіді. Після ДТП можна переграти ситуацію.',
  },
  {
    id: 'exam',
    title: 'Іспит',
    text: `Без пояснень до кінця маршруту. Складено, якщо помилок не більше ${EXAM_MAX_MISTAKES}.`,
  },
];

export function StartScreen({ settings, progress, onChange, onStart }: Props) {
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
            <p className="muted small">Інтерактивні білети ПДР</p>
          </div>
        </header>

        <section className="exercise">
          <span className="eyebrow">Маршрут містом · {TICKETS.length} ситуацій</span>
          <h2>Ви керуєте рішеннями, а не кермом</h2>
          <p className="muted small">
            Авто саме їде містом. Коли воно зупиняється, гра стає на паузу й показує білет: оберіть, як діяти. Помилка —
            і ви побачите, чим вона закінчується на дорозі.
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
          Почати маршрут
        </button>

        <p className="stats small">
          Спроб: <b>{p.attempts}</b>
          {settings.mode === 'exam' && (
            <>
              {' '}
              · Складено: <b>{p.passes}</b>
            </>
          )}
          {p.bestScore !== null && (
            <>
              {' '}
              · Найкраще: <b>
                {p.bestScore}/{TICKETS.length}
              </b>
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
            Камера
            <select value={settings.camera} onChange={(e) => onChange({ camera: e.target.value as Settings['camera'] })}>
              <option value="follow">За авто</option>
              <option value="north">Північ угорі</option>
            </select>
          </label>
          <label className="chip select">
            Якість
            <select value={settings.quality} onChange={(e) => onChange({ quality: e.target.value as QualitySetting })}>
              <option value="auto">Авто</option>
              <option value="low">Економна</option>
              <option value="high">Висока</option>
            </select>
          </label>
        </div>

        <p className="muted tiny keys">1–3 — відповідь · C — камера · Esc — пауза · Enter — далі після ДТП</p>
        <p className="muted tiny disclaimer">
          Навчальний тренажер. Ситуації спрощені; пункти ПДР вказано для довідки — звіряйтеся з чинною редакцією.
        </p>
      </div>
    </div>
  );
}
