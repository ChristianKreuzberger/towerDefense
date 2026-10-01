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
- Wall placement additionally keeps a left-to-right route of walkable cells open (a wall may not remove the last one), using the same shared check as tower placement (left-to-right route plus per-tower reachability)

## Creature lane

- Creatures walk over buildable cells only (the walkable layer).
- Procedural generation carves a maze of corridors (buildable cells) with a seeded randomized depth-first search on a coarse grid (one corridor every 4 cells, so walls between corridors are 3 cells thick). A few extra walls are knocked through for loops.
- The cave (left edge) and the goal (right edge) are the pair of rooms furthest apart in the maze, so the creature route winds back and forth across the map (at least 3 x width cells for the default map).
- The remaining cells are random buildable noise, but only cells that do not touch a corridor. Noise therefore forms isolated tower pads inside the walls and never opens a shortcut through the maze.
- Towers and walls may be placed on lane cells, but the placement path checks (towers and walls) reject any placement that would cut the last route.
- Rendering follows the same model: buildable cells are the walkable road and non-buildable cells are raised grass pads (see spec/11, Terrain).

## Monster cave (spawn)

- Every map has one monster cave on the left edge (x = 0), at the start cell of the carved lane. All creatures spawn there.
- The cave is rendered as a visible cave mouth, and its protected area is shown as a faint warning tint.
- Protected area: every cell within `SPAWN_PROTECTION_RADIUS` (5 cells, Euclidean) of the cave. Towers and walls may not be placed there (reject reason `spawn-protected`).
- Why 5: a level 1 tower has a range of 6, so towers just outside the area (radius 5) reach only about 1 cell into it and barely cover the cave exit, and nobody can wall the cave in or stand next to it and kill monsters the moment they appear.
- Why it is not enough alone: the protected radius only keeps towers away from the cave. Creatures are additionally invulnerable and untargetable for their first 1 second after spawning (see spec/02 and spec/06), so the cave exit cannot be camped even by a tower at the edge of its range.
- The left-to-right route check starts from the cave cell, not from any cell on the left edge.

## Versioning

- Include schemaVersion in map file
- Add migration scripts for old versions when schema evolves

## Extensibility

- Optional dynamic events (temporary blocked cells)
- Wave route variance by lane priority
- Biome-specific generation rules and creature affinity
