# 06 Economy and Balance

## Economy model for MVP

Point economy with per-player score tracking.

## Income sources

- Creature kill rewards (primary)
- Wave-clear bonus: every surviving player with a living tower is rewarded `WAVE_CLEAR_BONUS` (15 points) when a wave completes with zero creature leaks. Leaking a single creature forfeits the bonus for that wave. If the bonus lifts a player to 1000 points, the wave still completes its normal end-of-wave events and telemetry before the match ends with a score win.
- Optional assist bonus for multiplayer balancing

## Spend sinks

- Tower upgrades
- Wall placement
- Optional tower repair boosts later (auto-repair remains baseline)

## Balance principles

- Early waves teach basics with low punishment
- Mid waves require mixed tower composition
- Late waves force adaptation to armor/resistance shifts

## Example tuning parameters

- Starting points: 0
- Win threshold: 1000 points
- Wall cost scaling: baseWallCost * 1.2^placedWalls
- Upgrade cost scaling: baseCost * 1.6^level
- Max tower level: `MAX_TOWER_LEVEL = 5` (default chosen to keep late-game damage and range bounded; revisit together with the damage rework and anti-snowball work). Reaching it from level 1 costs 80 + 128 + 204 + 327 = 739 points in total at the current scaling, so a capped tower is a serious but reachable goal before the 1000-point win. Level 5 range is 12 cells
- Tower range (grid cells): baseTowerRange + (level - 1) * towerRangePerLevel, with baseTowerRange = 6 and towerRangePerLevel = 1.5 (level 1 = 6, level 2 = 7.5, level 3 = 9). Creatures now have a short attack range too (see below), so the short base range is a deliberate trade-off: towers must be placed close to the lane and upgrades matter
- Spawn protection: `CREATURE_SPAWN_PROTECTION_SECONDS = 1`, expressed in simulation ticks as `SPAWN_PROTECTION_TICKS = 5` because the client runs 5 ticks per second at 1x. Protected creatures cannot be targeted or damaged, so every creature gets at least 5 ticks of travel before it can be shot (balance note: this slightly lowers early kill rates; separate from `SPAWN_PROTECTION_RADIUS`, which is about tower placement)
- Creature hitpoints: swarm 2, runner 3, armored 5, tank 8 (raised from 1/2/3/5 so a level 1 tower never one-shots anything and a level 2 tower no longer one-shots a runner; swarm stays the easiest to kill, and a level 3+ tower can still one-shot a swarm or runner on purpose)
- Creature attack range (grid cells, Euclidean, inclusive, from the creature's current cell): runner 1, swarm 1, armored 1.5, tank 1.5. A creature only damages a tower or wall within its range and keeps walking otherwise. Balance note: towers placed far from the lane are now safe, and a tower beside the lane is only hurt while creatures pass close by, so tower damage intake drops sharply versus the old "hit from anywhere" behaviour
- The base range is short relative to the 50x50 map (it was 12 before), so a lone level 1 tower only covers a small stretch of the lane and range upgrades are a real choice

## Anti-snowball controls

- Catch-up bonus on low remaining base HP
- Cap burst income from swarm kills

## Constraints

- Towers cannot be sold or relocated after placement
- Spending points is limited to upgrades and wall construction at MVP

## Data storage

Keep all tower and enemy stats in data files, not hardcoded constants.
