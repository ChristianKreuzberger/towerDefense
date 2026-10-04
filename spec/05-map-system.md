# 05 Map System

## Goals

- Data-driven map format
- Easy authoring and versioning
- Safe validation before match start
- Procedural generation with reproducible seeds

## Map schema

`GameMap` (packages/shared) carries:

- `schemaVersion`: integer, currently 2 (`MAP_SCHEMA_VERSION`)
- `width`, `height`, `seed`
- `cells`: one entry per grid cell with `x`, `y`, `buildable`, `pathWear`. `buildable` is the walkable layer (the road): creatures walk on these cells. It does not mean towers may be built there
- `towerSpots`: the only cells where towers may be placed, a list of `{ x, y }`. Spots are non-walkable cells (see Tower spots)
- `spawn`: the monster cave cell on the left edge (x = 0)
- `goal`: the cell where the lane leaves the map on the right edge (x = width - 1); creatures that reach it have exited

Not part of the schema (documented decisions): multiple lanes, per-tower routes, tile sizes, metadata, decorations, modifiers and biomes. Later versions may add them with a `schemaVersion` bump.

## Validation

`validateGameMap(map)` (packages/shared) returns a list of structured errors (`{ code, message }`); an empty list means the map is valid. The match simulation (its constructor, so `createMatch` too) runs it before anything else and throws an error that names the first problem if the map is invalid. Checks:

- `schemaVersion` is supported
- width and height are positive integers and the cell count equals width x height
- `cells` is an array; every cell sits on a whole-number position inside the grid and no coordinate appears twice
- every cell has a boolean `buildable` and a finite `pathWear` from 0 to the maximum wear (`invalid-cell` otherwise)
- the spawn is on the left edge and on a buildable cell
- the goal is on the right edge and on a buildable cell
- `towerSpots` is an array (`missing-tower-spots`); every spot is inside the grid (`out-of-bounds`), listed once (`duplicate-tower-spot`), not on a road cell (`tower-spot-on-lane`) and outside the cave's protected area (`tower-spot-in-spawn-protection`)
- there are at least `MIN_TOWER_SITES` spots (`too-few-tower-spots`)
- the goal can be reached from the spawn over buildable cells

Hand-built `GameMap` objects in tests are not validated unless a test calls `validateGameMap` itself.

## Authoring workflow

- Generate map from seed and generation parameters at match start
- Optionally export generated map snapshot as JSON for debugging
- Validate with shared schema before simulation begins
- Convert to runtime occupancy and navigation structures

## Placement and path checks

- Maintain occupancy grid for towers
- On tower placement, run path viability check from the creature spawn to each live tower
- Reject placement if no valid path remains to all required tower targets
- Per-tower reachability is the placement rule. There are no separate per-tower routes: creatures all walk one shared lane (see Creature route)
- Tower placement also keeps a left-to-right route of walkable cells open (a tower may not remove the last one), using the same shared check (left-to-right route plus per-tower reachability)

## Creature lane

- Creatures walk over buildable cells only (the walkable layer).
- Procedural generation carves a maze of corridors (buildable cells) with a seeded randomized depth-first search on a coarse grid (one corridor every 6 cells; each corridor is `PATH_WIDTH` = 2 cells wide, so walls between corridors are 4 cells thick). The maze is only used to find the route: just the rooms on the route between cave and goal are carved, plus at most `MAZE_MAX_BRANCHES` (2) short side branches of at most `MAZE_BRANCH_MAX_LENGTH` (2) rooms each, so the map has few dead ends. There are no loops (every carved room is reached by exactly one corridor path).
- The cave (left edge, `spawn`) and the goal (right edge, `goal`) are the pair of rooms furthest apart in the maze (picked before anything is carved), so the creature route winds back and forth across the map (a 50x50 map gives routes of about 1.2 to 6.4 x width cells over 300 seeds, never shorter than the width).
- The remaining cells are not walkable. Tower spots are picked among them (see Tower spots).
- Wider road: the road is `PATH_WIDTH` (2) cells wide everywhere, so two creatures can walk side by side or overtake. Each creature gets a lane (0 or 1), alternating by spawn order, which only shifts where it is drawn across the road (see Creature route). The simulation still follows one shared route and creatures never block each other.
- Rendering follows the same model: buildable cells are the walkable road and non-buildable cells are raised grass (see spec/11, Terrain).

## Tower spots

