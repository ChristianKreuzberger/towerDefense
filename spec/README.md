# Tower Defense Project Spec

This folder contains planning documents for a multiplayer browser tower-defense game.

## Recommended read order

1. 01-product-vision.md
2. 02-gameplay-rules.md
3. 03-multiplayer-networking.md
4. 04-technical-architecture.md
5. 05-map-system.md
6. 06-economy-balance.md
7. 07-backend-api-events.md
8. 08-data-persistence.md
9. 09-testing-quality.md
10. 10-delivery-roadmap.md
11. 11-match-flow-ui.md

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
- Wall placement limits and anti-grief constraints
- Procedural generation seed controls and biome themes
