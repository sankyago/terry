# Cruise — interactive driving-theory tickets

Babylon.js + React + Vite + TypeScript. The car drives itself through a small city (camera above at 45°);
at each situation the world pauses and the player answers a ticket. A wrong answer plays out as a crash.

## Commands

- `npm run dev` — dev server (`?debug` exposes the game as `window.__cruise`; with it `&tickets=id1,id2&seed=N` fixes the run,
  `&innocent=N` makes ticket N an at-no-fault crash)
- `npm test` — Vitest (simulation and storage); `npm run typecheck`; `npm run build`

## Layout

- `src/tickets/tickets.ts` — the bank of ticket templates (150) in local coordinates (ego approaches from the south, +X = right):
  question, options, explanation, ПДР rule, stop line, actors, signs, props, bike paths, light scripts. More templates in
  `cyclists.ts`, `more.ts`, `avenue.ts`, `extra.ts`; helpers (`ask`, `drive`, `walk`, stop lines, lanes, `uTurnCorners`) in `local.ts`.
- Node turns: `straight`, `left`, `right`, `uturn` (a teardrop loop inside the intersection; the route then returns along the
  same street through the previous node, which must have no traffic light, and the block between them must have no ticket).
- Sites: `start` (yard exit), `node` (intersection; with `lanes` — on an avenue), `block` (between intersections of a street),
  `avenue` (between intersections of an avenue; ego corners only within z −8…6, `laneIn`/`laneOut` lane indices from the centre line).
- City: 8×8 grid, streets have one lane each way; avenues (`CITY.avenuesX/Z`: X = 270 — 2 lanes, Z = −90 — 3 lanes) have a bike lane
  at the curb. Lane helpers in `src/sim/city.ts`.
- `src/tickets/plan.ts` — run generator: draws `RUN_SIZE` (20) tickets (unseen first), lays out a route on the city grid
  (backtracking with a small lookahead, no node visited twice except on the way back after a U-turn), plans the ego's lane on avenues (lane changes before turns and
  templates) and places templates into world coordinates → `RunPlan` (route, tickets, world features). On a left turn or
  U-turn the ego waits in the centre of the intersection instead of at the stop line (`waitPoint`) when entry is allowed
  (not «STOP», green/flashing light), no actor comes along the cross road and no actor path touches the ego on its way there.
  With `INNOCENT_CHANCE` (5 %) per ticket (at most one per run, never the first) a ticket becomes an at-no-fault crash: a car from behind (`atFault`) rear-ends
  the ego after a correct answer, and the game runs the step-by-step accident procedure (`src/tickets/procedure.ts`, ПДР 2.10/2.11).
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
  every wrong option crashes and the correct one does not, that the at-no-fault variant crashes only after a correct answer;
  it also runs several full random runs without a crash and checks the ego's path has no kinks.
- An actor's `gap` is about 1.3 s of its speed (cars 13–18 m): farther away it is off screen at the decision moment.
- Actors that end up driving ahead of the ego in its lane must be faster than it (cars accelerate after the conflict point);
  cyclists and pedestrians must leave the ego's lane.
- The ego car's dimensions are an Audi A5 Coupé 2012 (`CAR` in `src/config.ts`).
