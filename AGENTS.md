# AGENTS

## Project Purpose

This repository is for a browser-based tower-defense game designed as offline local multiplayer first, with online mode planned for a later phase.

Core concept:
- 1 to 8 human players in one match
- Each player places one tower at match start
- Towers defend against invading creatures
- Players earn points from creature kills and spend points on upgrades
- First player to 1000 points wins

## Current Status

The offline MVP is implemented: simulation, local server, Vite client, browser smoke
flow, performance check, rematch flow, CI quality gates, structured server logging.

## Code Map

Roles only, no line numbers. Big files cost the most to read: open the part you need.
- packages/shared/src: types and constants (game-rules.ts, map-types.ts, match-types.ts, wave-plan.ts, validation).
- packages/simulation/src: match-simulation.ts (MatchSimulation, createMatch), procedural-map.ts, spawn-order.ts, shot-roll.ts, balance-report/baseline-* (balance baselines CLI). Tests are `*.test.ts` beside the source.
- packages/transport/src: game-api.ts (transport-agnostic handlers, toWireSnapshot), http-client.ts (client side of the same API).
- apps/server/src/index.ts: Node HTTP host around the game API, plus logger.ts.
- apps/client/src: main.ts (entry), services.ts, battlefield-scene.ts (Phaser scene), api.ts (wire types), style.css, local-host.ts (in-browser host).
- e2e/smoke.spec.ts: Playwright browser flow. spec/: design docs (see below).

## Commands

Run from the repo root. Node 20.
- Build: `npm run build` (needed before typecheck, test and baseline commands; tests run compiled `dist/*.test.js`)
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Unit tests: `npm test`
- Perf check: `npm run test:perf`
- Browser tests: `npm run test:e2e` (starts the game server on port 4173)
- Balance drift check: `npm run baseline:balance:diff:ci` (must show zero drift)
- One test file: `npm run build && node --test packages/simulation/dist/shot-roll.test.js`
- Run the game: `npm run dev:game`

## Determinism Rules

- The simulation uses seeded RNG only. No `Math.random` or `Date` in packages/simulation.
- Tick order and RNG draw order are the contract: reordering changes outcomes.
- Never regenerate baselines or fixtures to make a diff pass. Refreshing needs
  `BASELINE_REFRESH_CONFIRM=true npm run baseline:balance:refresh:guard` and explicit intent.

## Paths to Skip

Generated or data, not worth reading: `packages/simulation/artifacts/`,
`packages/simulation/src/__fixtures__/`, `dist/`, `package-lock.json`, `.claude/worktrees/`.
Bare `find` or `grep -r` is not covered by the local `.git/info/exclude`, so exclude these yourself.

## Where to Find the Specs

Main spec folder:
- spec/

Start here:
- spec/README.md

Primary planning documents:
- spec/01-product-vision.md
- spec/02-gameplay-rules.md
- spec/03-multiplayer-networking.md
- spec/04-technical-architecture.md
- spec/05-map-system.md
- spec/06-economy-balance.md
- spec/07-backend-api-events.md
- spec/08-data-persistence.md
- spec/09-testing-quality.md
- spec/10-delivery-roadmap.md
- spec/11-match-flow-ui.md

## Basic Contributor Instructions

1. Read spec/README.md and 02-gameplay-rules.md before proposing changes.
2. Keep MVP offline-first. Do not implement online networking yet.
3. Preserve game constraints from specs (for example fixed tower placement, path rules, and 1000-point win condition).
4. When changing behavior, update the relevant spec file first, then code.
5. Keep architecture transport-agnostic so online mode can be added later.
6. Add or update tests for simulation rules and deterministic outcomes.

## Notes

- AI players (bots, easy/medium/hard) are implemented: pure planner in packages/simulation/src/ai-player.ts, driven one step at a time through `/api/ai-step` by the client.
- Procedural maps are required from the start.
- Towers must never target other towers.
- Towers are placed only on dedicated tower spots next to the road, never on the 2-cell-wide path creatures walk.
