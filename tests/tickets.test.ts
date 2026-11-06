import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config';
import type { SimEvent } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { RunPlan } from '../src/tickets/plan';
import { RUN_SIZE, createDifficultyRunPlan, createRunPlan, drawTickets, planFor, waitPoint, withInnocent } from '../src/tickets/plan';
import { DIFFICULTIES, TICKETS, ticketsForDifficulty } from '../src/tickets/tickets';
import type { NodeTemplate } from '../src/tickets/types';
import { seededRandom } from '../src/sim/random';
import { lastPlaceLimit, passagePosition } from '../src/tickets/passage';
import { curvatureAt } from '../src/sim/path';

/** Крутить симуляцію, доки не з'явиться подія потрібного типу (або не мине ліміт часу). */
function runUntil(sim: Sim, type: SimEvent['type'] | SimEvent['type'][], maxSeconds = 120) {
  const types = Array.isArray(type) ? type : [type];
  const all: SimEvent[] = [];
  for (let i = 0; i < maxSeconds / SIM_DT; i++) {
    const ev = sim.step(SIM_DT);
    all.push(...ev);
    const hit = ev.find((e) => types.includes(e.type));
    if (hit) return { hit, all };
  }
  return { hit: null, all };
}

/** Доводить симуляцію до рішення в білеті `index`, відповідаючи правильно на попередні. */
function reachTicket(plan: RunPlan, index: number) {
  const sim = new Sim(plan);
  for (let i = 0; i <= index; i++) {
    const { hit, all } = runUntil(sim, 'decision');
    expect(all.some((e) => e.type === 'crash'), `ДТП дорогою до білета ${i}`).toBe(false);
    expect(hit, `рішення в білеті ${i}`).toMatchObject({ type: 'decision', ticket: i });
    if (i < index) sim.answer(sim.correctOption());
  }
  return sim;
}

/** Повний маршрут із правильними відповідями: без жодного ДТП до фінішу. */
function cleanRun(plan: RunPlan) {
  const sim = new Sim(plan);
  let decisions = 0;
  for (;;) {
    const { hit, all } = runUntil(sim, ['decision', 'finished']);
    expect(all.some((e) => e.type === 'crash'), `ДТП після білета ${decisions}`).toBe(false);
    if (!hit || hit.type === 'finished') break;
    decisions++;
    expect(sim.answer(sim.correctOption())).toBe(true);
  }
  expect(decisions).toBe(plan.tickets.length);
  expect(sim.state.phase).toBe('finished');
}

describe('банк білетів', () => {
  it('350 білетів з унікальними id й питаннями та рівно однією правильною відповіддю', () => {
    expect(TICKETS.length).toBe(350);
    expect(new Set(TICKETS.map((t) => t.id)).size).toBe(TICKETS.length);
    expect(new Set(TICKETS.map((t) => t.question)).size).toBe(TICKETS.length);
    for (const t of TICKETS) expect(t.options.filter((o) => o.correct).length, t.id).toBe(1);
  });

  it('три окремі рівні: 80 легких, 130 середніх і 140 складних', () => {
    expect(ticketsForDifficulty('easy')).toHaveLength(80);
    expect(ticketsForDifficulty('medium')).toHaveLength(130);
    const hard = ticketsForDifficulty('hard');
    expect(hard).toHaveLength(140);
    expect(hard.every((t) => t.id.startsWith('hard-') && t.explanation && t.rule)).toBe(true);
    expect(DIFFICULTIES.flatMap((level) => ticketsForDifficulty(level.id))).toHaveLength(TICKETS.length);
  });

  it('менше 30 % останнього місця в усьому банку й на кожному рівні', () => {
    for (const pool of [TICKETS, ...DIFFICULTIES.map((d) => ticketsForDifficulty(d.id))]) {
      expect(pool.filter((t) => passagePosition(t) === 'last').length).toBeLessThan(pool.length * 0.3);
      expect(pool.some((t) => passagePosition(t) === 'first')).toBe(true);
      if (pool.some((t) => t.difficulty !== 'easy'))
        expect(pool.some((t) => passagePosition(t) === 'middle')).toBe(true);
    }
  });

  it('білети без зебри не отримують її автоматично навіть біля світлофора', () => {
    for (const id of ['hard-turn-no-zebra', 'hard-main-left-no-zebra', 'hard-blind-not-only-zebra']) {
      const plan = planFor([TICKETS.find((t) => t.id === id)!]);
      expect(plan.world.crosswalks, id).toHaveLength(0);
    }
    const regular = planFor([TICKETS.find((t) => t.id === 'signal-right-turn-ped')!]);
    expect(regular.world.crosswalks.length).toBeGreaterThan(0);
  });
});

