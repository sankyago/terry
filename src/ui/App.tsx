import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameStatus, HudSnapshot } from '../game/Game';
import { Game } from '../game/Game';
import type { ExerciseResult, Mode } from '../exercise/types';
import { FAULT_LABELS } from '../exercise/texts';
import { isTouchDevice, resolveQuality } from '../scene/quality';
import type { Progress, Settings } from '../storage/storage';
import { load, recordResult, save } from '../storage/storage';
import { Hud } from './Hud';
import { PauseMenu } from './PauseMenu';
import { Results } from './Results';
import { RotateHint } from './RotateHint';
import { StartScreen } from './StartScreen';
import type { Toast } from './Toasts';
import { Toasts } from './Toasts';
import { TouchControls } from './TouchControls';

let toastId = 0;

export function App() {
  const initial = useMemo(() => load(), []);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [progress, setProgress] = useState<Progress>(initial.progress);
  const [status, setStatus] = useState<GameStatus>('menu');
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [result, setResult] = useState<ExerciseResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const quality = useMemo(() => resolveQuality(settings.quality), [settings.quality]);
  const touch = settings.touchControls === 'auto' ? isTouchDevice() : settings.touchControls === 'on';

  useEffect(() => save({ settings, progress }), [settings, progress]);

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastId;
    setToasts((list) => [...list.slice(-2), { ...t, id }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.tone === 'warn' ? 4500 : 2600);
  }, []);

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
        case 'fault':
          if (g.mode === 'training') pushToast({ tone: 'warn', title: FAULT_LABELS[e.fault.kind], text: e.fault.message });
          break;
        case 'toast':
          pushToast({ tone: 'info', text: e.text });
          break;
        case 'finished':
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
  }, [quality, pushToast]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const start = (mode: Mode) => {
    update({ mode });
    setResult(null);
    setToasts([]);
    game?.setMuted(!settings.sound);
    game?.start(mode);
  };

  const toggleSound = () => {
    const sound = !settings.sound;
    update({ sound });
    game?.setMuted(!sound);
  };

  const playing = status === 'playing' || status === 'paused';

  return (
    <div className="app no-menu">
      <canvas key={quality.level} ref={canvasRef} className="scene" aria-label="3D-сцена тренувального майданчика" />
      {error && (
        <div className="overlay center">
          <div className="glass card">
            <h2>Не вдалося запустити 3D</h2>
            <p className="muted">Браузер не підтримує WebGL або його вимкнено. Деталі: {error}</p>
          </div>
        </div>
      )}
      {game && status === 'menu' && (
        <StartScreen
          settings={settings}
          progress={progress}
          touch={touch}
          onChange={update}
          onStart={start}
        />
      )}
      {game && playing && hud && (
        <>
          <Hud
            hud={hud}
            mode={settings.mode}
            sound={settings.sound}
            showFps={settings.showFps}
            touch={touch}
            onPause={() => game.pause()}
            onCamera={() => game.toggleCamera()}
            onSound={toggleSound}
            onIndicator={(s) => game.toggleIndicator(s)}
          />
          <TouchControls
            game={game}
            gear={hud.gear}
            touch={touch}
          />
          <Toasts toasts={toasts} />
        </>
      )}
      {game && status === 'paused' && (
        <PauseMenu
          settings={settings}
          onResume={() => game.resume()}
          onRestart={() => start(settings.mode)}
          onCamera={() => game.toggleCamera()}
          onSound={toggleSound}
          onFps={() => update({ showFps: !settings.showFps })}
          onMenu={() => game.toMenu()}
        />
      )}
      {game && status === 'finished' && result && (
        <Results
          result={result}
          progress={progress[result.mode]}
          onRetry={() => start(result.mode)}
          onSwitchMode={() => start(result.mode === 'training' ? 'check' : 'training')}
          onMenu={() => game.toMenu()}
        />
      )}
      <RotateHint />
    </div>
  );
}
