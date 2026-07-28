# 10 Delivery Roadmap

## Phase 0: Foundation (Week 1)

- Initialize monorepo and shared package
- Set up client render loop and local simulation host
- Add protocol skeleton and schema validation
- Build transport adapter interface (local implementation only)

Exit criteria:
- Local game session starts from menu and receives simulation snapshots

## Phase 1: Core gameplay vertical slice (Weeks 2 to 3)

- Procedural map generation
- Enemy spawning and tower HP combat
- 1 to 8 player setup with names and mandatory initial tower placement
- Point economy, tower upgrades, and wall placement

Exit criteria:
- Four players can complete a match loop and score points correctly

## Phase 2: Offline multiplayer hardening (Weeks 4 to 5)

- 8-player balancing and performance passes
- End-of-round auto-repair UI and messaging
- Deterministic scoring and win-at-1000 validation

Exit criteria:
- Eight-player local match runs at target tick budget

## Phase 3: Content and polish (Weeks 6 to 7)

- Additional enemy archetypes and tower variety
- HUD clarity and game feedback effects
- Audio and visual readability improvements

Exit criteria:
- Playtest feedback confirms clarity and fun in 20-minute session

## Phase 4: MVP release prep (Week 8)

- CI stability and regression pass
- Offline build packaging and QA checklist
- Basic telemetry/log capture for local diagnostics

Exit criteria:
- Release candidate with known issues documented

## Post-MVP candidates

- Online mode via transport adapter implementation
- Ranked/co-op progression
- Public map sharing pipeline
- Spectator mode and match replay
