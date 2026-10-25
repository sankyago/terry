import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameStatus, HudSnapshot } from '../game/Game';
import { Game } from '../game/Game';
import type { ActorKind } from '../sim/kinds';
import { resolveQuality } from '../scene/quality';
import type { Mode, Progress, RunResult, Settings } from '../storage/storage';
import { load, recordResult, save } from '../storage/storage';
import { TICKETS } from '../tickets/tickets';
import { Hud } from './Hud';
import { PauseMenu } from './PauseMenu';
import { Results } from './Results';
import { RotateHint } from './RotateHint';
import { StartScreen } from './StartScreen';
import { CrashCard, CrashFlash, Feedback, TicketCard } from './TicketCard';

interface Decision {
  ticket: number;
  retry: boolean;
}
interface FeedbackState {
  ticket: number;
  kind: 'correct' | 'replay';
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
  const [flash, setFlash] = useState<{ kind: ActorKind; id: number } | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
      g = new Game(canvas, { quality, mode: s.mode, camera: s.camera, sound: s.sound });
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
          setFlash({ kind: e.kind, id: Date.now() });
          setCrash({ ticket: e.ticket, kind: e.kind, option: g.lastAnswer });
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
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __cruise?: Game }).__cruise = g;
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
    game?.setMuted(!settings.sound);
    game?.setCameraMode(settings.camera);
    game?.start(mode);
  };

  const toggleSound = () => {
    const sound = !settings.sound;
    update({ sound });
    game?.setMuted(!sound);
  };

  const toMenu = () => {
    setDecision(null);
    setFeedback(null);
    setCrash(null);
    game?.toMenu();
  };

  const inRun = status === 'playing' || status === 'decision' || status === 'crashed' || status === 'paused';
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
      {game && status === 'playing' && feedback && <Feedback ticket={TICKETS[feedback.ticket]} kind={feedback.kind} mode={mode} />}
      {game && flash && (status === 'playing' || status === 'crashed') && <CrashFlash key={flash.id} kind={flash.kind} />}
      {game && status === 'decision' && decision && (
        <TicketCard
          ticket={TICKETS[decision.ticket]}
          index={decision.ticket}
          total={TICKETS.length}
          retry={decision.retry}
          onAnswer={(i) => game.answer(i)}
        />
      )}
      {game && status === 'crashed' && crash && (
        <CrashCard
          ticket={TICKETS[crash.ticket]}
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
          tickets={TICKETS}
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
