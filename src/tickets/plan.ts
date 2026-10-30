import { CITY } from '../config';
import type { LightState, SignalizedIntersection, WorldFeatures } from '../sim/city';
import { halfAtX, halfAtZ, lanesAtX, lanesAtZ, laneOff } from '../sim/city';
import type { OBB } from '../sim/collision';
import { collideObbCircle, collideObbObb, obbCorners } from '../sim/collision';
import { EGO_KIND, KINDS } from '../sim/kinds';
import type { Corner, Path } from '../sim/path';
import { nearestOnPath, poseOnPath, roundedPath } from '../sim/path';
import type { Vec2 } from '../sim/math';
import { forwardOf, rightOf } from '../sim/math';
import { seededRandom } from '../sim/random';
import { O, R_LEFT, R_RIGHT, exitArm, nodeCrosswalks, priorityLines, prioritySigns, uTurnCorners } from './local';
import { TICKETS } from './tickets';
import type { ActorSpec, AvenueTemplate, LocalLights, NodeTemplate, Ticket, TicketTemplate } from './types';

/** Скільки білетів у одному маршруті. */
export const RUN_SIZE = 20;
/** Імовірність, що білет стане ДТП не з вини учня (у нього в'їжджають ззаду). Не більше одного на заїзд. */
export const INNOCENT_CHANCE = 0.05;

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
  | { kind: 'block'; template: TicketTemplate; frame: Frame }
  | { kind: 'avenue'; template: AvenueTemplate; frame: Frame };

const nodeKey = (i: number, j: number) => `${i},${j}`;
const edgeKey = (a: [number, number], b: [number, number]) => [nodeKey(...a), nodeKey(...b)].sort().join('|');
const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
const interiorNode = (i: number, j: number) => i > 0 && j > 0 && i < N - 1 && j < N - 1;
const nodePos = (n: [number, number]): Vec2 => ({ x: RX[n[0]], z: RZ[n[1]] });
/** Смуги в кожен бік дороги, якою рухаються в напрямку dir через вузол n. */
const lanesAlong = (n: [number, number], dir: Dir) => (dir === 0 || dir === 2 ? lanesAtX(RX[n[0]]) : lanesAtZ(RZ[n[1]]));
const onAvenue = (n: [number, number]) => lanesAtX(RX[n[0]]) > 1 || lanesAtZ(RZ[n[1]]) > 1;