- Spots may touch the road: creatures only attack towers within about 1 cell, so some spots must be within reach of passing creatures for tower damage, repair and ruins to matter.
- Towers can only be placed on `towerSpots`. Clicking the road or any other cell is rejected with `not-tower-spot`.
- Generation picks up to `TOWER_SPOT_TOTAL` (32) spots: the base `TOWER_SPOT_COUNT` (16) first, then up to `TOWER_SPOT_EXTRA_COUNT` (16) extras appended after them. They are picked among non-walkable cells that: lie outside the cave's protected area, are within `TOWER_SPOT_MAX_LANE_DISTANCE` (4) cells of the route creatures walk (the shortest route from the cave), and keep at least `TOWER_SPOT_MIN_SPACING` (3) cells (Chebyshev) from each other.
- Spots are spread along the route: its cells are split into `TOWER_SPOT_COUNT` equal segments and the best-hash candidate of each segment is chosen; every other segment prefers a spot within 1.5 cells of the route (the longest creature attack range), so some towers can be hurt. Fallback is global hash order. On small maps (for example 20x20) spacing and then the distance cap are relaxed so there are still at least `MIN_TOWER_SITES` spots.
- Every spot has at least 6 route cells within the base tower range (6): candidates below that are dropped, so it holds on every seed (verified over 300 default seeds), so no spot is useless. Spots are deterministic per seed.
- Extras are a second pass over the same candidates (same route-distance and coverage rules, same spacing, no spot closer than the spacing to any earlier spot, best hash first, preferring route segments with the fewest spots). The base spots keep their positions and list order exactly as before, so seeded picks (easy bot) and balance baselines are unaffected; extras are listed after them, sorted by row then column. Spacing is never relaxed for extras: crowded seeds simply get fewer (measured over 300 default seeds: 275 get all 32, the lowest is 22). On small maps (for example 20x20) the extras are fewer or none, and `MIN_TOWER_SITES` is still guaranteed.
- Spots are never walkable, so a tower can never cut the road and the path checks in Placement still pass; they stay as a safety net.

## Creature route

- There is one shared lane from the cave to the goal. Creatures walk it and attack whatever is in range while moving (spec/02); they never leave it to chase a tower.
- The route is the shortest walkable path from spawn to goal with all live towers as obstacles. It does not depend on the order of the tower list.
- The route is computed when a wave starts and recomputed whenever a tower is destroyed during the wave. Creatures already on the lane keep their cell when it is still on the new route; otherwise (for example a destroyed tower opens a shortcut that bypasses it) each moves to the closest cell of the new route by walking distance: a breadth-first search over the same walkable cells as the route (buildable, no live tower), taking the nearest route cell, with ties going to the earlier route cell. The creature's `x`/`y` are set to that cell and its movement progress resets. Straight-line distance is not used, because in the maze it picks cells of a neighbouring corridor.
- Each spawned creature also gets a `lane` of 0 or 1: `(spawnOrdinal - 1) % PATH_WIDTH`. The lane is a presentation offset across the road width (about 0.25 cell either side, client only). Movement, range and targeting use the shared route cell, and creatures with different `pathProgressUnits` overtake each other freely.
- Each spawned creature gets a `targetTowerId` from the live towers: round robin by spawn ordinal over the live towers sorted by id (`tower-missing` only when no tower is alive). It is a sticky preference for attack target selection and only counts while that tower is in range, so it never changes the route.
- If a player's tower is destroyed or the first tower is gone, routing and spawning keep working for the remaining towers.

## Generation guarantees

- The spawn and goal are the pair of rooms furthest apart in the maze (see Creature lane); the goal is always reachable from the spawn.
- For every seed there are at least `MIN_TOWER_SITES` (`MAX_PLAYERS` = 8) tower spots (see Tower spots), checked by `validateGameMap` (`too-few-tower-spots`). A tower on a spot can never cut the road or another tower's access, so every player can place a tower in any combination. Generation is deterministic per seed.

## Path wear

- Every map cell has a `pathWear` value from 0 to `PATH_CELL_MAX_WEAR` (8).
- Wear is added during the wave: each time a creature moves onto a lane cell, that cell gains `PATH_WEAR_PER_TRAVERSAL` (1), clamped to `PATH_CELL_MAX_WEAR`. Wear is tracked per cell, so it does not depend on how the route is computed.
- Wear slows creatures standing on the cell (`CREATURE_MOVEMENT_SPEED_PENALTY_PER_WEAR` per point, never below `MIN_CREATURE_MOVEMENT_SPEED_UNITS`), so busy lanes get slower but never come to a standstill.
- Between waves every cell is repaired by `BETWEEN_WAVE_PATH_WEAR_REPAIR` (3), never below 0. The `path-repaired` event lists each repaired cell with wear before and after.
- Spawn/exit events add no wear of their own.

## Monster cave (spawn)

- Every map has one monster cave on the left edge (x = 0), at the start cell of the carved lane. All creatures spawn there.
- The cave is rendered as a visible cave mouth, and its protected area is shown as a faint warning tint.
- Protected area: every cell within `SPAWN_PROTECTION_RADIUS` (5 cells, Euclidean) of the cave. No tower spot lies there, and placement would be rejected (reject reason `spawn-protected`).
- Why 5: a level 1 tower has a range of 6, so towers just outside the area (radius 5) reach only about 1 cell into it and barely cover the cave exit, and nobody can stand next to it and kill monsters the moment they appear.
- Creatures are shielded too: a creature inside the protected area is invulnerable and untargetable until it walks out of it (see spec/02 and spec/06), so the cave exit cannot be camped even by a tower at the edge of its range.
- The left-to-right route check starts from the cave cell, not from any cell on the left edge.

## Versioning

- Every map has `schemaVersion` (see Map schema)
- Add migration scripts for old versions when schema evolves

## Extensibility

- Optional dynamic events (temporary blocked cells)
- Wave route variance by lane priority
- Biome-specific generation rules and creature affinity
