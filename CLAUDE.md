# Cruise — interactive driving-theory tickets

Babylon.js + React + Vite + TypeScript. The car drives itself through a small city (camera above at 45°);
at each situation the world pauses and the player answers a ticket. A wrong answer plays out as a crash.

## Commands

- `npm run dev` — dev server (`?debug` exposes the game as `window.__cruise`; with it `&tickets=id1,id2&seed=N` fixes the run)
- `npm test` — Vitest (simulation and storage); `npm run typecheck`; `npm run build`

## Layout

- `src/tickets/tickets.ts` — the bank of ticket templates (50) in local coordinates (ego approaches from the south, +X = right):
  question, options, explanation, ПДР rule, stop line, actors, signs, props, light scripts. Helpers in `local.ts`.
- `src/tickets/plan.ts` — run generator: draws `RUN_SIZE` (20) tickets (unseen first), lays out a route on the city grid
  (backtracking, no node visited twice) and places templates into world coordinates → `RunPlan` (route, tickets, world features).
- `src/sim/` — pure, deterministic simulation (no Babylon/DOM). `new Sim(plan)`; `sim.ts` drives the ego on autopilot, spawns
  each ticket's actors so they reach their `gap` from the conflict point exactly at the decision moment, and
  times wrong answers so the crash always happens. `snapshot()`/`restore()` replay a situation.
- `src/scene/` — procedural low-poly city (rebuilt per run from `plan.world`), vehicles, pedestrians, crash effects, decision guides.
  `vehicleModels.ts` — car bodies (Audi A5 coupé for the ego + sedan/hatch/wagon/SUV/van for traffic), ambulance, bus;
  `geometry.ts` — `FlatGeometry`: flat-shaded lofts through cross-sections, boxes, quads (one mesh per material).
- `src/game/Game.ts` — fixed 60 Hz loop, statuses, events for the UI. `src/ui/` — React overlays.

## Conventions

- UI text, comments and test names are in Ukrainian; keep it that way.
- Coordinates: heading 0 = +Z, positive heading turns right (+X); right-hand traffic, lane offset 1.75 m.
- After changing a ticket, run `npm test`: `tests/tickets.test.ts` places every template on its own route and checks
  every wrong option crashes and the correct one does not; it also runs several full random runs without a crash.
- The ego car's dimensions are an Audi A5 Coupé 2012 (`CAR` in `src/config.ts`).
