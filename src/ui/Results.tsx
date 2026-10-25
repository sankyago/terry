import type { ModeProgress, RunResult } from '../storage/storage';
import { EXAM_MAX_MISTAKES } from '../storage/storage';
import type { Ticket } from '../tickets/tickets';
import { formatTime } from './format';
import { CheckIcon, CrossIcon, RestartIcon } from './icons';

interface Props {
  result: RunResult;
  tickets: Ticket[];
  progress: ModeProgress;
  onRetry(): void;
  onSwitchMode(): void;
  onMenu(): void;
}

export function Results({ result, tickets, progress, onRetry, onSwitchMode, onMenu }: Props) {
  const mistakes = result.total - result.correct;
  const exam = result.mode === 'exam';
  const ok = exam ? result.passed : mistakes === 0;
  const title = exam ? (result.passed ? 'Іспит складено' : 'Іспит не складено') : ok ? 'Маршрут без жодного ДТП' : 'Маршрут пройдено';
  return (
    <div className="overlay center dim">
      <div className={`glass card results ${ok ? 'passed' : exam ? 'failed' : 'passedWithRemarks'} scrollable`} role="dialog" aria-label="Результати">
        <header className="result-head">
          <div className="result-icon">{ok ? <CheckIcon /> : <CrossIcon />}</div>
          <div>
            <span className="eyebrow">{exam ? 'Іспит' : 'Навчання'} · Інтерактивні білети</span>
            <h2>{title}</h2>
          </div>
        </header>

        <div className="result-stats">
          <div>
            <span className="muted tiny">Правильно</span>
            <b>
              {result.correct}/{result.total}
            </b>
          </div>
          <div>
            <span className="muted tiny">ДТП</span>
            <b>{mistakes}</b>
          </div>
          <div>
            <span className="muted tiny">Час</span>
            <b>{formatTime(result.time)}</b>
          </div>
        </div>
        {exam && (
          <p className="muted tiny">
            Критерій: не більше {EXAM_MAX_MISTAKES} помилки. Складено {progress.passes} з {progress.attempts} спроб.
          </p>
        )}

        <ul className="ticket-list">
          {tickets.map((t, i) => {
            const a = result.answers.find((x) => x.ticket === i);
            const right = t.options.find((o) => o.correct)!;
            return (
              <li key={t.id} className={a?.correct ? 'ok' : 'fail'}>
                <div className="ticket-row">
                  <span className="mark">{a?.correct ? <CheckIcon width={16} height={16} /> : <CrossIcon width={16} height={16} />}</span>
                  <b>
                    {i + 1}. {t.title}
                  </b>
                </div>
                {a && !a.correct && (
                  <div className="ticket-detail">
                    <span>
                      <span className="muted">Ви: </span>
                      {t.options[a.option].text}
                    </span>
                    <span>
                      <span className="muted">Правильно: </span>
                      {right.text}
                    </span>
                    <span className="muted tiny">
                      {t.explanation} <span className="rule">{t.rule}</span>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="actions">
          <button className="primary big" onClick={onRetry} autoFocus>
            <RestartIcon width={18} height={18} /> Пройти ще раз
          </button>
          <button className="secondary" onClick={onSwitchMode}>
            {exam ? 'Режим «Навчання»' : 'Спробувати «Іспит»'}
          </button>
          <button className="link" onClick={onMenu}>
            До меню
          </button>
        </div>
        <p className="muted tiny disclaimer">Навчальний тренажер, не офіційний іспит.</p>
      </div>
    </div>
  );
}
