# Tower Defense Project Spec

This folder contains planning documents for a multiplayer browser tower-defense game.

## Recommended read order

1. 01-product-vision.md
   - answers: why the game exists, audience, MVP modes and non-goals
2. 02-gameplay-rules.md
   - answers: match loop, tower placement and lifecycle, enemies, damage and targeting, scoring, win conditions
3. 03-multiplayer-networking.md
   - answers: client/server model, tick and sync, commands and validation, reconnect (online plan, not MVP)
4. 04-technical-architecture.md
   - answers: repo structure, runtime boundaries, client modules, build tools, performance and Phaser rules
5. 05-map-system.md
   - answers: map schema, validation, creature lane and route, generation guarantees, path wear, spawn cave
6. 06-economy-balance.md
   - answers: point economy, income and spend, balance principles, anti-snowball controls
7. 07-backend-api-events.md
   - answers: local host HTTP API, lite snapshots, command and event contracts, errors, versioning
8. 08-data-persistence.md
   - answers: what is persisted (little at MVP), tables, IDs, offline-to-online migration
9. 09-testing-quality.md
   - answers: test pyramid, key test cases, audio/settings checks, CI quality gates
10. 10-delivery-roadmap.md
   - answers: phased delivery plan and post-MVP candidates
11. 11-match-flow-ui.md
   - answers: menu and match flow, HUD, playback, visuals, audio, guidance overlay, debug, endgame UX

## Scope

- Plan first, implement second
- Offline local multiplayer first (single device/session)
- Future online patchability designed in from day one
- Browser-first experience
- Extensible map and wave system
- Procedurally generated maps

## Open decisions to finalize before implementation

- Shared point pool vs per-player point economy
- Round structure length and creature scaling curve
- Procedural generation seed controls and biome themes
