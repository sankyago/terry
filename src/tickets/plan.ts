import { CITY } from '../config';
import type { LightState, SignalizedIntersection, WorldFeatures } from '../sim/city';
import type { Corner } from '../sim/path';
import type { Vec2 } from '../sim/math';
import { forwardOf, rightOf } from '../sim/math';
import { seededRandom } from '../sim/random';
import { NODE_CROSSWALKS, O, R_LEFT, R_RIGHT, exitArm, priorityLines, prioritySigns } from './local';
import { TICKETS } from './tickets';
import type { ActorSpec, LocalLights, NodeTemplate, Ticket, TicketTemplate } from './types';

/** Скільки білетів у одному маршруті. */
export const RUN_SIZE = 20;

/**
 * План заїзду: які білети, у якому порядку й де саме в місті. Будується генератором маршруту
 * з шаблонів, тож кожен заїзд — інший маршрут і інший набір ситуацій.
 */
export interface RunPlan {
  seed: number;
  ids: string[];
  route: Corner[];
  finish: Vec2;
  tickets: Ticket[];
  world: WorldFeatures;
}

/** Напрямок руху сіткою: 0 — північ (+Z), 1 — схід (+X), 2 — південь, 3 — захід. */
type Dir = 0 | 1 | 2 | 3;
const HEADING = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const STEP: Array<[number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
const turnDir = (d: Dir, k: number) => (((d + k) % 4) + 4) % 4 as Dir;

const RX = CITY.roadsX;
const RZ = CITY.roadsZ;
const N = RX.length;

/** Двір: виїзд на дорогу Z = 90 між перехрестями (0, 90) і (90, 90). */
const YARD_EXIT = { x: 20, z: 90 };
const YARD_NODES: Record<'E' | 'W', [number, number]> = {
  E: [RX.indexOf(90), RZ.indexOf(90)],
  W: [RX.indexOf(0), RZ.indexOf(90)],
};

/** Локальна система координат місця ситуації. */
interface Frame {
  origin: Vec2;
  heading: number;
}

const toWorld = (f: Frame, p: Vec2): Vec2 => {
  const fw = forwardOf(f.heading);
  const r = rightOf(f.heading);
  return { x: f.origin.x + fw.x * p.z + r.x * p.x, z: f.origin.z + fw.z * p.z + r.z * p.x };
};
const cornerToWorld = (f: Frame, c: Corner): Corner => (c.r === undefined ? toWorld(f, c) : { ...toWorld(f, c), r: c.r });
/** Чи напрямок heading іде вздовж осі X. */
const alongX = (heading: number) => Math.abs(Math.sin(heading)) > 0.5;

type Placement =
  | { kind: 'start'; template: TicketTemplate | null; frame: Frame; turn: 'left' | 'right' }
  | { kind: 'pass'; node: [number, number]; frame: Frame; turn: -1 | 0 | 1 }
  | { kind: 'node'; template: NodeTemplate; node: [number, number]; frame: Frame }
  | { kind: 'block'; template: TicketTemplate; frame: Frame };

const nodeKey = (i: number, j: number) => `${i},${j}`;
const edgeKey = (a: [number, number], b: [number, number]) => [nodeKey(...a), nodeKey(...b)].sort().join('|');
const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
const interiorNode = (i: number, j: number) => i > 0 && j > 0 && i < N - 1 && j < N - 1;
const nodePos = (n: [number, number]): Vec2 => ({ x: RX[n[0]], z: RZ[n[1]] });

/** Учасники, що після перехрестя їдуть смугою учня попереду нього: квартал за ними зайнятий. */
function occupiesExit(t: NodeTemplate): boolean {
  const arm = exitArm(t.turn);
  return t.actors.some((a) => {
    const p = a.path[a.path.length - 1];
    if (a.kind === 'pedestrian' || a.parked) return false;
    if (arm === 'N') return Math.abs(p.x - O) < 0.5 && p.z > 10;
    if (arm === 'E') return Math.abs(p.z + O) < 0.5 && p.x > 10;
    return Math.abs(p.z - O) < 0.5 && p.x < -10;
  });
}

interface SearchState {
  /** Перехрестя попереду й напрямок руху до нього. */
  at: [number, number];
  dir: Dir;
  /** Квартал, яким зараз їде учень, вільний для ситуації між перехрестями. */
  edgeFree: boolean;
  edgeInterior: boolean;
  visited: Set<string>;
  usedEdges: Set<string>;
}

const MAX_PASSES = 3;

/** Розставляє шаблони по сітці міста в заданому порядку (пошук із поверненням). */
function layout(templates: TicketTemplate[], rnd: () => number): Placement[] | null {
  const first = templates[0]?.site === 'start' ? templates[0] : null;
  const rest = first ? templates.slice(1) : templates;
  const startTurn: 'left' | 'right' = first?.site === 'start' ? first.turn : rnd() < 0.5 ? 'left' : 'right';
  const startFrame: Frame = { origin: YARD_EXIT, heading: 0 };
  const dir0: Dir = startTurn === 'right' ? 1 : 3;
  const at0 = YARD_NODES[startTurn === 'right' ? 'E' : 'W'];
  const start: Placement = { kind: 'start', template: first, frame: startFrame, turn: startTurn };
  let budget = 40000;

  const out: Placement[] = [start];
  const edgeOf = (s: SearchState): [[number, number], [number, number]] => {
    const [dx, dz] = STEP[s.dir];
    return [[s.at[0] - dx, s.at[1] - dz], s.at];
  };

  const turnsFrom = (s: SearchState): Array<-1 | 0 | 1> => {
    const opts: Array<-1 | 0 | 1> = [0, 1, -1];
    // Частіше прямо, але порядок інших — випадковий.
    if (rnd() < 0.5) opts.reverse();
    if (rnd() < 0.6) opts.unshift(...opts.splice(opts.indexOf(0), 1));
    return opts.filter((k) => {
      const d = turnDir(s.dir, k);
      const [dx, dz] = STEP[d];
      const n: [number, number] = [s.at[0] + dx, s.at[1] + dz];
      return inGrid(...n) && !s.visited.has(nodeKey(...n)) && !s.usedEdges.has(edgeKey(s.at, n));
    });
  };

  const leave = (s: SearchState, k: -1 | 0 | 1, edgeFree: boolean): SearchState => {
    const d = turnDir(s.dir, k);
    const [dx, dz] = STEP[d];
    const n: [number, number] = [s.at[0] + dx, s.at[1] + dz];
    const visited = new Set(s.visited).add(nodeKey(...s.at));
    const usedEdges = new Set(s.usedEdges).add(edgeKey(s.at, n));
    const roadX = d === 0 || d === 2;
    const interior = roadX ? s.at[0] > 0 && s.at[0] < N - 1 : s.at[1] > 0 && s.at[1] < N - 1;
    return { at: n, dir: d, edgeFree, edgeInterior: interior, visited, usedEdges };
  };

  const go = (k: number, s: SearchState, passes: number): boolean => {
    if (--budget < 0) return false;
    if (k === rest.length) return true;
    const t = rest[k];
    const nodeFrame: Frame = { origin: nodePos(s.at), heading: HEADING[s.dir] };
    if (t.site === 'block' && s.edgeFree && s.edgeInterior) {
      const [a, b] = edgeOf(s);
      const pa = nodePos(a);
      const pb = nodePos(b);
      const mid = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
      out.push({ kind: 'block', template: t, frame: { origin: mid, heading: HEADING[s.dir] } });
      if (go(k + 1, { ...s, edgeFree: false }, 0)) return true;
      out.pop();
    }
    if (t.site === 'node' && interiorNode(...s.at) && !s.visited.has(nodeKey(...s.at))) {
      const kTurn = t.turn === 'straight' ? 0 : t.turn === 'right' ? 1 : -1;
      if (turnsFrom(s).includes(kTurn)) {
        out.push({ kind: 'node', template: t, node: s.at, frame: nodeFrame });
        if (go(k + 1, leave(s, kTurn, !occupiesExit(t)), 0)) return true;
        out.pop();
      }
    }
    if (passes >= MAX_PASSES || s.visited.has(nodeKey(...s.at))) return false;
    for (const kTurn of turnsFrom(s)) {
      out.push({ kind: 'pass', node: s.at, frame: nodeFrame, turn: kTurn });
      if (go(k, leave(s, kTurn, true), passes + 1)) return true;
      out.pop();
    }
    return false;
  };

  const s0: SearchState = {
    at: at0,
    dir: dir0,
    edgeFree: false,
    edgeInterior: true,
    visited: new Set(),
    usedEdges: new Set([edgeKey(YARD_NODES.E, YARD_NODES.W)]),
  };
  return go(0, s0, 0) ? out : null;
}

/** Порядок білетів: спершу ті, яких учень ще не бачив; щонайбільше один виїзд із двору — і він перший. */
export function drawTickets(pool: TicketTemplate[], count: number, rnd: () => number, seen: ReadonlySet<string> = new Set()) {
  const shuffle = <T,>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // Колоду пройдено повністю — починаємо нове коло.
  if (pool.every((t) => seen.has(t.id))) seen = new Set();
  const fresh = shuffle(pool.filter((t) => !seen.has(t.id)));
  const old = shuffle(pool.filter((t) => seen.has(t.id)));
  // Виїзд із двору буває лише один на заїзд: якщо є ще не бачений — беремо його, щоб колода не застрягала.
  const freshStart = fresh.findIndex((t) => t.site === 'start');
  if (freshStart > 0) fresh.unshift(...fresh.splice(freshStart, 1));
  const picked: TicketTemplate[] = [];
  for (const t of [...fresh, ...old]) {
    if (picked.length >= count) break;
    if (t.site === 'start' && picked.some((p) => p.site === 'start')) continue;
    picked.push(t);
  }
  const si = picked.findIndex((t) => t.site === 'start');
  if (si > 0) picked.unshift(...picked.splice(si, 1));
  return picked;
}

const worldLights = (heading: number, l: Partial<LocalLights>): Partial<LightState> => {
  const ego = alongX(heading) ? 'ew' : 'ns';
  const cross = ego === 'ew' ? 'ns' : 'ew';
  const out: Partial<LightState> = {};
  if (l.along) out[ego] = l.along;
  if (l.cross) out[cross] = l.cross;
  return out;
};

/** Переносить розставлені шаблони у світові координати: маршрут учня, білети й обстановку міста. */
function realize(placements: Placement[], seed: number): RunPlan {
  const route: Corner[] = [];
  const tickets: Ticket[] = [];
  const world: WorldFeatures = { signals: [], signs: [], crosswalks: [], lines: [], props: [], open: [], avoid: [], wideNodes: [] };

  const addTemplate = (t: TicketTemplate, f: Frame, signal?: string) => {
    const actors: ActorSpec[] = t.actors.map((a) => ({ ...a, path: a.path.map((c) => cornerToWorld(f, c)) }));
    const ticket: Ticket = {
      id: t.id,
      title: t.title,
      question: t.question,
      options: t.options,
      explanation: t.explanation,
      rule: t.rule,
      stopLine: toWorld(f, t.stopLine),
      actors,
    };
    if (t.site === 'node' && t.lights && signal)
      ticket.lights = [{ signal, steps: t.lights.map((s) => ({ t: s.t, state: worldLights(f.heading, s.state) })) }];
    tickets.push(ticket);
    for (const s of t.signs ?? []) world.signs.push({ ...s, ...toWorld(f, s), facing: s.facing + f.heading });
    for (const c of t.crosswalks ?? [])
      world.crosswalks.push({ ...toWorld(f, c), roadAlongX: alongX(f.heading + (c.acrossEgoRoad ? 0 : Math.PI / 2)), width: c.width ?? 3 });
    for (const p of t.props ?? []) {
      world.props.push({ ...p, ...toWorld(f, p), heading: p.heading + f.heading });
      world.avoid.push({ ...toWorld(f, p), r: 2.5 });
    }
    for (const a of actors) if (a.kind === 'pedestrian') for (const c of a.path) world.avoid.push({ x: c.x, z: c.z, r: 3 });
  };

  let signals = 0;
  let last: Placement | null = null;
  for (const p of placements) {
    const f = p.frame;
    switch (p.kind) {
      case 'start':
        route.push(toWorld(f, { x: 0, z: -44 }));
        route.push(p.turn === 'right' ? { ...toWorld(f, { x: 0, z: -O }), r: R_RIGHT } : { ...toWorld(f, { x: 0, z: O }), r: R_LEFT });
        if (p.template) addTemplate(p.template, f);
        // Навпроти виїзду з двору — без високих будинків: камера дивиться через дорогу.
        world.open.push({ ...toWorld(f, { x: 0, z: 8 }), r: 26 });
        break;
      case 'pass':
        if (p.turn !== 0) route.push({ ...toWorld(f, p.turn > 0 ? { x: O, z: -O } : { x: O, z: O }), r: p.turn > 0 ? R_RIGHT : R_LEFT });
        break;
      case 'node': {
        const t = p.template;
        if (t.turn !== 'straight')
          route.push({ ...toWorld(f, t.turn === 'right' ? { x: O, z: -O } : { x: O, z: O }), r: t.turn === 'right' ? R_RIGHT : R_LEFT });
        const local = nodeFeatures(t);
        let signal: string | undefined;
        if (local.signal) {
          signal = `S${signals++}`;
          const init = worldLights(f.heading, t.initial ?? (t.control === 'signal' ? { along: 'green', cross: 'red' } : { along: 'flash', cross: 'flash' }));
          world.signals.push({ id: signal, ...f.origin, initial: { ns: 'red', ew: 'red', ...init } as SignalizedIntersection['initial'] });
        }
        for (const s of local.signs) world.signs.push({ ...s, ...toWorld(f, s), facing: s.facing + f.heading });
        for (const l of local.lines) world.lines.push({ ...l, ...toWorld(f, l), heading: l.heading + f.heading });
        addTemplate({ ...t, crosswalks: [...(local.signal ? NODE_CROSSWALKS : []), ...(t.crosswalks ?? [])] }, f, signal);
        world.open.push({ ...f.origin, r: 34 });
        if (local.signal || t.crosswalks?.length) world.wideNodes.push(f.origin);
        break;
      }
      case 'block': {
        const t = p.template;
        if (t.site === 'block') for (const c of t.ego ?? []) route.push(cornerToWorld(f, c));
        addTemplate(t, f);
        world.open.push({ ...f.origin, r: 34 });
        break;
      }
    }
    last = p;
  }

  // Фініш — у кварталі після останньої ситуації.
  const lf = last!.frame;
  const exitHeading =
    last!.kind === 'start'
      ? (last!.turn === 'right' ? Math.PI / 2 : -Math.PI / 2)
      : last!.kind === 'node'
      ? lf.heading + (last!.template.turn === 'right' ? Math.PI / 2 : last!.template.turn === 'left' ? -Math.PI / 2 : 0)
      : last!.kind === 'pass'
        ? lf.heading + (last!.turn * Math.PI) / 2
        : lf.heading;
  const ef: Frame = { origin: lf.origin, heading: exitHeading };
  const [near, far] = last!.kind === 'block' ? [30, 40] : [40, 55];
  const finish = toWorld(ef, { x: O, z: near });
  route.push(toWorld(ef, { x: O, z: far }));

  return { seed, ids: tickets.map((t) => t.id), route, finish, tickets, world };
}

function nodeFeatures(t: NodeTemplate) {
  switch (t.control) {
    case 'giveWay':
    case 'stop':
      return { signal: false, signs: prioritySigns(true, t.control), lines: priorityLines(true, t.control) };
    case 'main':
      return { signal: false, signs: prioritySigns(false, 'giveWay'), lines: priorityLines(false, 'giveWay') };
    case 'flashGiveWay':
      return { signal: true, signs: prioritySigns(true, 'giveWay'), lines: priorityLines(true, 'giveWay') };
    case 'signal':
    case 'flash':
      return { signal: true, signs: [], lines: [] };
    case 'equal':
      return { signal: false, signs: [], lines: [] };
  }
}

/** План для заданих шаблонів у заданому порядку (для тестів і налагодження). */
export function planFor(templates: TicketTemplate[], seed = 1): RunPlan {
  for (let attempt = 0; attempt < 50; attempt++) {
    const placements = layout(templates, seededRandom(seed * 7919 + attempt));
    if (placements) return realize(placements, seed);
  }
  throw new Error(`Не вдалося прокласти маршрут для: ${templates.map((t) => t.id).join(', ')}`);
}

/** Новий заїзд: випадкові білети (спершу ще не бачені) і новий маршрут. */
export function createRunPlan(seed: number, seen: ReadonlySet<string> = new Set(), count = RUN_SIZE, pool = TICKETS): RunPlan {
  const rnd = seededRandom(seed);
  for (let attempt = 0; attempt < 20; attempt++) {
    const picked = drawTickets(pool, count, rnd, seen);
    const placements = layout(picked, seededRandom(seed * 31 + attempt));
    if (placements) return realize(placements, seed);
  }
  throw new Error('Не вдалося прокласти маршрут');
}

/** План за списком ідентифікаторів (для ?tickets=… у режимі налагодження). */
export function planForIds(ids: string[], seed = 1): RunPlan {
  const templates = ids.map((id) => {
    const t = TICKETS.find((x) => x.id === id);
    if (!t) throw new Error(`Немає білета ${id}`);
    return t;
  });
  return planFor(templates, seed);
}
