import type { ActorKind } from '../sim/kinds';
import type { Mode } from '../storage/storage';
import type { Ticket } from '../tickets/tickets';
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
  kind: 'correct' | 'replay';
  mode: Mode;
}

/** Плашка під час руху після відповіді. */
export function Feedback({ ticket, kind, mode }: FeedbackProps) {
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
};

/** Спалах «ДТП» у момент удару. */
export function CrashFlash({ kind }: { kind: ActorKind }) {
  return (
    <div className="crash-flash" aria-live="assertive">
      <div className="crash-title">
        <AlertIcon width={30} height={30} />
        <span>ДТП</span>
      </div>
      <p>{CRASH_TITLES[kind]}</p>
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
