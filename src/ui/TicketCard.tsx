import type { ActorKind } from '../sim/kinds';
import type { Mode } from '../storage/storage';
import type { Ticket } from '../tickets/types';
import type { ProcedureStep } from '../tickets/procedure';
import { AlertIcon, CheckIcon, PlayIcon, RestartIcon } from './icons';

const LETTERS = ['А', 'Б', 'В', 'Г'];

interface TicketProps {
  ticket: Ticket;
  index: number;
  total: number;
  retry: boolean;
  onAnswer(option: number): void;
}

/** Білет на паузі: питання й варіанти. Сцена лишається видимою — учасники підсвічені кільцями. */
export function TicketCard({ ticket, index, total, retry, onAnswer }: TicketProps) {
  return (
    <div className="sheet">
      <div className="glass card ticket scrollable" role="dialog" aria-label={`Білет ${index + 1}`}>
        <span className="eyebrow">
          Білет {index + 1} з {total} · {ticket.title}
        </span>
        {retry && <span className="badge warn">Повтор — не впливає на оцінку</span>}
        <h2>{ticket.question}</h2>
        <div className="options">
          {ticket.options.map((o, i) => (
            <button key={i} className="option" onClick={() => onAnswer(i)} autoFocus={i === 0}>
              <span className="letter">{LETTERS[i]}</span>
              <span>{o.text}</span>
              <kbd>{i + 1}</kbd>
            </button>
          ))}
        </div>
        <p className="muted tiny">Підсвічені учасники зупинені разом із вами. Білі стрілки — ваш намічений рух.</p>
      </div>
    </div>
  );
}

interface FeedbackProps {
  ticket: Ticket;
  kind: 'correct' | 'replay' | 'procedureDone';
  mode: Mode;
}

/** Плашка під час руху після відповіді. */
export function Feedback({ ticket, kind, mode }: FeedbackProps) {
  if (kind === 'procedureDone') {
    return (
      <div className="feedback glass info" role="status">
        <strong>
          <PlayIcon width={16} height={16} /> ДТП оформлено — продовжуємо маршрут
        </strong>
        <p>Ви діяли правильно в ситуації, тож вашої провини немає. Збитки відшкодовує страховик винуватця.</p>
      </div>
    );
  }
  if (mode === 'exam' && kind === 'correct') {
    return (
      <div className="feedback glass ok compact" role="status">
        <CheckIcon width={18} height={18} /> Відповідь зараховано
      </div>
    );
  }
  return (
    <div className={`feedback glass ${kind === 'correct' ? 'ok' : 'info'}`} role="status">
      <strong>
        {kind === 'correct' ? <CheckIcon width={18} height={18} /> : <PlayIcon width={16} height={16} />}
        {kind === 'correct' ? 'Правильно' : 'Ось як треба було діяти'}
      </strong>
      {mode === 'training' && (
        <>
          <p>{ticket.explanation}</p>
          <span className="rule">{ticket.rule}</span>
        </>
      )}
    </div>
  );
}

const CRASH_TITLES: Record<ActorKind, string> = {
  car: 'Зіткнення з автомобілем',
  bus: 'Зіткнення з автобусом',
  ambulance: 'Зіткнення зі швидкою',
  pedestrian: 'Наїзд на пішохода',
  cyclist: 'Наїзд на велосипедиста',
};

/** Спалах «ДТП» у момент удару. */
export function CrashFlash({ kind, innocent }: { kind: ActorKind; innocent?: boolean }) {
  return (
    <div className={`crash-flash ${innocent ? 'innocent' : ''}`} aria-live="assertive">
      <div className="crash-title">
        <AlertIcon width={30} height={30} />
        <span>ДТП</span>
      </div>
      <p>{innocent ? 'У вас в\'їхали ззаду — ви не винні' : CRASH_TITLES[kind]}</p>
    </div>
  );
}

interface ProcedureProps {
  step: ProcedureStep;
  index: number;
  total: number;
  /** Обрана відповідь (після вибору показуємо пояснення й кнопку «Далі»). */
  chosen: number | null;
  mode: Mode;
  onAnswer(option: number): void;
  onNext(): void;
}

/** Покроковий білет оформлення ДТП, у якому учень не винен. Сцена аварії лишається на екрані. */
export function ProcedureCard({ step, index, total, chosen, mode, onAnswer, onNext }: ProcedureProps) {
  const answered = chosen !== null;
  const right = step.options.findIndex((o) => o.correct);
  return (
    <div className="sheet">
      <div className="glass card ticket procedure scrollable" role="dialog" aria-label={step.title}>
        <span className="eyebrow danger">
          ДТП не з вашої вини · крок {index + 1} з {total}
        </span>
        <ol className="steps" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <li key={i} className={i < index ? 'done' : i === index ? 'current' : ''} />
          ))}
        </ol>
        <span className="step-title">{step.title}</span>
        <h2>{step.question}</h2>
        <div className="options">
          {step.options.map((o, i) => {
            const state = !answered ? '' : i === right ? 'right' : i === chosen ? 'wrong' : 'dim';
            return (
              <button key={i} className={`option ${state}`} onClick={() => onAnswer(i)} disabled={answered} autoFocus={i === 0}>
                <span className="letter">{LETTERS[i]}</span>
                <span>{o.text}</span>
                {!answered && <kbd>{i + 1}</kbd>}
              </button>
            );
          })}
        </div>
        {answered && (
          <>
            {(mode === 'training' || chosen !== right) && (
              <>
                <p className="small">{step.explanation}</p>
                <span className="rule">{step.rule}</span>
              </>
            )}
            <div className="actions">
              <button className="primary big" onClick={onNext} autoFocus>
                <PlayIcon width={18} height={18} /> {index + 1 < total ? 'Наступний крок' : 'Завершити й їхати далі'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface CrashProps {
  ticket: Ticket;
  option: number | null;
  kind: ActorKind;
  mode: Mode;
  onRetry(): void;
  onContinue(): void;
}

export function CrashCard({ ticket, option, kind, mode, onRetry, onContinue }: CrashProps) {
  const correct = ticket.options.findIndex((o) => o.correct);
  return (
    <div className="sheet">
      <div className="glass card crash-card scrollable" role="dialog" aria-label="ДТП">
        <header className="result-head">
          <div className="result-icon danger">
            <AlertIcon />
          </div>
          <div>
            <span className="eyebrow danger">ДТП · {ticket.title}</span>
            <h2>{CRASH_TITLES[kind]}</h2>
          </div>
        </header>
        {option !== null && (
          <div className="answer-row wrong">
            <span className="muted tiny">Ваша відповідь</span>
            <span>{ticket.options[option].text}</span>
          </div>
        )}
        {mode === 'training' ? (
          <>
            <div className="answer-row right">
              <span className="muted tiny">Правильно</span>
              <span>{ticket.options[correct].text}</span>
            </div>
            <p className="small">{ticket.explanation}</p>
            <span className="rule">{ticket.rule}</span>
          </>
        ) : (
          <p className="small muted">Пояснення буде в результатах іспиту.</p>
        )}
        <div className="actions">
          <button className="primary big" onClick={onContinue} autoFocus>
            <PlayIcon width={18} height={18} /> {mode === 'training' ? 'Показати правильно й далі' : 'Далі'}
          </button>
          {mode === 'training' && (
            <button className="secondary" onClick={onRetry}>
              <RestartIcon width={18} height={18} /> Переграти ситуацію
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
