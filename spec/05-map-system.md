# 05 Map System

## Goals

- Data-driven map format
- Easy authoring and versioning
- Safe validation before match start
- Procedural generation with reproducible seeds

## Map schema

`GameMap` (packages/shared) carries:

- `schemaVersion`: integer, currently 1 (`MAP_SCHEMA_VERSION`)
- `width`, `height`, `seed`
- `cells`: one entry per grid cell with `x`, `y`, `buildable`, `pathWear`
- `spawn`: the monster cave cell on the left edge (x = 0)
- `goal`: the cell where the lane leaves the map on the right edge (x = width - 1); creatures that reach it have exited

Not part of the schema (documented decisions): multiple lanes, per-tower routes, tile sizes, metadata, decorations, modifiers and biomes. Later versions may add them with a `schemaVersion` bump.

## Validation

`validateGameMap(map)` (packages/shared) returns a list of structured errors (`{ code, message }`); an empty list means the map is valid. The match simulation (its constructor, so `createMatch` too) runs it before anything else and throws an error that names the first problem if the map is invalid. Checks:

- `schemaVersion` is supported
- width and height are positive integers and the cell count equals width x height
- every cell is inside the grid and no coordinate appears twice
- the spawn is on the left edge and on a buildable cell
- the goal is on the right edge and on a buildable cell
- the goal can be reached from the spawn over buildable cells

Hand-built `GameMap` objects in tests are not validated unless a test calls `validateGameMap` itself.

## Authoring workflow

- Generate map from seed and generation parameters at match start
- Optionally export generated map snapshot as JSON for debugging
- Validate with shared schema before simulation begins
- Convert to runtime occupancy and navigation structures

## Placement and path checks

- Maintain occupancy grid for towers
- Maintain occupancy grid for walls
- On tower or wall placement, run path viability check from the creature spawn to each live tower
- Reject placement if no valid path remains to all required tower targets
- Per-tower reachability is the placement rule. There are no separate per-tower routes: creatures all walk one shared lane (see Creature route)
- Wall placement additionally keeps a left-to-right route of walkable cells open (a wall may not remove the last one), using the same shared check as tower placement (left-to-right route plus per-tower reachability)

## Creature lane

- Creatures walk over buildable cells only (the walkable layer).
- Procedural generation carves a maze of corridors (buildable cells) with a seeded randomized depth-first search on a coarse grid (one corridor every 4 cells, so walls between corridors are 3 cells thick). A few extra walls are knocked through for loops.
- The cave (left edge, `spawn`) and the goal (right edge, `goal`) are the pair of rooms furthest apart in the maze, so the creature route winds back and forth across the map (at least 3 x width cells for the default map).
- The remaining cells are random buildable noise, but only cells that do not touch a corridor. Noise therefore forms isolated tower pads inside the walls and never opens a shortcut through the maze.
- Towers and walls may be placed on lane cells, but the placement path checks (towers and walls) reject any placement that would cut the last route.
- Rendering follows the same model: buildable cells are the walkable road and non-buildable cells are raised grass pads (see spec/11, Terrain).

## Creature route

- There is one shared lane from the cave to the goal. Creatures walk it and attack whatever is in range while moving (spec/02); they never leave it to chase a tower.
- The route is the shortest walkable path from spawn to goal with all live towers and all walls as obstacles. It does not depend on the order of the tower list.
- The route is computed when a wave starts and recomputed whenever a wall or a tower is destroyed during the wave. (A wall placed during a wave does not trigger a recompute today; it only changes the route from the next recompute, which is a known gap tracked outside this spec.) Creatures already on the lane keep their cell when it is still on the new route; otherwise (for example a destroyed wall opens a shortcut that bypasses it) each moves to the closest cell of the new route by walking distance: a breadth-first search over the same walkable cells as the route (buildable, no live tower or wall), taking the nearest route cell, with ties going to the earlier route cell. The creature's `x`/`y` are set to that cell and its movement progress resets. Straight-line distance is not used, because in the maze it picks cells of a neighbouring corridor.
- Each spawned creature gets a `targetTowerId` from the live towers: round robin by spawn ordinal over the live towers sorted by id (`tower-missing` only when no tower is alive). It is a sticky preference for attack target selection and only counts while that tower is in range, so it never changes the route.
- If a player's tower is destroyed or the first tower is gone, routing and spawning keep working for the remaining towers.

## Generation guarantees

- The spawn and goal are the pair of rooms furthest apart in the maze (see Creature lane); the goal is always reachable from the spawn.
- For every seed there are at least `MIN_TOWER_SITES` (`MAX_PLAYERS` = 8) tower pads: buildable cells outside the cave's protected area that creatures cannot walk to (no buildable path from the cave). A tower on a pad can never cut the lane or another tower's access, so every player can place a tower in any combination, and this is checked by counting pads (`findTowerSites`), not by trying placements. Generation is deterministic per seed and the carved lane does not change because of this guarantee; if the noise leaves too few pads (only on small maps), extra pads are added at the lowest-hash cells that do not touch the lane.

## Path wear

- Every map cell has a `pathWear` value from 0 to `PATH_CELL_MAX_WEAR` (8).
- Wear is added during the wave: each time a creature moves onto a lane cell, that cell gains `PATH_WEAR_PER_TRAVERSAL` (1), clamped to `PATH_CELL_MAX_WEAR`. Wear is tracked per cell, so it does not depend on how the route is computed.
- Wear slows creatures standing on the cell (`CREATURE_MOVEMENT_SPEED_PENALTY_PER_WEAR` per point, never below `MIN_CREATURE_MOVEMENT_SPEED_UNITS`), so busy lanes get slower but never come to a standstill.
- Between waves every cell is repaired by `BETWEEN_WAVE_PATH_WEAR_REPAIR` (3), never below 0. The `path-repaired` event lists each repaired cell with wear before and after.
- Walls and spawn/exit events add no wear of their own.

## Monster cave (spawn)

- Every map has one monster cave on the left edge (x = 0), at the start cell of the carved lane. All creatures spawn there.
- The cave is rendered as a visible cave mouth, and its protected area is shown as a faint warning tint.
- Protected area: every cell within `SPAWN_PROTECTION_RADIUS` (5 cells, Euclidean) of the cave. Towers and walls may not be placed there (reject reason `spawn-protected`).
- Why 5: a level 1 tower has a range of 6, so towers just outside the area (radius 5) reach only about 1 cell into it and barely cover the cave exit, and nobody can wall the cave in or stand next to it and kill monsters the moment they appear.
- Why it is not enough alone: the protected radius only keeps towers away from the cave. Creatures are additionally invulnerable and untargetable for their first 1 second after spawning (see spec/02 and spec/06), so the cave exit cannot be camped even by a tower at the edge of its range.
- The left-to-right route check starts from the cave cell, not from any cell on the left edge.

## Versioning

- Every map has `schemaVersion` (see Map schema)
- Add migration scripts for old versions when schema evolves

## Extensibility

- Optional dynamic events (temporary blocked cells)
- Wave route variance by lane priority
- Biome-specific generation rules and creature affinity
