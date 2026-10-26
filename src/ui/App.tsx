import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameStatus, HudSnapshot } from '../game/Game';
import { Game } from '../game/Game';
import type { ActorKind } from '../sim/kinds';
import { resolveQuality } from '../scene/quality';
import type { Mode, Progress, RunResult, Settings } from '../storage/storage';
import { load, markSeen, recordResult, save } from '../storage/storage';
import type { RunPlan } from '../tickets/plan';
import { createRunPlan, planForIds, withInnocent } from '../tickets/plan';
import { ACCIDENT_STEPS } from '../tickets/procedure';
import { TICKETS } from '../tickets/tickets';
import { Hud } from './Hud';
import { PauseMenu } from './PauseMenu';
import { Results } from './Results';
import { RotateHint } from './RotateHint';
import { StartScreen } from './StartScreen';
import { CrashCard, CrashFlash, Feedback, ProcedureCard, TicketCard } from './TicketCard';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

/**
 * Маршрут нового заїзду: випадкові білети, спершу ще не бачені.
 * У режимі налагодження ?tickets=id1,id2 задає білети й порядок, ?seed= — генератор.
 */
function nextPlan(seen: string[]): RunPlan {
  const seed = DEBUG && params.has('seed') ? Number(params.get('seed')) : Math.floor(Math.random() * 1e9);
  const ids = DEBUG ? params.get('tickets') : null;
  const plan = ids ? planForIds(ids.split(','), seed) : createRunPlan(seed, new Set(seen));
  // ?innocent=N — у білеті N (з нуля) учня гарантовано вдарять ззаду.
  return DEBUG && params.has('innocent') ? withInnocent(plan, Number(params.get('innocent'))) : plan;
}

interface Decision {
  ticket: number;
  retry: boolean;
}
interface FeedbackState {
  ticket: number;
  kind: 'correct' | 'replay' | 'procedureDone';
}
interface ProcedureState {
  step: number;
  chosen: number | null;
}
interface CrashState {
  ticket: number;
  kind: ActorKind;
  option: number | null;
}