/** Учасники, що після перехрестя їдуть смугами учня попереду нього: квартал за ними зайнятий. */
function occupiesExit(t: NodeTemplate): boolean {
  const arm = exitArm(t.turn);
  const own = t.lanes ? t.lanes * CITY.laneWidth : CITY.roadHalfWidth;
  const cross = CITY.roadHalfWidth;
  return t.actors.some((a) => {
    const p = a.path[a.path.length - 1];
    if (a.kind === 'pedestrian' || a.parked || a.atFault) return false;
    if (arm === 'N') return p.x > 0 && p.x < own && p.z > 10;
    if (arm === 'E') return p.z < 0 && p.z > -cross && p.x > 10;
    return p.z > 0 && p.z < cross && p.x < -10;
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
  /** Після розвороту учень вдруге проїжджає попереднє перехрестя (без ситуації). */
  back?: string;
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
  let budget = 12000;

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

  /**
   * Розворот повертає учня тим самим кварталом до попереднього перехрестя. Можна, лише якщо в кварталі
   * не було ситуації, а попереднє перехрестя — внутрішнє й без світлофора (його проїжджають ще раз).
   */
  const uTurnOk = (s: SearchState): boolean => {
    if (!s.edgeFree) return false;
    const [prev] = edgeOf(s);
    if (!interiorNode(...prev) || onAvenue(prev)) return false;
    for (const p of out)
      if ((p.kind === 'node' || p.kind === 'pass') && p.node[0] === prev[0] && p.node[1] === prev[1])
        return p.kind === 'pass' || !nodeFeatures(p.template, CITY.roadHalfWidth, CITY.roadHalfWidth).signal;
    return false;
  };
  const uTurn = (s: SearchState): SearchState => {
    const [prev] = edgeOf(s);
    return { ...s, at: prev, dir: turnDir(s.dir, 2), edgeFree: false, visited: new Set(s.visited).add(nodeKey(...s.at)), back: nodeKey(...prev) };
  };

  const used = rest.map(() => false);
  /** Скільки ще не розставлених шаблонів (за порядком) пробуємо в кожній точці маршруту. */
  const LOOKAHEAD = 3;

  const tryHere = (t: TicketTemplate, s: SearchState, placed: number): boolean => {
    const nodeFrame: Frame = { origin: nodePos(s.at), heading: HEADING[s.dir] };
    const edgeMid = (): Frame => {
      const [a, b] = edgeOf(s);
      const pa = nodePos(a);
      const pb = nodePos(b);
      return { origin: { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 }, heading: HEADING[s.dir] };
    };
    const lanes = lanesAlong(s.at, s.dir);
    // Об'їзд у кварталі закінчується близько до наступного перехрестя — не перед поворотом на проспект.
    const detourOk = !(t.site === 'block' && t.ego?.length && onAvenue(s.at));
    if (t.site === 'block' && s.edgeFree && s.edgeInterior && lanes === 1 && detourOk) {
      out.push({ kind: 'block', template: t, frame: edgeMid() });
      if (go(placed + 1, { ...s, edgeFree: false }, 0)) return true;
      out.pop();
    }
    // Біля перехрестя двох проспектів повороти довгі — там ділянок проспекту з ситуаціями не буває.
    const [ea, eb] = edgeOf(s);
    const nearAvenueCrossing = [ea, eb].some((n) => lanesAtX(RX[n[0]]) > 1 && lanesAtZ(RZ[n[1]]) > 1);
    if (t.site === 'avenue' && s.edgeFree && lanes === t.lanes && !nearAvenueCrossing) {
      out.push({ kind: 'avenue', template: t, frame: edgeMid() });
      if (go(placed + 1, { ...s, edgeFree: false }, 0)) return true;
      out.pop();
    }
    if (t.site === 'node' && interiorNode(...s.at) && !s.visited.has(nodeKey(...s.at))) {
      const crossLanes = lanesAlong(s.at, turnDir(s.dir, 1));
      const fits = t.lanes ? lanes === t.lanes && crossLanes === 1 : !onAvenue(s.at);
      if (t.turn === 'uturn') {
        if (fits && uTurnOk(s)) {
          out.push({ kind: 'node', template: t, node: s.at, frame: nodeFrame });
          if (go(placed + 1, uTurn(s), 0)) return true;
          out.pop();
        }
        return false;
      }
      const kTurn = t.turn === 'straight' ? 0 : t.turn === 'right' ? 1 : -1;
      if (fits && turnsFrom(s).includes(kTurn)) {
        out.push({ kind: 'node', template: t, node: s.at, frame: nodeFrame });
        if (go(placed + 1, leave(s, kTurn, !occupiesExit(t)), 0)) return true;
        out.pop();
      }
    }
    return false;
  };

  const go = (placed: number, s: SearchState, passes: number): boolean => {
    if (--budget < 0) return false;
    if (placed === rest.length) return true;
    let tried = 0;
    for (let k = 0; k < rest.length && tried < LOOKAHEAD; k++) {
      if (used[k]) continue;
      tried++;
      used[k] = true;
      const ok = tryHere(rest[k], s, placed);
      used[k] = false;
      if (ok) return true;
    }
    if (passes >= MAX_PASSES || (s.visited.has(nodeKey(...s.at)) && s.back !== nodeKey(...s.at))) return false;
    const nodeFrame: Frame = { origin: nodePos(s.at), heading: HEADING[s.dir] };
    for (const kTurn of turnsFrom(s)) {
      out.push({ kind: 'pass', node: s.at, frame: nodeFrame, turn: kTurn });
      if (go(placed, leave(s, kTurn, true), passes + 1)) return true;
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

/** Радіус кутів перестроювання (плавна «S» замість ривка вбік). */
const LANE_CHANGE_R = 30;

/** Переносить розставлені шаблони у світові координати: маршрут учня, білети й обстановку міста. */
function realize(placements: Placement[], seed: number): RunPlan {
  const route: Corner[] = [];
  const tickets: Ticket[] = [];
  const world: WorldFeatures = {
    signals: [],
    signs: [],
    crosswalks: [],
    lines: [],
    props: [],
    bikePaths: [],
    open: [],
    avoid: [],
    wideNodes: [],
  };

  /** own — половина ширини дороги учня, cross — поперечної (для зебр перехрестя). */
  const addTemplate = (t: TicketTemplate, f: Frame, own: number, cross: number, signal?: string) => {
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
      world.crosswalks.push({
        ...toWorld(f, c),
        roadAlongX: alongX(f.heading + (c.acrossEgoRoad ? 0 : Math.PI / 2)),
        width: c.width ?? 3,
        span: c.acrossEgoRoad ? own : cross,
      });
    for (const p of t.props ?? []) {
      world.props.push({ ...p, ...toWorld(f, p), heading: p.heading + f.heading });
      world.avoid.push({ ...toWorld(f, p), r: 2.5 });
    }
    for (const bp of t.bikePaths ?? []) {
      const a = toWorld(f, bp.a);
      const b = toWorld(f, bp.b);
      world.bikePaths.push({ a, b, width: bp.width ?? 1.5 });
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3);
      for (let k = 0; k <= n; k++) world.avoid.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, r: 2 });
    }
    for (const a of actors)
      if (a.kind === 'pedestrian' || a.kind === 'cyclist') for (const c of a.path) world.avoid.push({ x: c.x, z: c.z, r: 3 });
  };

  // Смуга учня на поточній дорозі (0 — біля осьової). На звичайних вулицях — завжди 0.
  let lane = 0;
  const laneChange = (f: Frame, from: number, to: number, z0: number, z1: number) => {
    if (from === to) return;
    route.push({ ...toWorld(f, { x: laneOff(from), z: z0 }), r: LANE_CHANGE_R });
    route.push({ ...toWorld(f, { x: laneOff(to), z: z1 }), r: LANE_CHANGE_R });
  };
  /**
   * Маневр на перехресті: спершу (за потреби) перестроювання в смугу approach, потім поворот у смугу,
   * що відповідає маневру: праворуч — у крайню праву, ліворуч — у крайню ліву, прямо — straightLane.
   */
  const nodeTurn = (f: Frame, k: number, approach: number, straightLane?: number) => {
    const outHeading = f.heading + (k * Math.PI) / 2;
    const outLanes = alongX(outHeading) ? lanesAtZ(f.origin.z) : lanesAtX(f.origin.x);
    const outLane = k > 0 ? outLanes - 1 : k < 0 ? 0 : (straightLane ?? lane);
    // Перестроювання закінчується до початку дуги повороту (або до краю поперечної дороги).
    const clear = k > 0 ? -(laneOff(outLane) + R_RIGHT) : k < 0 ? laneOff(outLane) - R_LEFT : -halfCross(f);
    const end = Math.min(-13, clear - 9);
    laneChange(f, lane, approach, end - 15, end);
    lane = approach;
    if (k !== 0)
      route.push({ ...toWorld(f, { x: laneOff(lane), z: k > 0 ? -laneOff(outLane) : laneOff(outLane) }), r: k > 0 ? R_RIGHT : R_LEFT });
    else laneChange(f, lane, outLane, 13, 28);
    lane = outLane;
  };
  const lanesIn = (f: Frame) => (alongX(f.heading) ? lanesAtZ(f.origin.z) : lanesAtX(f.origin.x));
  const halfIn = (f: Frame) => (alongX(f.heading) ? halfAtZ(f.origin.z) : halfAtX(f.origin.x));
  const halfCross = (f: Frame) => (alongX(f.heading) ? halfAtX(f.origin.x) : halfAtZ(f.origin.z));

  let signals = 0;
  let last: Placement | null = null;
  for (const p of placements) {
    const f = p.frame;
    switch (p.kind) {
      case 'start':
        route.push(toWorld(f, { x: 0, z: -44 }));
        route.push(p.turn === 'right' ? { ...toWorld(f, { x: 0, z: -O }), r: R_RIGHT } : { ...toWorld(f, { x: 0, z: O }), r: R_LEFT });
        if (p.template) addTemplate(p.template, f, CITY.roadHalfWidth, CITY.roadHalfWidth);
        lane = 0;
        // Навпроти виїзду з двору — без високих будинків: камера дивиться через дорогу.
        world.open.push({ ...toWorld(f, { x: 0, z: 8 }), r: 26 });
        break;
      case 'pass': {
        const n = lanesIn(f);
        nodeTurn(f, p.turn, p.turn > 0 ? n - 1 : p.turn < 0 ? 0 : lane);
        break;
      }
      case 'node': {
        const t = p.template;
        if (t.turn === 'uturn') {
          laneChange(f, lane, 0, -28, -13);
          for (const c of uTurnCorners()) route.push(cornerToWorld(f, c));
          lane = 0;
        } else {
          const k = t.turn === 'right' ? 1 : t.turn === 'left' ? -1 : 0;
          nodeTurn(f, k, t.lanes ? (t.laneIn ?? 0) : 0, t.lanes ? (t.laneOut ?? t.laneIn) : undefined);
        }
        const own = halfIn(f);
        const cross = halfCross(f);
        const local = nodeFeatures(t, own, cross);
        let signal: string | undefined;
        if (local.signal) {
          signal = `S${signals++}`;
          const init = worldLights(f.heading, t.initial ?? (t.control === 'signal' ? { along: 'green', cross: 'red' } : { along: 'flash', cross: 'flash' }));
          world.signals.push({ id: signal, ...f.origin, initial: { ns: 'red', ew: 'red', ...init } as SignalizedIntersection['initial'] });
        }
        for (const s of local.signs) world.signs.push({ ...s, ...toWorld(f, s), facing: s.facing + f.heading });
        for (const l of local.lines) world.lines.push({ ...l, ...toWorld(f, l), heading: l.heading + f.heading });
        addTemplate(
          { ...t, stopLine: waitPoint(t), crosswalks: [...(local.signal ? nodeCrosswalks(own, cross) : []), ...(t.crosswalks ?? [])] },
          f,
          own,
          cross,
          signal,
        );
        world.open.push({ ...f.origin, r: 34 + (own - CITY.roadHalfWidth) });
        if (local.signal || t.crosswalks?.length) world.wideNodes.push(f.origin);
        break;
      }
      case 'block': {
        const t = p.template;
        if (t.site === 'block') for (const c of t.ego ?? []) route.push(cornerToWorld(f, c));
        addTemplate(t, f, CITY.roadHalfWidth, CITY.roadHalfWidth);
        world.open.push({ ...f.origin, r: 34 });
        break;
      }
      case 'avenue': {
        const t = p.template;
        laneChange(f, lane, t.laneIn, -32, -17);
        for (const c of t.ego ?? []) route.push(cornerToWorld(f, c));
        lane = t.laneOut;
        const own = halfIn(f);
        addTemplate(t, f, own, own);
        world.open.push({ ...f.origin, r: 40 });
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
      ? lf.heading + { right: Math.PI / 2, left: -Math.PI / 2, uturn: Math.PI, straight: 0 }[last!.template.turn]
      : last!.kind === 'pass'
        ? lf.heading + (last!.turn * Math.PI) / 2
        : lf.heading;
  const ef: Frame = { origin: lf.origin, heading: exitHeading };
  const [near, far] = last!.kind === 'block' || last!.kind === 'avenue' ? [30, 40] : [40, 55];
  const finish = toWorld(ef, { x: laneOff(lane), z: near });
  route.push(toWorld(ef, { x: laneOff(lane), z: far }));

  return { seed, ids: tickets.map((t) => t.id), route, finish, tickets, world };
}

/** Траєкторія учня через перехрестя в локальних координатах (поворот ліворуч або розворот). */
function egoNodePath(t: NodeTemplate): Path {
  const x = laneOff(t.lanes ? (t.laneIn ?? 0) : 0);
  const corners: Corner[] =
    t.turn === 'uturn' ? [{ x, z: -40 }, ...uTurnCorners(x), { x: -x, z: -40 }] : [{ x, z: -40 }, { x, z: O, r: R_LEFT }, { x: -40, z: O }];
  return roundedPath(corners);
}

const egoObbAt = (path: Path, front: number, margin = 0): OBB => {
  const p = poseOnPath(path, front - EGO_KIND.length / 2);
  return { ...p, halfLength: EGO_KIND.length / 2 + margin, halfWidth: EGO_KIND.width / 2 + margin };
};

/** Сигнал світлофора для учня в момент рішення. */
function lightAtDecision(t: NodeTemplate) {
  let along = t.initial?.along ?? (t.control === 'signal' ? 'green' : 'flash');
  for (const step of t.lights ?? []) if (step.t <= 0 && step.state.along) along = step.state.along;
  return along;
}

/** Найближче до зустрічних смуг місце очікування: |x| від осі, куди ще не заїжджає кузов учня. */
const WAIT_EDGE = 0.35;
/** Далі за цю лінію (z від центру) передній бампер не виїжджає: чекають у центрі, а не за ним. */
const WAIT_FRONT = 1;
/** Запас між авто учня й траєкторіями учасників дорогою до місця очікування (м). */
const WAIT_CLEARANCE = 0.4;
/** Щонайменше на стільки метрів місце очікування має бути далі за стоп-лінію, інакше — стоп-лінія. */
const WAIT_MIN_ADVANCE = 2;

const waitCache = new Map<string, Vec2>();

/**
 * Де учень чекає в момент рішення. Повертаючи ліворуч чи розвертаючись і пропускаючи зустрічних або
 * пішоходів, він виїжджає в центр перехрестя й чекає там (п. 16.13) — якщо в'їзд дозволено (не «STOP»,
 * не червоний), поперечною дорогою ніхто не їде, а дорогою до центру він нікому не перетинає шлях.
 * Інакше — стоп-лінія шаблону.
 */
export function waitPoint(t: NodeTemplate): Vec2 {
  const cached = waitCache.get(t.id);
  if (cached) return cached;
  let point = t.stopLine;
  const allowed = t.control !== 'stop' && (['green', 'flash'] as const).some((c) => c === lightAtDecision(t));
  if ((t.turn === 'left' || t.turn === 'uturn') && allowed && !t.actors.some(crossTraffic)) {
    const path = egoNodePath(t);
    const s0 = nearestOnPath(path, t.stopLine).s;
    const poses = t.actors.map(actorPoses);
    let sw = s0;
    for (let s = s0 + 0.25; s < s0 + 30; s += 0.25) {
      const ego = egoObbAt(path, s);
      if (obbCorners(ego).some((c) => c.x < -WAIT_EDGE) || poseOnPath(path, s).z > WAIT_FRONT) break;
      if (!poses.every((p) => clearOf(egoObbAt(path, s, WAIT_CLEARANCE), p))) break;
      sw = s;
    }
    if (sw - s0 >= WAIT_MIN_ADVANCE) point = poseOnPath(path, sw);
  }
  waitCache.set(t.id, point);
  return point;
}

/** Транспорт поперечної дороги (з рукавів E і W): перед ним учень чекає на стоп-лінії. */
function crossTraffic(a: ActorSpec): boolean {
  if (a.parked || a.kind === 'pedestrian') return false;
  const p = a.path[0];
  return Math.abs(p.x) > Math.abs(p.z);
}

type ActorPoses = { kind: ActorSpec['kind']; poses: Array<{ x: number; z: number; heading: number }> };

function actorPoses(a: ActorSpec): ActorPoses {
  const ap = roundedPath(a.path, 0.5);
  return { kind: a.kind, poses: a.parked ? [poseOnPath(ap, 0)] : ap.pts.map((pt) => poseOnPath(ap, pt.s)) };
}

/** Учасник ніде на своїй траєкторії не зачіпає авто учня в положенні ego. */
function clearOf(ego: OBB, a: ActorPoses): boolean {
  const k = KINDS[a.kind];
  return a.poses.every((p) =>
    a.kind === 'pedestrian'
      ? !collideObbCircle(ego, { x: p.x, z: p.z, r: k.width / 2 })
      : !collideObbObb(ego, { ...p, halfLength: k.length / 2, halfWidth: k.width / 2 }),
  );
}

function nodeFeatures(t: NodeTemplate, own: number, cross: number) {
  switch (t.control) {
    case 'giveWay':
    case 'stop':
      return { signal: false, signs: prioritySigns(true, t.control, own, cross), lines: priorityLines(true, t.control, own, cross) };
    case 'main':
      return { signal: false, signs: prioritySigns(false, 'giveWay', own, cross), lines: priorityLines(false, 'giveWay', own, cross) };
    case 'flashGiveWay':
      return { signal: true, signs: prioritySigns(true, 'giveWay', own, cross), lines: priorityLines(true, 'giveWay', own, cross) };
    case 'signal':
    case 'flash':
      return { signal: true, signs: [], lines: [] };
    case 'equal':
      return { signal: false, signs: [], lines: [] };
  }
}

/** Позначає один білет (крім виїзду з двору) як ДТП не з вини учня — з імовірністю chance на кожен білет. */
function pickInnocent(plan: RunPlan, rnd: () => number, chance: number) {
  for (let i = 1; i < plan.tickets.length; i++)
    if (rnd() < chance) {
      plan.tickets[i].innocent = true;
      return plan;
    }
  return plan;
}

/** Робить білет index ДТП не з вини учня (для тестів і ?innocent=N). */
export function withInnocent(plan: RunPlan, index: number): RunPlan {
  plan.tickets.forEach((t, i) => (t.innocent = i === index ? true : undefined));
  return plan;
}

/** План для заданих шаблонів у заданому порядку (для тестів і налагодження). */
export function planFor(templates: TicketTemplate[], seed = 1): RunPlan {
  for (let attempt = 0; attempt < 50; attempt++) {
    const placements = layout(templates, seededRandom(seed * 7919 + attempt));
    if (placements) return realize(placements, seed);
  }
  throw new Error(`Не вдалося прокласти маршрут для: ${templates.map((t) => t.id).join(', ')}`);
}

/**
 * Новий заїзд: випадкові білети (спершу ще не бачені) і новий маршрут. Якщо вибрані білети ніяк не
 * розставити містом, кілька з них поступово замінюються іншими.
 */
export function createRunPlan(
  seed: number,
  seen: ReadonlySet<string> = new Set(),
  count = RUN_SIZE,
  pool = TICKETS,
  innocentChance = INNOCENT_CHANCE,
): RunPlan {
  const rnd = seededRandom(seed);
  for (let attempt = 0; attempt < 40; attempt++) {
    const picked = drawTickets(pool, count, rnd, seen);
    for (let k = 0; k < Math.max(0, attempt - 9); k++) {
      const i = 1 + Math.floor(rnd() * (picked.length - 1));
      const spare = pool.filter((t) => t.site !== 'start' && !picked.includes(t));
      if (spare.length) picked[i] = spare[Math.floor(rnd() * spare.length)];
    }
    const placements = layout(picked, seededRandom(seed * 31 + attempt));
    if (placements) return pickInnocent(realize(placements, seed), seededRandom(seed * 13 + 7), innocentChance);
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
