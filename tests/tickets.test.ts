import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config';
import type { SimEvent } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { RunPlan } from '../src/tickets/plan';
import { RUN_SIZE, createRunPlan, drawTickets, planFor } from '../src/tickets/plan';
import { TICKETS } from '../src/tickets/tickets';
import { seededRandom } from '../src/sim/random';

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
  it('50 білетів з унікальними id і рівно однією правильною відповіддю', () => {
    expect(TICKETS.length).toBe(50);
    expect(new Set(TICKETS.map((t) => t.id)).size).toBe(TICKETS.length);
    for (const t of TICKETS) expect(t.options.filter((o) => o.correct).length, t.id).toBe(1);
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

  it('спершу видає ще не бачені білети: за 4 заїзди — усі 50', () => {
    const seen = new Set<string>();
    for (let k = 0; k < 4; k++) for (const id of createRunPlan(100 + k, seen).ids) seen.add(id);
    expect(seen.size).toBe(TICKETS.length);
  });

  it('drawTickets не дублює білети', () => {
    const picked = drawTickets(TICKETS, 20, seededRandom(3));
    expect(new Set(picked.map((t) => t.id)).size).toBe(20);
  });

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`заїзд ${seed}: усі правильні відповіді — маршрут без ДТП до фінішу`, () => cleanRun(createRunPlan(seed)));
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

      template.options.forEach((o, oi) => {
        if (o.correct) return;
        it(`неправильна відповідь ${oi + 1} — ДТП з учасником ситуації`, () => {
          const sim = reachTicket(plan, 0);
          expect(sim.answer(oi)).toBe(false);
          const { hit } = runUntil(sim, 'crash', 8);
          expect(hit?.type).toBe('crash');
          if (hit?.type === 'crash') {
            expect(hit.crash.actorId.startsWith('0:')).toBe(true);
            const actor = template.actors.find((a) => `0:${a.id}` === hit.crash.actorId);
            expect(actor?.parked ?? false, 'ДТП має бути з учасником, а не з перешкодою').toBe(false);
            expect(hit.crash.strength).toBeGreaterThan(1);
          }
          expect(runUntil(sim, 'crashSettled', 5).hit).not.toBeNull();
        });
      });
    });
  });

  it('знімок у момент рішення дозволяє переграти ситуацію після ДТП', () => {
    const plan = createRunPlan(5);
    const sim = reachTicket(plan, 2);
    const snap = sim.snapshot();
    sim.answer(plan.tickets[2].options.findIndex((o) => !o.correct));
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
