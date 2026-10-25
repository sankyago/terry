import type { ExerciseResult, Mode } from '../exercise/types';

export type CameraMode = 'chase' | 'driver';
export type QualitySetting = 'auto' | 'low' | 'high';
export type TouchSetting = 'auto' | 'on' | 'off';

export interface Settings {
  mode: Mode;
  camera: CameraMode;
  sound: boolean;
  quality: QualitySetting;
  touchControls: TouchSetting;
  showFps: boolean;
}

export interface ModeProgress {
  attempts: number;
  successes: number;
  bestTime: number | null;
}

export interface Progress {
  training: ModeProgress;
  check: ModeProgress;
  lastResult: ExerciseResult | null;
}

const KEY = 'cruise.v1';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'training',
  camera: 'chase',
  sound: true,
  quality: 'auto',
  touchControls: 'auto',
  showFps: false,
};

const emptyProgress = (): Progress => ({
  training: { attempts: 0, successes: 0, bestTime: null },
  check: { attempts: 0, successes: 0, bestTime: null },
  lastResult: null,
});

interface Stored {
  settings: Settings;
  progress: Progress;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function load(store: KeyValueStore | null = defaultStore()): Stored {
  const fallback = { settings: { ...DEFAULT_SETTINGS }, progress: emptyProgress() };
  if (!store) return fallback;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw) as Partial<Stored>;
    const p = emptyProgress();
    return {
      settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
      progress: {
        training: { ...p.training, ...(data.progress?.training ?? {}) },
        check: { ...p.check, ...(data.progress?.check ?? {}) },
        lastResult: data.progress?.lastResult ?? null,
      },
    };
  } catch {
    return fallback;
  }
}

export function save(data: Stored, store: KeyValueStore | null = defaultStore()) {
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(data));
  } catch {
    /* сховище недоступне (приватний режим) — працюємо без збереження */
  }
}

export function recordResult(progress: Progress, result: ExerciseResult): Progress {
  const prev = progress[result.mode];
  const next: ModeProgress = {
    attempts: prev.attempts + 1,
    successes: prev.successes + (result.success ? 1 : 0),
    bestTime:
      result.success && (prev.bestTime === null || result.time < prev.bestTime) ? result.time : prev.bestTime,
  };
  return { ...progress, [result.mode]: next, lastResult: result };
}
