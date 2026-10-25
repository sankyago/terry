import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../src/config';
import type { SimEvent } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { TICKETS } from '../src/tickets/tickets';

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
function reachTicket(index: number) {
  const sim = new Sim();
  for (let i = 0; i <= index; i++) {
    const { hit } = runUntil(sim, 'decision');
    expect(hit, `рішення в білеті ${i}`).toMatchObject({ type: 'decision', ticket: i });
    if (i < index) sim.answer(sim.correctOption());
  }
  return sim;
}

describe('інтерактивні білети', () => {
  it('усі правильні відповіді — маршрут без ДТП до фінішу', () => {
    const sim = new Sim();
    let decisions = 0;
    for (;;) {
      const { hit, all } = runUntil(sim, ['decision', 'finished']);
      expect(all.some((e) => e.type === 'crash')).toBe(false);
      if (!hit || hit.type === 'finished') break;
      decisions++;
      expect(sim.answer(sim.correctOption())).toBe(true);
    }
    expect(decisions).toBe(TICKETS.length);
    expect(sim.state.phase).toBe('finished');
  });

  TICKETS.forEach((ticket, index) => {
    describe(ticket.title, () => {
      it('у момент рішення авто стоїть, а учасник — на заданій відстані від конфлікту', () => {
        const sim = reachTicket(index);
        expect(sim.state.ego.v).toBe(0);
        expect(sim.state.ego.s).toBeCloseTo(sim.prepared[index].stopS, 1);
        for (const pa of sim.prepared[index].actors) {
          const a = sim.state.actors.find((x) => x.id === `${index}:${pa.spec.id}`)!;
          expect(a.alive).toBe(true);
          expect(pa.conflictS - a.s).toBeCloseTo(pa.spec.gap, 1);
        }
      });

      it('правильна відповідь — без ДТП, рух продовжується', () => {
        const sim = reachTicket(index);
        expect(sim.answer(sim.correctOption())).toBe(true);
        const { hit, all } = runUntil(sim, ['decision', 'finished']);
        expect(all.some((e) => e.type === 'crash')).toBe(false);
        expect(all.some((e) => e.type === 'ticketCleared')).toBe(true);
        expect(hit).not.toBeNull();
      });

      ticket.options.forEach((o, oi) => {
        if (o.correct) return;
        it(`неправильна відповідь ${oi + 1} — ДТП з учасником ситуації`, () => {
          const sim = reachTicket(index);
          expect(sim.answer(oi)).toBe(false);
          const { hit } = runUntil(sim, 'crash', 8);
          expect(hit?.type).toBe('crash');
          if (hit?.type === 'crash') {
            expect(hit.crash.actorId.startsWith(`${index}:`)).toBe(true);
            expect(hit.crash.strength).toBeGreaterThan(1);
          }
          expect(runUntil(sim, 'crashSettled', 5).hit).not.toBeNull();
        });
      });
    });
  });

  it('знімок у момент рішення дозволяє переграти ситуацію після ДТП', () => {
    const sim = reachTicket(2);
    const snap = sim.snapshot();
    sim.answer(TICKETS[2].options.findIndex((o) => !o.correct));
    runUntil(sim, 'crashSettled');
    sim.restore(snap);
    expect(sim.state.phase).toBe('decision');
    expect(sim.state.crash).toBeNull();
    sim.answer(sim.correctOption());
    const { all } = runUntil(sim, 'decision');
    expect(all.some((e) => e.type === 'crash')).toBe(false);
  });

  it('світлофор B вмикає зелений для учня саме в момент рішення', () => {
    const sim = reachTicket(5);
    expect(sim.state.lights.B).toEqual({ ns: 'red', ew: 'green' });
  });
});