describe('момент рішення', () => {
  const node = (id: string) => TICKETS.find((t) => t.id === id) as NodeTemplate;

  it('ліворуч і розворот, пропускаючи зустрічних, учень чекає в центрі перехрестя', () => {
    for (const id of ['equal-left-oncoming', 'signal-left-oncoming', 'main-left-ped', 'avenue-left-oncoming-far-lane', 'uturn-signal-oncoming']) {
      const w = waitPoint(node(id));
      expect(w.z, id).toBeGreaterThan(-1.5);
      expect(w.x, id).toBeGreaterThan(-0.35);
    }
  });

  it('перед транспортом поперечної дороги, на «STOP» і на червоний — на стоп-лінії', () => {
    for (const id of ['equal-left-car-right', 'giveway-left-car-left', 'stop-left-car-left', 'uturn-equal-right', 'signal-flash-equal'])
      expect(waitPoint(node(id)), id).toBe(node(id).stopLine);
  });

  it('транспорт у момент рішення поруч із точкою конфлікту, а не за кадром', () => {
    // Другі в черзі навмисно далі: їх видно, але вони під'їдуть пізніше.
    const second = new Set([
      'signal-left-oncoming-two:car2', 'giveway-straight-two:right', 'yard-left-two-cars:far',
      'hard-left-second-oncoming:car2', 'hard-main-both-streams:right', 'hard-compound-yard-three:far',
    ]);
    for (const t of TICKETS)
      for (const a of t.actors) {
        if (a.parked || a.kind === 'pedestrian' || second.has(`${t.id}:${a.id}`)) continue;
        expect(a.gap, `${t.id}:${a.id}`).toBeLessThanOrEqual(18);
      }
  });
});

