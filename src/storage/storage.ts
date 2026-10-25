export type Mode = 'training' | 'exam';
export type CameraMode = 'follow' | 'north';
export type QualitySetting = 'auto' | 'low' | 'high';

export interface Settings {
  mode: Mode;
  camera: CameraMode;
  sound: boolean;
  quality: QualitySetting;
  showFps: boolean;
}

export interface AnswerRecord {
  ticket: number;
  option: number;
  correct: boolean;
}

export interface RunResult {
  mode: Mode;
  /** Білети заїзду в порядку маршруту (індекси в answers — позиції в цьому списку). */
  ids: string[];
  answers: AnswerRecord[];
  correct: number;
  total: number;
  passed: boolean;
  time: number;
}

export interface ModeProgress {
  attempts: number;
  passes: number;
  bestScore: number | null;
}

export interface Progress {
  training: ModeProgress;
  exam: ModeProgress;
  lastResult: RunResult | null;
  /** Білети, які вже траплялися в заїздах цього кола колоди: нові заїзди спершу беруть інші. */
  seen: string[];
}

/** Критерій іспиту, як у сервісному центрі: 20 білетів, не більше двох помилок. */
export const EXAM_MAX_MISTAKES = 2;

const KEY = 'cruise.v2';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'training',
  camera: 'follow',
  sound: true,
  quality: 'auto',
  showFps: false,
};

const emptyProgress = (): Progress => ({
  training: { attempts: 0, passes: 0, bestScore: null },
  exam: { attempts: 0, passes: 0, bestScore: null },
  lastResult: null,
  seen: [],
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
        exam: { ...p.exam, ...(data.progress?.exam ?? {}) },
        lastResult: data.progress?.lastResult ?? null,
        seen: Array.isArray(data.progress?.seen) ? data.progress.seen.filter((x): x is string => typeof x === 'string') : [],
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

export function buildResult(mode: Mode, answers: AnswerRecord[], total: number, time: number, ids: string[] = []): RunResult {
  const correct = answers.filter((a) => a.correct).length;
  return { mode, ids, answers, correct, total, passed: total - correct <= EXAM_MAX_MISTAKES, time };
}

/** Позначає білети заїзду як бачені; коли бачено всю колоду (poolSize), починається нове коло. */
export function markSeen(progress: Progress, ids: string[], poolSize: number): Progress {
  const seen = new Set([...progress.seen, ...ids]);
  return { ...progress, seen: seen.size >= poolSize ? [] : [...seen] };
}

export function recordResult(progress: Progress, result: RunResult): Progress {
  const prev = progress[result.mode];
  const next: ModeProgress = {
    attempts: prev.attempts + 1,
    passes: prev.passes + (result.passed ? 1 : 0),
    bestScore: prev.bestScore === null ? result.correct : Math.max(prev.bestScore, result.correct),
  };
  return { ...progress, [result.mode]: next, lastResult: result };
}
