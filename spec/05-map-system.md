# 05 Map System

## Goals

- Data-driven map format
- Easy authoring and versioning
- Safe validation before match start
- Procedural generation with reproducible seeds

## Suggested map schema

- metadata: id, name, version, author
- grid: width, height, tileSize
- tiles: buildable, blocked, path, spawn, goal
- lanes: optional multiple lane definitions
- decorations: non-colliding visuals
- modifiers: map-specific rule overrides
- generation: seed, biome, difficultyProfile

## Authoring workflow

- Generate map from seed and generation parameters at match start
- Optionally export generated map snapshot as JSON for debugging
- Validate with shared schema before simulation begins
- Convert to runtime occupancy and navigation structures

## Placement and path checks

- Maintain occupancy grid for towers
- Maintain occupancy grid for walls
- On tower or wall placement, run path viability check from creature spawns to each live tower
- Reject placement if no valid path remains to all required tower targets

## Creature lane

- Creatures walk over buildable cells only (the walkable layer).
- Procedural generation guarantees one connected lane of buildable cells from the left edge (x = 0) to the right edge (x = width - 1), carved deterministically from the seed. The remaining cells are random buildable noise.
- Every generated map therefore has a spawn-to-goal route of at least `width` cells, so creatures visibly cross the map and walls and path wear matter.
- Towers and walls may be placed on lane cells, but the placement path checks reject any placement that would cut the last route.

## Versioning

- Include schemaVersion in map file
- Add migration scripts for old versions when schema evolves

## Extensibility

- Optional dynamic events (temporary blocked cells)
- Wave route variance by lane priority
- Biome-specific generation rules and creature affinity