describe('генератор маршруту', () => {
  it('у заїзді — RUN_SIZE різних білетів, не більше одного виїзду з двору, і він перший', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const plan = createRunPlan(seed);
      expect(plan.tickets.length).toBe(RUN_SIZE);
      expect(new Set(plan.ids).size).toBe(RUN_SIZE);
      const starts = plan.ids.map((id, i) => [i, TICKETS.find((t) => t.id === id)!.site] as const).filter(([, s]) => s === 'start');
      expect(starts.length).toBeLessThanOrEqual(1);
      if (starts.length) expect(starts[0][0]).toBe(0);
    }
  });

  it('різні заїзди — різний набір і порядок білетів', () => {
    const a = createRunPlan(11).ids.join();
    const b = createRunPlan(12).ids.join();
    expect(a).not.toBe(b);
  });

  it('спершу видає ще не бачені білети з усього банку, включно з виїздами з двору', () => {
    const seen = new Set<string>();
    for (let k = 0; k < 40 && seen.size < TICKETS.length; k++) for (const id of createRunPlan(100 + k, seen).ids) seen.add(id);
    expect(seen.size).toBe(TICKETS.length);
  });

  for (const { id: difficulty } of DIFFICULTIES) {
    it(`${difficulty}: маршрут містить лише обраний рівень, навіть після вичерпання його колоди`, () => {
      const pool = ticketsForDifficulty(difficulty);
      const seen = new Set(TICKETS.map((t) => t.id));
      for (let seed = 1; seed <= 15; seed++) {
        const plan = createDifficultyRunPlan(seed, difficulty, seen, 0);
        expect(plan.difficulty).toBe(difficulty);
        expect(plan.ids).toHaveLength(RUN_SIZE);
        expect(new Set(plan.ids).size).toBe(RUN_SIZE);
        expect(plan.ids.every((id) => pool.some((t) => t.id === id))).toBe(true);
      }
    });

    it(`${difficulty}: бачені білети іншого рівня не заважають отримувати нові`, () => {
      const pool = ticketsForDifficulty(difficulty);
      const seen = new Set(TICKETS.filter((t) => t.difficulty !== difficulty).map((t) => t.id));
      const first = createDifficultyRunPlan(71, difficulty, seen, 0);
      first.ids.forEach((id) => seen.add(id));
      const second = createDifficultyRunPlan(72, difficulty, seen, 0);
      expect(second.ids.every((id) => !first.ids.includes(id))).toBe(true);
      expect(second.ids.every((id) => pool.some((t) => t.id === id))).toBe(true);
    });

    for (const seed of [17, 29, 43]) {
      it(`${difficulty}, заїзд ${seed}: усі правильні відповіді — без ДТП до фінішу`, () => {
        cleanRun(createDifficultyRunPlan(seed, difficulty, new Set(), 0));
      });
    }
  }

  it('траєкторія учня плавна: без різких зламів і розворотів (перестроювання, повороти)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new Sim(createRunPlan(seed, new Set(), RUN_SIZE, TICKETS, 0));
      for (let s = 2; s < sim.egoPath.length - 2; s += 0.5)
        expect(Math.abs(curvatureAt(sim.egoPath, s, 2)), `заїзд ${seed}, s = ${s}`).toBeLessThan(0.3);
    }
  });

  it('квота останнього місця зберігається з новою, частково й повністю пройденою колодою', () => {
    for (const difficulty of DIFFICULTIES) {
      const pool = ticketsForDifficulty(difficulty.id);
      const states = [new Set<string>(), new Set(pool.filter((t) => passagePosition(t) !== 'last').map((t) => t.id)), new Set(TICKETS.map((t) => t.id))];
      for (const seen of states) for (let seed = 1; seed <= 30; seed++) {
        const plan = createDifficultyRunPlan(seed, difficulty.id, seen, 0);
        const picked = plan.ids.map((id) => TICKETS.find((t) => t.id === id)!);
        expect(picked.filter((t) => passagePosition(t) === 'last').length, `${difficulty.id}/${seed}`).toBeLessThanOrEqual(lastPlaceLimit(RUN_SIZE));
      }
    }
  });

  it('малий заїзд також має строго менше 30 % останнього місця', () => {
    for (const count of [1, 2, 3, 4, 7, 10, 20]) {
      const picked = drawTickets(TICKETS, count, seededRandom(count));
      expect(picked).toHaveLength(count);
      expect(picked.filter((t) => passagePosition(t) === 'last').length).toBeLessThan(count * 0.3);
    }
  });

  it('drawTickets не дублює білети', () => {
    const picked = drawTickets(TICKETS, 20, seededRandom(3));
    expect(new Set(picked.map((t) => t.id)).size).toBe(20);
  });

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`заїзд ${seed}: усі правильні відповіді — маршрут без ДТП до фінішу`, () => cleanRun(createRunPlan(seed, new Set(), RUN_SIZE, TICKETS, 0)));
  }
});

