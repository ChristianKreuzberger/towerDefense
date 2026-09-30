# Implementation Kickoff Plan

Date: 2026-07-28

This plan starts implementation while preserving the project constraints in [AGENTS.md](AGENTS.md) and the specs in [spec](spec/README.md).

## Step 1: Foundation Scaffold (Start Now)

Goal: establish the monorepo structure and baseline tooling so client/server/simulation work can begin in parallel.

Scope:
- Create workspace structure from [spec/04-technical-architecture.md](spec/04-technical-architecture.md):
  - apps/client
  - apps/server
  - packages/shared
  - packages/simulation
  - packages/transport
- Initialize root TypeScript workspace settings and package manager workspaces.
- Add baseline scripts for build, typecheck, lint placeholders, and test placeholders.
- Add strict TS configs to keep deterministic logic safe.
- Keep transport adapter local-only for MVP.

Deliverables:
- Root workspace config files (package manager + TS project refs).
- Package skeletons for each app/package with minimal entry points.
- Basic README notes for how to run typecheck/build.

Acceptance checks:
- Monorepo installs dependencies successfully.
- Workspace typecheck runs without errors.
- No online networking runtime enabled.

## Step 2: Deterministic Simulation Contract Slice

Goal: implement the first vertical contract between shared types and simulation core for match bootstrap.

Scope:
- Define shared domain types/constants for:
  - Match setup (1 to 8 players, names)
  - Mandatory one-tower placement phase
  - Win threshold (1000 points)
- Implement simulation package interfaces:
  - createMatch(setup)
  - applyCommand(command)
  - getSnapshot()
- Add local transport adapter interface and local in-memory implementation.
- Add initial deterministic tests for:
  - setup validation
  - fixed rules (no tower-vs-tower attacks represented in model)
  - win condition threshold constant usage

Deliverables:
- Shared types and validation schema stubs.
- Simulation core skeleton with deterministic state transitions.
- Local transport adapter stub wired to simulation.
- First passing test suite for contract behavior.

Acceptance checks:
- Tests pass deterministically on repeated runs.
- Simulation can create a match and return a stable initial snapshot.
- Rule constraints from [spec/02-gameplay-rules.md](spec/02-gameplay-rules.md) are encoded in types/contracts.

## Immediate Execution Order

1. Execute Step 1 scaffolding in this session. [Done]
2. Validate build/typecheck baseline. [Done]
3. Start Step 2 with shared contracts and deterministic tests. [In progress]
4. Extend Step 2 with deterministic map generation + tower placement validation (buildable cells/overlap). [Done]
5. Add path-safety validation for placements and tests for blocked-path rejection. [Done]
6. Add wall placement command contracts + simulation handling with path-safety enforcement. [Done]
7. Add tower upgrade command contracts + simulation economy handling. [Done]
8. Add tower target-mode command contracts + simulation state handling. [Done]
9. Add ready-for-wave command contracts + simulation readiness state handling. [Done]
10. Add deterministic wave lifecycle scaffolding (wave-start/wave-end events and empty creature tick loop). [Done]
11. Implement deterministic creature spawn schedule and non-damaging movement tick within wave phase. [Done]
12. Add deterministic tower-to-creature targeting selection pass (no damage yet), producing reproducible target assignment snapshots/events each wave tick. [Done]
13. Apply deterministic combat resolution pass (consume target assignments, resolve tower damage to creatures, emit hit/defeat events, award points). [Done]
14. Implement creature attack resolution against towers (deterministic target tower selection, tower damage events, tower destruction handling, and fail-state checks). [Done]
15. Implement between-wave automatic tower repair phase with deterministic repair events and tests. [Done]
16. Implement deterministic wall/path auto-repair phase between waves with clear repair events and tests. [Done]
17. Implement deterministic wall-destruction lifecycle (creature wall targeting, wall damage/destruction events, and path revalidation after destruction). [Done]
18. Implement deterministic per-cell movement speed modifiers from path wear and emit movement-resolution events for balance analysis. [Done]
19. Add deterministic combat telemetry aggregation snapshots (per-wave DPS, kills by archetype, wall/tower damage intake) for balancing workflows. [Done]
20. Add deterministic balance-analysis snapshot exports for offline tooling (simulation-side only). [Done]
21. Add offline CLI/report utility that consumes exported balance-analysis snapshots and emits comparable tuning reports. [Done]
22. Document balance-analysis workflow in repository docs with sample fixture/report commands and tuning interpretation notes. [Done]
23. Capture first deterministic baseline report artifacts for a small fixed-seed scenario set and add a comparison checklist for future tuning PRs. [Done]
24. Add deterministic baseline-diff utility (JSON + text) that flags scenario-level metric drift for CI and tuning PR review. [Done]
25. Add deterministic CI-friendly baseline refresh guard that requires explicit opt-in for artifact updates and validates clean artifact state before/after capture. [Done]
26. Improve local playable host UX (port fallback startup, keyboard shortcuts, readiness summary) to reduce friction for manual game sessions. [Done]
27. Add match-flow clarity UI in local host (phase banner, player status cards, end-of-match overlay + restart control, shortcut hint bar). [Done]
28. Extract host UI into `apps/client` browser app served by Vite while retaining current server APIs and deterministic simulation behavior. [Done]
29. Add lightweight game-state polling cadence and action feedback queue in client for smoother wave observation and clearer rejected-command handling. [Done]
30. Add deterministic CI artifact upload/retention for baseline diff JSON + summary text to make PR drift triage faster without reruns. [Done]
31. Migrate the client battlefield renderer from DOM/CSS grid cells to Phaser 3 (WebGL) per [spec/04-technical-architecture.md](spec/04-technical-architecture.md) presentation layer migration plan; keep menu/HUD as DOM, keep simulation/server contracts untouched, update e2e board selectors. [Done]
32. Add the wave-clear bonus economy income source from [spec/06-economy-balance.md](spec/06-economy-balance.md): surviving players with a living tower earn a deterministic bonus when a wave completes with zero leaks. Includes telemetry counter, balance-export fields, report render lines, client feedback, tests, and regenerated baseline artifacts. [Done]

## Non-Goals For This Kickoff

- No online transport implementation.
- No final UI polish.
- No balance tuning beyond constants required for contracts.
