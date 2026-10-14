# 02 Gameplay Rules

## Match loop

1. Menu setup: choose number of human players (0 to 8) and AI players (0 to 8) with 1 to 8 players in total, enter each human player name, pick a difficulty (easy, medium, hard) for each AI player
2. Procedural map generation and pre-round placement phase
3. Mandatory placement: each player places exactly one tower
4. Wave combat phase
5. Reward and short prep phase with automatic tower repairs
6. Repeat until a player reaches 1000 points

- Wave start: only non-eliminated players need to place a tower and ready up; eliminated players never block the next wave

## AI players (bots)

- A bot is a normal player (id `p{n}`, name "Bot N", not editable) with a difficulty. It uses the same commands as a human (place-tower, upgrade-tower, set-damage-type, set-target-mode, move-tower, ready-for-wave), so every rule and rejection applies to it. It reads only the snapshot a human sees
- Bots act in prep only. They place their tower after all human players have placed theirs (immediately when there are no humans), then spend points, pick a damage type and target mode, and ready up. Bots can win at 1000 points like anyone else
- Decisions are a pure function of the snapshot and the match seed (no `Math.random`, no `Date`), so the same setup gives the same match. The pause between bot actions is pacing done by the client and never changes outcomes
- Easy: seeded random valid tower spot, seeded random tower type (uniform over arrow, cannon, frost), buys a seeded random affordable track and sometimes saves instead, keeps physical damage and target `first`
- Medium: places by lane coverage, buys accuracy, then damage, then range whenever affordable, picks the damage type that is strongest against the next wave. Tower type: `arrow`, except a seeded roll below 0.3 picks `cannon`
- Hard: like medium, but weighs tower danger and the upgrade with the best expected damage per point, matches damage type to the whole next wave, switches target mode (strongest against tanks and against waves with a juggernaut), and uses the free tower move when a clearly better spot exists. Tower type: `cannon` when swarms plus splitters are at least 40% of the creatures in the next 5 waves (counting from the wave being prepared, and a splitter counts as itself plus its 2 swarm children; at the start of a match this is 39%, so the opening pick is frost or arrow, and a placement in wave 4 or later sees 51% and picks cannon), otherwise `frost` when the chosen spot has at least 1.3x the lane coverage of the best other spot (a long lane stretch in range), otherwise `arrow`. Hard does not score spots for splash
- Bots choose a tower type only when they place (types are fixed afterwards). The new seeded rolls use their own salts, so existing bot choices for arrow towers do not change
- A match with zero humans runs on its own: no placement prompt, the player only watches

## Shared objectives

- Keep all player towers alive
- Optimize tower upgrades
- Score points efficiently by killing creatures

## Tower placement rules

