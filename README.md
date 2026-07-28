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

Implementation has started with a monorepo foundation scaffold.
Current focus: strict TypeScript workspace setup and deterministic simulation contracts.

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

Run workspace build:

```bash
npm run build
```

Workspace layout:
- `apps/client`
- `apps/server`
- `packages/shared`
- `packages/simulation`
- `packages/transport`