export function App() {
  const initial = useMemo(() => load(), []);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [progress, setProgress] = useState<Progress>(initial.progress);
  const [status, setStatus] = useState<GameStatus>('menu');
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [crash, setCrash] = useState<CrashState | null>(null);
  const [flash, setFlash] = useState<{ kind: ActorKind; innocent: boolean; id: number } | null>(null);
  const [procedure, setProcedure] = useState<ProcedureState | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const progressRef = useRef(progress);
  progressRef.current = progress;
  /** Перший заїзд їде маршрутом, який уже видно в меню. */
  const freshPlan = useRef(true);

  const quality = useMemo(() => resolveQuality(settings.quality), [settings.quality]);

  useEffect(() => save({ settings, progress }), [settings, progress]);

  // Плашка з поясненням ховається через кілька секунд після того, як ситуацію пройдено.
  useEffect(() => {
    if (!feedback) return;
    const id = window.setTimeout(() => setFeedback(null), 9000);
    return () => window.clearTimeout(id);
  }, [feedback]);

  // Гра створюється один раз на рівень якості (антиаліасинг задається при створенні WebGL-контексту).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let g: Game;
    try {
      const s = settingsRef.current;
      g = new Game(canvas, { plan: nextPlan(progressRef.current.seen), quality, mode: s.mode, camera: s.camera, sound: s.sound });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const off = g.on((e) => {
      switch (e.type) {
        case 'hud':
          setHud(e.hud);
          break;
        case 'status':
          setStatus(e.status);
          break;
        case 'decision':
          setFeedback(null);
          setCrash(null);
          setDecision({ ticket: e.ticket, retry: e.retry });
          break;
        case 'answer':
          setDecision(null);
          if (e.correct) setFeedback({ ticket: e.ticket, kind: 'correct' });
          break;
        case 'crash':
          setFlash({ kind: e.kind, innocent: e.innocent, id: Date.now() });
          setCrash({ ticket: e.ticket, kind: e.kind, option: g.lastAnswer });
          break;
        case 'procedure':
          setProcedure({ step: e.step, chosen: null });
          break;
        case 'procedureAnswer':
          setProcedure({ step: e.step, chosen: e.option });
          break;
        case 'procedureDone':
          setProcedure(null);
          setCrash(null);
          setFeedback({ ticket: e.ticket, kind: 'procedureDone' });
          break;
        case 'replay':
          setCrash(null);
          setFeedback({ ticket: e.ticket, kind: 'replay' });
          break;
        case 'cleared':
          break;
        case 'finished':
          setFeedback(null);
          setResult(e.result);
          setProgress((p) => recordResult(p, e.result));
          break;
        case 'camera':
          setSettings((s) => ({ ...s, camera: e.mode }));
          break;
      }
    });
    setGame(g);
    setStatus('menu');
    // Для автоматичних перевірок у браузері: ?debug відкриває доступ до гри з консолі.
    if (DEBUG) (window as unknown as { __cruise?: Game }).__cruise = g;
    freshPlan.current = true;
    return () => {
      off();
      g.dispose();
      setGame(null);
    };
  }, [quality]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 1800);
    return () => window.clearTimeout(id);
  }, [flash]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const start = (mode: Mode) => {
    update({ mode });
    setResult(null);
    setDecision(null);
    setFeedback(null);
    setCrash(null);
    setFlash(null);
    setProcedure(null);
    game?.setMuted(!settings.sound);
    game?.setCameraMode(settings.camera);
    if (!game) return;
    const plan = freshPlan.current ? game.plan : nextPlan(progress.seen);
    freshPlan.current = false;
    game.start(mode, plan);
    setProgress((p) => markSeen(p, plan.ids, TICKETS.length));
  };

  const toggleSound = () => {
    const sound = !settings.sound;
    update({ sound });
    game?.setMuted(!sound);
  };

  const toMenu = () => {
    setDecision(null);
    setProcedure(null);
    setFeedback(null);
    setCrash(null);
    game?.toMenu();
  };

  const inRun = status === 'playing' || status === 'decision' || status === 'crashed' || status === 'procedure' || status === 'paused';
  const mode = settings.mode;

  return (
    <div className="app no-menu">
      <canvas key={quality.level} ref={canvasRef} className="scene" aria-label="3D-сцена міста" />
      {error && (
        <div className="overlay center">
          <div className="glass card">
            <h2>Не вдалося запустити 3D</h2>
            <p className="muted">Браузер не підтримує WebGL або його вимкнено. Деталі: {error}</p>
          </div>
        </div>
      )}
      {game && status === 'menu' && <StartScreen settings={settings} progress={progress} onChange={update} onStart={start} />}
      {game && inRun && hud && (
        <Hud
          hud={hud}
          mode={mode}
          camera={settings.camera}
          sound={settings.sound}
          showFps={settings.showFps}
          onPause={() => game.pause()}
          onCamera={() => game.toggleCamera()}
          onSound={toggleSound}
        />
      )}
      {game && status === 'playing' && feedback && <Feedback ticket={game.tickets[feedback.ticket]} kind={feedback.kind} mode={mode} />}
      {game && flash && (status === 'playing' || status === 'crashed' || status === 'procedure') && (
        <CrashFlash key={flash.id} kind={flash.kind} innocent={flash.innocent} />
      )}
      {game && status === 'procedure' && procedure && (
        <ProcedureCard
          key={procedure.step}
          step={ACCIDENT_STEPS[procedure.step]}
          index={procedure.step}
          total={ACCIDENT_STEPS.length}
          chosen={procedure.chosen}
          mode={mode}
          onAnswer={(i) => game.answerProcedure(i)}
          onNext={() => game.nextProcedureStep()}
        />
      )}
      {game && status === 'decision' && decision && (
        <TicketCard
          ticket={game.tickets[decision.ticket]}
          index={decision.ticket}
          total={game.tickets.length}
          retry={decision.retry}
          onAnswer={(i) => game.answer(i)}
        />
      )}
      {game && status === 'crashed' && crash && (
        <CrashCard
          ticket={game.tickets[crash.ticket]}
          option={crash.option}
          kind={crash.kind}
          mode={mode}
          onRetry={() => game.retryTicket()}
          onContinue={() => game.continueAfterCrash()}
        />
      )}
      {game && status === 'paused' && (
        <PauseMenu
          settings={settings}
          onResume={() => game.resume()}
          onRestart={() => start(mode)}
          onCamera={() => game.toggleCamera()}
          onSound={toggleSound}
          onFps={() => update({ showFps: !settings.showFps })}
          onMenu={toMenu}
        />
      )}
      {game && status === 'finished' && result && (
        <Results
          result={result}
          tickets={game.tickets}
          progress={progress[result.mode]}
          onRetry={() => start(result.mode)}
          onSwitchMode={() => start(result.mode === 'training' ? 'exam' : 'training')}
          onMenu={toMenu}
        />
      )}
      <RotateHint />
    </div>
  );
}
