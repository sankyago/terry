import type { ExerciseResult, FaultKind } from '../exercise/types';
import { FAIL_LABELS, FAULT_LABELS } from '../exercise/texts';
import type { ModeProgress } from '../storage/storage';
import { formatTime } from './format';
import { CheckIcon, CrossIcon, RestartIcon } from './icons';

interface Props {
  result: ExerciseResult;
  progress: ModeProgress;
  onRetry(): void;
  onSwitchMode(): void;
  onMenu(): void;
}

const TITLES = {
  passed: 'Вправу виконано',
  passedWithRemarks: 'Виконано із зауваженнями',
  failed: 'Вправу не виконано',
} as const;

export function Results({ result, progress, onRetry, onSwitchMode, onMenu }: Props) {
  const counts = new Map<FaultKind, number>();
  for (const f of result.faults) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  const best = result.success && progress.bestTime !== null && Math.abs(progress.bestTime - result.time) < 1e-6;
  return (
    <div className="overlay center dim">
      <div className={`glass card results ${result.status} scrollable`} role="dialog" aria-label="Результати">
        <header className="result-head">
          <div className="result-icon">{result.success ? <CheckIcon /> : <CrossIcon />}</div>
          <div>
            <span className="eyebrow">{result.mode === 'training' ? 'Навчання' : 'Перевірка'} · Зупинка в позначеній зоні</span>
            <h2>{TITLES[result.status]}</h2>
          </div>
        </header>

        <div className="result-stats">
          <div>
            <span className="muted tiny">Час</span>
            <b>{formatTime(result.time)}</b>
            {best && <span className="badge">Рекорд</span>}
          </div>
          <div>
            <span className="muted tiny">Помилки</span>
            <b>{result.faults.length}</b>
          </div>
          <div>
            <span className="muted tiny">Успішних</span>
            <b>
              {progress.successes}/{progress.attempts}
            </b>
          </div>
        </div>

        {result.failReasons.length > 0 && (
          <ul className="list fail">
            {result.failReasons.map((r) => (
              <li key={r}>{FAIL_LABELS[r]}</li>
            ))}
          </ul>
        )}
        {counts.size > 0 && (
          <ul className="list faults">
            {[...counts].map(([k, n]) => (
              <li key={k}>
                <span>{FAULT_LABELS[k]}</span>
                <b>×{n}</b>
              </li>
            ))}
          </ul>
        )}

        <div className="recs">
          <span className="eyebrow">Рекомендації</span>
          <ul>
            {result.recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>

        <div className="actions">
          <button className="primary big" onClick={onRetry} autoFocus>
            <RestartIcon width={18} height={18} /> Спробувати ще раз
          </button>
          <button className="secondary" onClick={onSwitchMode}>
            {result.mode === 'training' ? 'Режим «Перевірка»' : 'Режим «Навчання»'}
          </button>
          <button className="link" onClick={onMenu}>
            До меню
          </button>
        </div>
        <p className="muted tiny disclaimer">Авторське навчальне оцінювання, не офіційні критерії іспиту.</p>
      </div>
    </div>
  );
}