describe('інтерактивні білети', () => {
  TICKETS.forEach((template) => {
    describe(`${template.id} — ${template.title}`, () => {
      const plan = planFor([template], 3);

      it('у момент рішення авто стоїть, а учасник — на заданій відстані від конфлікту', () => {
        const sim = reachTicket(plan, 0);
        expect(sim.state.ego.v).toBe(0);
        expect(sim.state.ego.s).toBeCloseTo(sim.prepared[0].stopS, 1);
        for (const pa of sim.prepared[0].actors) {
          if (pa.spec.parked) continue;
          const a = sim.state.actors.find((x) => x.id === `0:${pa.spec.id}`)!;
          expect(a.alive, pa.spec.id).toBe(true);
          expect(pa.conflictS - a.s).toBeCloseTo(pa.spec.gap, 1);
        }
      });

      it('правильна відповідь — без ДТП, рух до фінішу', () => {
        const sim = reachTicket(plan, 0);
        expect(sim.answer(sim.correctOption())).toBe(true);
        const { hit, all } = runUntil(sim, ['decision', 'finished']);
        expect(all.some((e) => e.type === 'crash')).toBe(false);
        expect(all.some((e) => e.type === 'ticketCleared')).toBe(true);
        expect(hit?.type).toBe('finished');
      });

      if (passagePosition(template) !== 'last') it('фактичний проїзд: лише учасники з перевагою перед учнем', () => {
        const sim = reachTicket(plan, 0);
        const prepared = sim.prepared[0];
        const crossed = new Map<string, { ego?: number; actor?: number }>();
        for (const pa of prepared.actors) {
          const a = sim.state.actors.find((a) => a.id === `0:${pa.spec.id}`)!;
          if (pa.spec.yieldsToEgo) expect(a.v).toBe(0);
          crossed.set(pa.spec.id, {});
        }
        sim.answer(sim.correctOption());
        for (let n = 0; n < 60 / SIM_DT; n++) {
          const ev = sim.step(SIM_DT);
          expect(ev.some((e) => e.type === 'crash'), template.id).toBe(false);
          for (const pa of prepared.actors) {
            const order = crossed.get(pa.spec.id)!;
            if (sim.state.ego.s >= pa.egoConflictS && order.ego === undefined) order.ego = sim.state.time;
            const a = sim.state.actors.find((a) => a.id === `0:${pa.spec.id}`);
            if (a && (pa.spec.yieldsToEgo ? a.v > 0 : a.s >= pa.conflictS) && order.actor === undefined) order.actor = sim.state.time;
          }
          if ([...crossed.values()].every((o) => o.ego !== undefined && o.actor !== undefined)) break;
        }
        for (const pa of prepared.actors) {
          const order = crossed.get(pa.spec.id)!;
          expect(order.ego, `${template.id}/${pa.spec.id}: учень проїхав`).toBeDefined();
          expect(order.actor, `${template.id}/${pa.spec.id}: учасник проїхав або рушив після учня`).toBeDefined();
          if (pa.spec.yieldsToEgo) expect(order.ego!).toBeLessThan(order.actor!);
          else expect(order.actor!).toBeLessThan(order.ego!);
        }
      });

      template.options.forEach((o, oi) => {
        if (o.correct) return;
        it(`неправильна відповідь ${oi + 1} — ${o.mistakeOnly ? 'помилка без ДТП' : 'ДТП з учасником ситуації'}`, () => {
          const sim = reachTicket(plan, 0);
          expect(sim.answer(oi)).toBe(false);
          if (o.mistakeOnly) {
            const snapshot = sim.snapshot();
            expect(snapshot.phase).toBe('mistake');
            expect(snapshot.crash).toBeNull();
            expect(sim.step(SIM_DT)).toEqual([]);
            expect(sim.snapshot()).toEqual(snapshot);
            return;
          }
          const { hit } = runUntil(sim, 'crash', 8);
          expect(hit?.type).toBe('crash');
          if (hit?.type === 'crash') {
            expect(hit.crash.actorId.startsWith('0:')).toBe(true);
            const actor = template.actors.find((a) => `0:${a.id}` === hit.crash.actorId);
            expect(actor?.parked ?? false, 'ДТП має бути з учасником, а не з перешкодою').toBe(false);
            expect(actor?.yieldsToEgo ?? false, 'Учасник без переваги продовжує чекати').toBe(false);
            expect(hit.crash.strength).toBeGreaterThan(1);
          }
          expect(runUntil(sim, 'crashSettled', 5).hit).not.toBeNull();
        });
      });
    });
  });

  it('знімок у момент рішення дозволяє переграти ситуацію після ДТП', () => {
    const plan = planFor([TICKETS.find((t) => t.id === 'equal-right')!]);
    const sim = reachTicket(plan, 0);
    const snap = sim.snapshot();
    sim.answer(plan.tickets[0].options.findIndex((o) => !o.correct));
    runUntil(sim, 'crashSettled');
    sim.restore(snap);
    expect(sim.state.phase).toBe('decision');
    expect(sim.state.crash).toBeNull();
    sim.answer(sim.correctOption());
    const { all } = runUntil(sim, ['decision', 'finished']);
    expect(all.some((e) => e.type === 'crash')).toBe(false);
  });

  it('«зелений щойно ввімкнувся»: у момент рішення учню горить зелений, поперечній — червоний', () => {
    const plan = planFor([TICKETS.find((t) => t.id === 'signal-clearing-bus')!], 2);
    const sim = reachTicket(plan, 0);
    const sig = plan.world.signals[0];
    const ego = plan.tickets[0].stopLine;
    const egoAxis = Math.abs(ego.x - sig.x) < Math.abs(ego.z - sig.z) ? 'ns' : 'ew';
    const cross = egoAxis === 'ns' ? 'ew' : 'ns';
    expect(sim.state.lights[sig.id][egoAxis]).toBe('green');
    expect(sim.state.lights[sig.id][cross]).toBe('red');
  });
});

