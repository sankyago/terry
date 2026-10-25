import type { FailReason, FaultKind, FaultRecord } from './types';

export const FAULT_LABELS: Record<FaultKind, string> = {
  speeding: 'Перевищення швидкості',
  collision: 'Зіткнення з перешкодою',
  offroad: 'Виїзд за межі дороги',
  noSignal: 'Поворот без покажчика',
  earlyPark: 'Передчасне увімкнення P',
};

export const FAIL_LABELS: Record<FailReason, string> = {
  notInZone: 'Автомобіль зупинився не повністю в позначеній зоні',
  holdShort: 'Перед увімкненням P авто стояло менше 2 секунд',
  collision: 'Під час вправи було зіткнення з перешкодою',
};

const FAULT_ADVICE: Record<FaultKind, string> = {
  speeding: 'Тримайте швидкість до 20 км/год: дозуйте газ плавно і пригальмовуйте заздалегідь.',
  collision: 'Стежте за габаритами авто й рухайтеся повільніше біля конусів і перешкод.',
  offroad: 'Тримайтеся своєї смуги; у повороті повертайте кермо плавно й завчасно.',
  noSignal: 'Вмикайте правий покажчик повороту ще до початку повороту.',
  earlyPark: 'Вмикайте P лише після повної зупинки в зоні й паузи щонайменше 2 секунди.',
};

const FAIL_ADVICE: Record<FailReason, string> = {
  notInZone: 'Починайте гальмувати за 10–15 м до зони й орієнтуйтеся на її бічні лінії.',
  holdShort: 'Після зупинки порахуйте до двох, утримуючи гальмо, і лише тоді вмикайте P.',
  collision: 'Зіткнення робить вправу невиконаною — спершу відпрацюйте траєкторію на низькій швидкості.',
};

export function buildRecommendations(faults: FaultRecord[], failReasons: FailReason[]): string[] {
  const out: string[] = [];
  for (const r of failReasons) out.push(FAIL_ADVICE[r]);
  const kinds = new Set(faults.map((f) => f.kind));
  for (const k of kinds) {
    if (k === 'collision' && failReasons.includes('collision')) continue;
    out.push(FAULT_ADVICE[k]);
  }
  if (out.length === 0) {
    out.push('Чудова робота! Спробуйте режим «Перевірка» або покращте свій час без втрати плавності.');
  }
  return out;
}
