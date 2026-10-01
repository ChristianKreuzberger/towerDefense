# 02 Gameplay Rules

## Match loop

1. Menu setup: choose number of human players (1 to 8), enter each player name, show disabled AI player option
2. Procedural map generation and pre-round placement phase
3. Mandatory placement: each player places exactly one tower
4. Wave combat phase
5. Reward and short prep phase with automatic tower repairs
6. Repeat until a player reaches 1000 points

- Wave start: only non-eliminated players need to place a tower and ready up; eliminated players never block the next wave

## Shared objectives

- Keep all player towers alive
- Optimize tower upgrades and wall placement
- Score points efficiently by killing creatures

## Tower placement rules

- Towers can only be placed on buildable cells
- Placement cannot overlap existing towers
- Towers and walls cannot be placed within 5 cells of the monster cave where creatures spawn (see spec/05)
- Placement cannot make all enemy paths invalid
- Placement must not cut off any live tower that creatures could reach before it (same per-tower rule as wall placement)
- Each player places one tower at match start
- Once placed, a tower cannot be moved or sold

## Tower lifecycle

- Upgrades come in three independent tracks, each starting at level 1 and going up to `MAX_TOWER_LEVEL` = 5: **range**, **damage** (damage per shot) and **accuracy** (chance that a shot hits). A player chooses which track to buy, so a trailing player can specialise (for example a long-range tower placed elsewhere) instead of only buying generic levels. Upgrades are bought only during the prep (placement) phase and only while that player has not readied. They are rejected once the player is ready and during the wave. An upgrade on a track that is already at max level is rejected with `tower-max-level` and costs nothing; an unknown track is rejected with `invalid-upgrade-track`
- Cannot shoot other towers under any condition
- Can shoot invading creatures based on tower range and targeting rules
- Range is limited and measured in grid cells (Euclidean distance, inclusive); a creature exactly at range distance can be targeted
- Base range is 6 cells (range level 1) and grows by 1.5 cells per range level
- A tower fires at most once per tick. Whether the shot hits is decided deterministically from the match seed, wave, tick and tower id (no hidden randomness), against the tower's accuracy: 70% at accuracy level 1, +7.5 percentage points per level, 100% at level 5. A miss deals no damage and emits a `tower-miss` event
- Damage per shot is 1 at damage level 1 and +1 per damage level
- A tower with no creature in range has no target and does not fire
- Takes damage from creature attacks
- A destroyed tower is removed from play but leaves ruins on its cell (`ruins` in the snapshot: tower id, owner, cell, wave and tick of destruction). Ruins are cosmetic: they never block creatures, and the player stays eliminated
- Auto-repaired between rounds (must be clearly shown in UI)

## Walls

- Players can spend points to place walls
- Walls block creature movement and alter pathing
- Wall placement must preserve at least one valid path to each live tower
- Walls are persistent once placed for MVP

## Enemy model

- Creatures path toward towers and attempt to attack them. They keep walking the lane and only damage a tower or wall that is within their attack range; with nothing in range they have no target and just keep moving
- Attack range: a short per-archetype distance in grid cells (see spec/06). It is Euclidean, measured from the creature's current cell to the tower or wall cell, and inclusive (a target exactly at range can be hit)
- Creatures cannot move through walls
- Archetypes: runner, tank, armored, swarm
- Spawn protection: a creature is untargetable and takes no damage for its first 1 second (`CREATURE_SPAWN_PROTECTION_SECONDS`, 5 simulation ticks at the client's 5 ticks per second) after it appears at the monster cave. It still moves and can attack normally; towers just skip it until the protection ends
- Later archetypes can include shield or split-on-death

## Damage and targeting

- Targeting modes: first, last, strongest, nearest
- Target mode can be changed by its owner during prep (placement phase, also after readying) and during the wave; it is rejected only when the match has ended, the player is eliminated, or the tower is not the player's own. Rejections use their own reasons (`invalid-target-mode-target`, `invalid-target-mode`), never a wall reason
- Damage types: physical, explosive, magic
- Resistances and vulnerabilities encoded in data
- Friendly fire is disabled between towers

## Scoring and economy

- Killing a creature gives points to the responsible player (or shared split if configured)
- Points are spent on tower upgrades and wall placement
- Upgrade and wall costs scale over time to preserve challenge

## Win and lose conditions

- Win: first player to reach 1000 points
- Team fail state: all towers destroyed before any player reaches 1000 points

## Co-op interaction

- Each player controls own build cursor
- Each player has a visible name in HUD and score board
- Ping and quick signals for team communication