- Towers can only be placed on the map's tower spots (spec/05), never on the road creatures walk; other cells are rejected with `not-tower-spot`
- Placement cannot overlap existing towers
- Towers cannot be placed within 5 cells of the monster cave where creatures spawn (see spec/05)
- Placement cannot make all enemy paths invalid
- Placement must not cut off any live tower that creatures could reach before it
- Each player places one tower at match start
- Every player starts with `STARTING_POINTS` = 100 (spec/06), which can be spent on upgrades in the opening prep, so a player who places later (and gets a worse spot) can offset it with range, damage or accuracy
- Once placed, a tower cannot be sold. It cannot be moved either, with one exception: after the first 5 completed rounds (`TOWER_MOVE_AFTER_WAVES` = 5, so from the prep before wave 6) every player has one free move for their tower (a reward, not an upgrade track). The move follows the placement rules (a tower spot, outside the cave's protected area, no overlap with other towers, no blocked route), keeps the tower's level, upgrades, target mode and health, and like upgrades it is only possible during prep before the player is ready. Using it spends the token; a second move is rejected (`tower-move-used`), and before round 5 is done it is rejected with `tower-move-locked`

## Tower lifecycle

- Upgrades come in three independent tracks, each starting at level 1 and going up to `MAX_TOWER_LEVEL` = 5: **range**, **damage** (damage per shot) and **accuracy** (chance that a shot hits). A player chooses which track to buy, so a trailing player can specialise (for example a long-range tower placed elsewhere) instead of only buying generic levels. Upgrades are bought only during the prep (placement) phase and only while that player has not readied. They are rejected once the player is ready and during the wave. An upgrade on a track that is already at max level is rejected with `tower-max-level` and costs nothing; an unknown track is rejected with `invalid-upgrade-track`
- Cannot shoot other towers under any condition
- Can shoot invading creatures based on tower range and targeting rules
- Range is limited and measured in grid cells (Euclidean distance, inclusive); a creature exactly at range distance can be targeted
- Tower types (Phase 3, `TOWER_TYPES` in `packages/shared/src/tower-types.ts`): `arrow`, `cannon`, `frost`. The owner picks one in `place-tower` (`towerType`, default `arrow`). It is fixed for the life of the tower (no selling) and kept by `move-tower`. All types use the same tower spots, the same three upgrade tracks, `MAX_TOWER_LEVEL` and upgrade costs, and 175 HP. Placing costs nothing. The upgrade formulas below are for `arrow`; the other types change base values and add one effect each:

| Type | Base range | Base accuracy | Fires | Damage per shot | Effect |
|------|-----------|---------------|-------|-----------------|--------|
| arrow (default) | 6 | 0.70 | every tick | damage level | none |
| cannon | 5 | 0.60 | every 2nd tick (`waveTick % 2 === 0`) | 2 x damage level | splash |
| frost | 6 | 0.80 | every tick | max(1, round(0.5 x damage level)) | slow |

  Accuracy per level (+0.075, cap 1.0) and range per level (+1.5) are the same for every type
- Cannon splash: after the main hit, every other creature within 1.5 cells of the target takes max(1, round(main damage x 0.5)), with its own archetype multiplier applied first. Splash never includes towers, skips creatures inside spawn protection, can kill (the points go to the cannon's owner), and needs no extra accuracy roll (the one roll covers the shot). Victims are processed in creature id order
- Frost slow: a hit slows the creature to 60% speed for 2 + damage level ticks. A new hit refreshes the duration and never stacks. The factor multiplies movement speed units after path wear and the floor, with a minimum of 20 units
- Base range is 6 cells for `arrow` (range level 1) and grows by 1.5 cells per range level
- A tower fires at most once per tick (cannon: at most once per 2 ticks; a skipped tick makes no roll). Whether the shot hits is decided deterministically from the match seed, wave, tick and tower id (no hidden randomness), against the tower's accuracy: 70% at accuracy level 1, +7.5 percentage points per level, 100% at level 5. A miss deals no damage and emits a `tower-miss` event
- Damage per shot is 1 at damage level 1 and +1 per damage level
- A tower with no creature in range has no target and does not fire
- Starts with 175 HP (raised from 100 when waves grew to 1.5x size, see spec/06) and takes damage from creature attacks
- Auto-repaired between rounds (must be clearly shown in UI)

## Enemy model

- All creatures walk one shared lane (spec/05, Creature route). The route treats every live tower as an obstacle and is recomputed when one is destroyed; it never depends on which tower is first in the list. Each creature is assigned a live tower as its preferred target (round robin by spawn order), but it only attacks towers that are in reach.
- The road is 2 cells wide, so creatures can walk side by side and overtake each other; each creature is drawn in lane 0 or 1 of the road, alternating by spawn order, which has no effect on movement or targeting (spec/05)
- Creatures attempt to attack towers. They keep walking the lane and damage every tower within their attack range (reach) each tick; with nothing in reach they have no target and just keep moving
- Attack range (reach): a per-archetype distance in grid cells (see spec/06). It is Euclidean, measured from the creature's current cell to the tower cell, and inclusive (a target exactly at range can be hit)
- Closer is stronger: the damage of each hit is the archetype's base attack damage times a distance band multiplier (x3 within 1.5 cells, x2 within 2.5, x1 within 3.5), scaled by 1.2 and rounded (see spec/06). Each tower in reach is hit with the band for its own distance, so clustered towers all take damage. The worst single hit is a tank next to a tower: round(3 x 3 x 1.2) = 11 HP
- Hits are resolved in a fixed order (creatures by id, then towers by id) and one `creature-attack` event is emitted per creature and tower hit. The `creature-targets-selected` event still reports one primary target per creature: its preferred tower while that is in reach, otherwise the nearest tower in reach (ties: lower health, then id). It is informational only; damage does not depend on it
- Archetypes: runner, tank, armored, swarm, splitter, juggernaut (the last two arrive in Phase 3)
- Wave size and composition are fixed and public: wave N has ceil(1.5 x (N + 2)) creatures (wave 1 = 5, wave 2 = 6, wave 4 = 9; boss waves add one, see below), spawned one every 2 ticks, cycling runner, swarm, armored, tank in that order (so wave 1 is two runners, a swarm, an armored and a tank). The same rule gives the composition shown in the next-wave preview. The snapshot carries `creaturesToSpawn`, the number of creatures of the current wave that have not spawned yet
- Phase 3 wave rules (still a pure function of the wave number; waves 1 to 3 are unchanged): from `WAVE_SPLITTER_FROM_WAVE` = 4, every 5th creature of the wave (ordinals 5, 10, 15, ...) is a splitter instead of the cycle's creature. When the wave number is a multiple of `BOSS_WAVE_INTERVAL` = 5 (waves 5, 10, 15, ...), one juggernaut is appended after the last normal creature, so the count is the normal count + 1. The spawn interval stays 2 ticks
- Splitter: when it is killed it spawns 2 swarm creatures at its exact path position (same `pathIndex` and progress, lanes 0 and 1). Children get ids `<parentId>-s1` and `<parentId>-s2`, `spawnTick` = the current tick, and the parent's preferred tower. They do not count toward the wave's spawn count (`creaturesToSpawn` is unaffected), but the wave is not complete until they are dead. Rewards are paid for the splitter and for each swarm; the swarm income cap still applies to the children's kills. A splitter that leaves the map alive splits nothing. Children are added after the combat loop of that tick and sorted by id, so no existing step is reordered
- Juggernaut (boss): moves at normal speed, hits hard at close range through the normal proximity bands
- Spawn protection: a creature is untargetable and takes no damage while it is inside the protected area around the monster cave (every cell within `SPAWN_PROTECTION_RADIUS`, 5 cells Euclidean, of the cave; see spec/05). The rule is by location, not by age: it ends the moment the creature walks outside the area. It still moves and can attack normally; towers just skip it while it is inside
- Later archetypes can include shield (split-on-death is the splitter)

## Damage and targeting

- Targeting modes: first, last, strongest, nearest
- Target mode can be changed by its owner during prep (placement phase, also after readying) and during the wave; it is rejected only when the match has ended, the player is eliminated, or the tower is not the player's own. Rejections use their own reasons (`invalid-target-mode-target`, `invalid-target-mode`), never a placement reason
- Damage types: `physical`, `explosive`, `magic` (`DamageType` in `packages/shared`)
- Every tower has one damage type, `physical` by default. The owner changes it with `set-damage-type` during prep only and only before readying (the same window as upgrades). It is free. Rejections use their own reasons: `damage-type-phase-not-active` (not prep), `player-already-ready-for-wave`, `invalid-damage-type-target` (not the player's own tower), `invalid-damage-type` (unknown type). The next-wave preview (public wave composition) lets players pick the type each prep, so resistance shifts matter
- Every creature archetype has a multiplier per damage type, defined in data (`CREATURE_DAMAGE_MULTIPLIERS` in `packages/shared/src/creature-types.ts`). Multipliers are 0.5 (resists), 1 (neutral) or 1.5 (weak). Each archetype has exactly one weakness and one resistance:

| Archetype | physical | explosive | magic |
|-----------|----------|-----------|-------|
| runner    | 1.5      | 1         | 0.5   |
| swarm     | 0.5      | 1.5       | 1     |
| armored   | 0.5      | 1         | 1.5   |
| tank      | 1.5      | 0.5       | 1     |
| splitter  | 1        | 1.5       | 0.5   |
| juggernaut | 1       | 0.5       | 1.5   |

- Damage per hit = `max(1, round(towerDamage * multiplier))`, where `towerDamage` is the tower's damage per shot (the damage-track value 1 to 5 for arrow; see the tower type table for the other types). The minimum is 1, so a resisted hit always does something and a level-1 tower can kill every archetype. The accuracy roll happens before damage and is unaffected by the type. `tower-hit.damage` and the `towerDamageDealt` telemetry both carry the damage actually applied
- Friendly fire is disabled between towers

## Scoring and economy

- Killing a creature gives points to the responsible player (or shared split if configured)
- Points are spent on tower upgrades
- Upgrade costs scale with the track level to preserve challenge
- Anti-snowball (spec/06): trailing players get a catch-up bonus at wave end, and each player's points from swarm kills are capped per wave

## Win and lose conditions

- Win: first player to reach 1000 points
- Team fail state: all towers destroyed before any player reaches 1000 points

## Co-op interaction

- Each player controls own build cursor
- Each player has a visible name in HUD and score board
- Ping and quick signals for team communication
