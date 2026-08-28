# Tower Defense (Browser, Offline-First)

A multiplayer tower-defense game for the browser, designed for local offline play first and future online expansion.

## Concept

- 1 to 8 human players per match
- Each player places one tower at the start
- Towers defend against invading creatures
- Creature kills grant points
- Points buy tower upgrades and walls
- Walls affect pathing and must not create invalid maps
- First player to 1000 points wins

## Project Status

The deterministic simulation, local server, Vite client, balance reports, and baseline drift checks are implemented.
Browser smoke coverage now verifies the local menu-to-wave playable flow.

## Start Here

- Project guidance: [AGENTS.md](AGENTS.md)
- Spec index: [spec/README.md](spec/README.md)

## MVP Principles

- Offline local multiplayer first
- Procedurally generated maps
- Fixed tower placement after initial setup
- No tower-vs-tower damage
- Round-based tower auto-repair with visible player feedback
- Architecture prepared for future online mode patching

## Planned Tech Direction

- Client: Phaser 3 + TypeScript + Vite
- Simulation host: Node.js + TypeScript
- Shared game logic and schema validation packages
- Future online adapter: Colyseus (not enabled in MVP)

## Contribution Notes

1. Update specs before changing behavior.
2. Keep rule changes consistent across related spec files.
3. Maintain deterministic simulation rules for future networking compatibility.

## Local Development

Prerequisites:
- Node.js 20+
- npm 10+

Install dependencies:

```bash
npm install
```

Run workspace typecheck:

```bash
npm run typecheck
```

Run the repository lint check:

```bash
npm run lint
```

Run workspace build:

```bash
npm run build
```

Run the local playable game host:

```bash
npm run dev:game
```

Then open:

```text
http://localhost:4173
```

Run the browser smoke test (the first run may require `npx playwright install chromium`):

```bash
npm run test:e2e
```

Run the eight-player simulation performance check:

```bash
npm run test:perf
```

The check measures `advance-wave` tick timings across three waves, reports the 16 ms target, and uses a 100 ms regression ceiling for machine-independent CI validation.

Pull requests and pushes to `main` run the typecheck, unit tests, performance check, production build, browser smoke tests, and deterministic balance drift check in CI.

The local server emits structured JSON lifecycle logs for server startup, match creation, wave transitions, match completion, and request failures.

Quick play loop in browser:
1. Enter player names and click Start Match.
2. Pick a player and place each tower on buildable cells shown as . in the board.
3. Click Ready For Wave for each player.
4. Click Advance Wave Tick or Advance 30 Ticks to run combat.
5. Use Place Wall, Upgrade Tower, and Set Target Mode during wave phase.

Notes:
- If a command is rejected, Last Action shows the reason (for example path-blocked or insufficient-points).
- The right-side snapshot panel is the live deterministic simulation state.

## Balance Analysis Workflow (Offline)

This workflow supports deterministic, offline balance tuning for MVP. It does not enable online networking and does not change match behavior.

1. Build once so the simulation CLI and package entrypoints are available:

```bash
npm run build
```

2. Generate a balance snapshot export JSON from simulation (`MatchSnapshot.balanceAnalysisExports`) using a fixed seed and deterministic commands:

```bash
mkdir -p tmp
node --input-type=module -e 'import { writeFileSync } from "node:fs"; import { createMatch } from "./packages/simulation/dist/index.js"; const sim = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed: 777 }); sim.applyCommand({ type: "place-tower", playerId: "p1", x: 0, y: 1 }); sim.applyCommand({ type: "ready-for-wave", playerId: "p1" }); for (let i = 0; i < 40; i += 1) { if (sim.getSnapshot().phase !== "wave") break; sim.applyCommand({ type: "advance-wave" }); } const out = { balanceAnalysisExports: sim.getSnapshot().balanceAnalysisExports }; writeFileSync("tmp/balance-analysis.seed-777.json", JSON.stringify(out, null, 2));'
```

3. Run the offline report CLI from repo root:

```bash
npm --workspace @tower-defense/simulation run report:balance -- --input ../../tmp/balance-analysis.seed-777.json
```

4. Capture and view in-repo deterministic baseline artifacts (fixed scenario set):

```bash
npm run baseline:balance:capture
npm run baseline:balance:report
```

Artifacts are written to:
- `packages/simulation/artifacts/baselines/balance/inputs`
- `packages/simulation/artifacts/baselines/balance/reports`

5. Compare baseline artifacts deterministically (machine-readable JSON + text summary):

```bash
npm run baseline:balance:diff:stdout
```

By default this compares:
- baseline: `packages/simulation/artifacts/baselines/balance`
- candidate: `packages/simulation/artifacts/baselines/balance`

