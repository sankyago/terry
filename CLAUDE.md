# Cruise — interactive driving-theory tickets

Babylon.js + React + Vite + TypeScript. The car drives itself through a small city (camera above at 45°);
at each situation the world pauses and the player answers a ticket. A wrong answer plays out as a crash.

## Commands

- `npm run dev` — dev server (`?debug` exposes the game as `window.__cruise`)
- `npm test` — Vitest (simulation and storage); `npm run typecheck`; `npm run build`

## Layout

- `src/tickets/tickets.ts` — ego route and all tickets: question, options, explanation, ПДР rule, stop line, actors, light scripts.
- `src/sim/` — pure, deterministic simulation (no Babylon/DOM). `sim.ts` drives the ego on autopilot, spawns
  each ticket's actors so they reach their `gap` from the conflict point exactly at the decision moment, and
  times wrong answers so the crash always happens. `snapshot()`/`restore()` replay a situation.
- `src/scene/` — procedural low-poly city, vehicles, pedestrians, crash effects, decision guides.
- `src/game/Game.ts` — fixed 60 Hz loop, statuses, events for the UI. `src/ui/` — React overlays.

## Conventions

- UI text, comments and test names are in Ukrainian; keep it that way.
- Coordinates: heading 0 = +Z, positive heading turns right (+X); right-hand traffic, lane offset 1.75 m.
- After changing a ticket, run `npm test`: `tests/tickets.test.ts` checks every wrong option crashes and the
  correct one does not.
- The ego car's dimensions are an Audi A5 Coupé 2012 (`CAR` in `src/config.ts`).
