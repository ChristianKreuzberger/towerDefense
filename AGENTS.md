# AGENTS

## Project Purpose

This repository is for a browser-based tower-defense game designed as offline local multiplayer first, with online mode planned for a later phase.

Core concept:
- 1 to 8 human players in one match
- Each player places one tower at match start
- Towers defend against invading creatures
- Players earn points from creature kills and spend points on upgrades and walls
- First player to 1000 points wins

## Current Status

Planning phase only. Specs are defined before implementation.

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
3. Preserve game constraints from specs (for example fixed tower placement, wall/path rules, and 1000-point win condition).
4. When changing behavior, update the relevant spec file first, then code.
5. Keep architecture transport-agnostic so online mode can be added later.
6. Add or update tests for simulation rules and deterministic outcomes.

## Suggested Development Order (When Implementation Starts)

1. Foundation: monorepo structure, shared types, simulation core interfaces
2. Core gameplay: menu, player setup, tower placement, creatures, scoring
3. Systems: upgrades, walls, pathfinding validation, round auto-repair
4. Quality: tests, balancing passes, performance checks for 8 players
5. Future patch: online transport adapter and room synchronization

## Notes

- AI player option should exist in UI but stay disabled for MVP.
- Procedural maps are required from the start.
- Towers must never target other towers.
