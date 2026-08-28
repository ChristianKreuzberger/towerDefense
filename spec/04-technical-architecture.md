# 04 Technical Architecture

## Proposed stack

- Client MVP: TypeScript + Vite with DOM/CSS presentation
- Client future presentation upgrade: Phaser 3 + TypeScript + Vite
- Simulation host: Node.js + TypeScript
- Future online adapter: Colyseus (not enabled in MVP)
- Shared package: game constants, DTOs, validation schemas, deterministic formulas
- Database: PostgreSQL
- Optional cache/session: Redis

## Repository structure

- apps/client
- apps/server
- packages/shared
- packages/simulation
- packages/transport
- spec

## Runtime boundaries

- Client handles menu, presentation, input, and local split-player controls
- Simulation core owns authoritative game state in offline MVP
- Transport adapter boundary allows online mode to be added later
- Shared package prevents drift in formulas and types

## Build tools

- Client dev/build: Vite
- Server dev: tsx
- Server production build: tsup or esbuild

## Configuration

- Environment variables per app
- Strict schema validation for env at startup
- Separate dev, staging, and production configs

## Observability

- Structured logging (pino)
- Match lifecycle logs (room create, wave start, wave end)
- Error tracking hook points for both client and server

## Performance targets

- Support up to 8 players and 300 active creatures in MVP
- Keep server tick processing under 16 ms budget at normal load

## Product constraints reflected in architecture

- One fixed tower per player after placement
- Tower-vs-tower combat disabled in simulation rules
- Procedural map generation runs before mandatory initial tower placement
- Round transition pipeline includes automatic tower repair and UI event emission

## MVP presentation decision

The current offline MVP uses a DOM/CSS client because it supports the required
menu, placement, wave, repair, and end-of-match flows with deterministic browser
smoke coverage. Phaser 3 remains the planned post-kickoff presentation upgrade
for richer battlefield rendering and effects; migrating the client is not
required for the current simulation or offline acceptance gates.

## Presentation layer migration plan (DOM/CSS -> Phaser 3)

Decision: adopt Phaser 3 (WebGL, falls back to Canvas) as the battlefield
renderer, replacing the DOM `.grid-cell` board. Confirmed direction: stay 2D
(no Three.js/Babylon 3D engine) — Phaser gives the needed render efficiency
for large grids (50x50+) and up to 300 active creatures without an
engine-scale rewrite, and keeps the option open for an isometric/2.5D tile
style later if desired.

Why the DOM renderer is the actual bottleneck, not the game logic:
- The simulation core only emits a plain `MatchSnapshot` (grid cells, tower/
  creature/wall positions, HP, phase) and has zero rendering dependencies.
  Swapping the renderer does not touch `packages/simulation` or
  `packages/shared`.
- A prior perf bug (O(n^2) cell lookup in `renderBoard`, see repo memory) was
  only exposed because every cell is a real DOM node with CSS gradients;
  WebGL sprite batching in Phaser removes this class of scaling problem.

Migration scope (client-only, non-breaking to server/simulation contracts):
1. Add Phaser 3 as an `apps/client` dependency alongside Vite; keep the HTML
   menu/HUD/overlay chrome as DOM (Phaser owns only the battlefield canvas).
2. Introduce a `BattlefieldScene` that consumes the same polled
   `MatchSnapshot` the DOM renderer used, and maps grid cells/towers/
   creatures/walls to Phaser sprites/tilemap layers.
3. Reuse existing tower/wall/creature visual language (level glow, HP-based
   fade, archetype cues) as sprite tint/scale/texture swaps instead of CSS.
4. Keep click-to-place-tower and other board interactions working via
   Phaser input events mapped to the same `place-tower`/command calls.
5. Migrate `e2e/smoke.spec.ts` board selectors from `.grid-cell` DOM queries
   to Phaser-canvas-safe interactions (e.g. canvas click coordinates or a
   thin DOM test-hook layer Phaser updates per frame).
6. Remove the DOM `.battlefield`/`.grid-cell` CSS/render code once the
   Phaser scene reaches parity.

Non-goals for this migration:
- No 3D camera/meshes (Three.js/Babylon) — explicitly deferred/declined.
- No gameplay rule changes; this is a rendering-layer swap only.
- No change to server API, snapshot shape, or simulation determinism.

Acceptance checks:
- Existing e2e smoke flow (menu -> placement -> wave -> end) passes against
  the Phaser board.
- 50x50 map with 300 creatures renders without the prior DOM perf
  degradation (manual/perf-test spot check).
- No change in simulation test results (`packages/simulation` tests remain
  green, untouched).