describe('ДТП не з вини учня', () => {
  TICKETS.filter((t) => t.site !== 'start').forEach((template) => {
    it(`${template.id}: правильна відповідь — у учня в'їжджають ззаду; після оформлення маршрут триває`, () => {
      const plan = withInnocent(planFor([template], 3), 0);
      const sim = reachTicket(plan, 0);
      const snap = sim.snapshot();
      expect(sim.answer(sim.correctOption())).toBe(true);
      const { hit } = runUntil(sim, 'crash', 6);
      expect(hit?.type).toBe('crash');
      if (hit?.type === 'crash') expect(hit.crash.innocent).toBe(true);
      expect(runUntil(sim, 'crashSettled', 5).hit).not.toBeNull();
      sim.restore(snap);
      sim.dropAtFault();
      sim.answer(sim.correctOption());
      const { hit: end, all } = runUntil(sim, ['decision', 'finished']);
      expect(all.some((e) => e.type === 'crash')).toBe(false);
      expect(end?.type).toBe('finished');
    });

    it(`${template.id}: неправильна відповідь — ДТП з учасником ситуації, а не з водієм ззаду`, () => {
      const plan = withInnocent(planFor([template], 3), 0);
      const sim = reachTicket(plan, 0);
      sim.answer(template.options.findIndex((o) => !o.correct));
      if (template.options.find((o) => !o.correct)?.mistakeOnly) {
        expect(sim.state.phase).toBe('mistake');
        expect(sim.state.crash).toBeNull();
      } else {
        const { hit } = runUntil(sim, 'crash', 8);
        expect(hit?.type).toBe('crash');
        if (hit?.type === 'crash') expect(hit.crash.innocent).toBe(false);
      }
    });
  });

  it('у заїзді щонайбільше один такий білет, і не перший', () => {
    let total = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const n = createRunPlan(seed).tickets.filter((t, i) => t.innocent && (expect(i).toBeGreaterThan(0), true)).length;
      expect(n).toBeLessThanOrEqual(1);
      total += n;
    }
    // ≈ 1 − 0,95^19 ≈ 62 % заїздів.
    expect(total).toBeGreaterThan(50);
    expect(total).toBeLessThan(100);
  }, 60000);
});