The command writes JSON output to:
- `packages/simulation/artifacts/baselines/balance/baseline-diff.result.json`

For PR/CI drift checks (non-zero when drift exists):

```bash
npm run baseline:balance:diff:ci
```

CI workflow entrypoint:

```bash
npm run baseline:balance:verify:ci
```

This command runs:
- `npm run build`
- `npm run baseline:balance:diff:ci`

It is wired in `.github/workflows/baseline-balance-drift.yml` and is non-interactive.

For ad-hoc candidate directories (for example, copied fresh capture output):

```bash
npm --workspace @tower-defense/simulation run report:baseline:diff -- \
	--baseline artifacts/baselines/balance \
	--candidate ../../tmp/balance-candidate \
	--json-out ../../tmp/balance-candidate.diff.json \
	--stdout
```

5. Optional quick smoke run using the deterministic fixture:

```bash
npm --workspace @tower-defense/simulation run report:balance -- --input src/__fixtures__/balance-analysis-snapshots.fixture.json
```

Expected output sections:
- Header: `Tower Defense Balance Report`, `schemaVersion`, `matchSeed`, `snapshots`
- Per-wave blocks: `=== Wave N (export=..., tick=...) ===`
- Per-wave metrics: `DPS proxy`, `Kills by archetype`, `Damage intake`, `Repairs`, `Economy delta`, `Players`
- Final block: `=== Cumulative Summary ===` with totals and final player states

Deterministic reproducibility and tuning notes:
- Keep `seed`, player order, and command sequence identical when comparing tuning changes.
- Treat each report as a baseline artifact and compare only one tuning dimension at a time (for example wall cost growth or repair amount).
- Compare by section: wave pacing (`tick`), survivability (`towerDamageIntake`/`wallDamageIntake`), economy (`net` and ending points), and structure stability (`livingTowers`, `livingWalls`, `pathWearTotal`).
- For MVP balance reviews, keep interpretation anchored to current constraints: offline-first flow, fixed initial tower placement, no tower-vs-tower targeting, and win threshold at 1000 points.

Diff interpretation guidance:
- `result=PASS`: no scenario-level drift detected.
- `result=FAIL`: one or more scenarios drifted; inspect deterministic paths in scenario order.
- `kind=metric`: structured report metrics drifted (wave/cumulative/player-level values).
- `kind=report`: rendered text output drifted while both reports were present.
- `kind=scenario`: scenario set drifted (missing or added scenario IDs).
- CI behavior: drift returns exit code `2`; argument/runtime errors return exit code `1`.

Contributor guardrails for baseline refreshes:
- Baseline artifact updates are opt-in only: use `BASELINE_REFRESH_CONFIRM=true npm run baseline:balance:refresh:guard`.
- The guard requires a clean baseline artifact state before capture and verifies deterministic drift check success after capture.
- If capture produces no artifact change, the guard fails to prevent no-op refresh commits.
- Never refresh artifacts in the same commit as unrelated behavior changes unless the PR explicitly documents why.

### Tuning PR Comparison Checklist

- Re-run deterministic baselines before and after tuning:

```bash
npm run build
npm run baseline:balance:capture
npm run baseline:balance:report
```

- Compare these sections per scenario report:
	- per-wave: `tick`, `DPS proxy`, `Kills by archetype`
	- per-wave: `Damage intake`, `Repairs`, `Economy delta`
	- cumulative: `Waves completed`, cumulative `DPS proxy`, `Kills by archetype`
	- cumulative: `Economy totals`, `Structures`, and final `Players`
- Acceptable drift guidance for deterministic baselines:
	- acceptable: only intended metrics/sections shift and the direction/magnitude match PR intent
	- acceptable: unchanged scenarios remain byte-identical when tuning scope should not affect them
	- unacceptable: changes in untouched metrics without rationale
	- unacceptable: scenario output shape/order changes (`schemaVersion`, snapshot ordering, player ordering, or section ordering)
	- unacceptable: broad multi-section drift caused by a single-parameter tuning change without explicit justification

### Required PR Checklist When Drift Occurs

- Run `npm run baseline:balance:verify:ci` locally and confirm the reported drift paths.
- State whether drift is expected or suspicious in the PR description.
- If expected: include scenario IDs, drift kinds/paths, and intent/magnitude rationale.
- If suspicious: stop artifact updates, investigate simulation/tooling changes, and resolve root cause before merge.
- If refreshing baselines intentionally: run `BASELINE_REFRESH_CONFIRM=true npm run baseline:balance:refresh:guard` and commit only the resulting baseline artifact updates with a short rationale.

Workspace layout:
- `apps/client`
- `apps/server`
- `packages/shared`
- `packages/simulation`
- `packages/transport`
