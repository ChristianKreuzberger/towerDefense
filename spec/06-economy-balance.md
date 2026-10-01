# 06 Economy and Balance

## Economy model for MVP

Point economy with per-player score tracking.

## Income sources

- Creature kill rewards (primary)
- Wave-clear bonus: every surviving player with a living tower is rewarded `WAVE_CLEAR_BONUS` (15 points) when a wave completes with zero creature leaks. Leaking a single creature forfeits the bonus for that wave. If the bonus lifts a player to 1000 points, the wave still completes its normal end-of-wave events and telemetry before the match ends with a score win.
- Catch-up bonus: see "Anti-snowball controls"
- Optional assist bonus for multiplayer balancing

## Spend sinks

- Tower upgrades
- Wall placement
- Optional tower repair boosts later (auto-repair remains baseline)

## Balance principles

- Early waves teach basics with low punishment
- Mid waves require mixed tower composition
- Late waves force adaptation to armor/resistance shifts
- Path wear (spec/05) is a soft brake on busy lanes: it is bounded by the minimum creature speed, and between-wave repair keeps it from building up forever

## Example tuning parameters

- Starting points: 0
- Win threshold: 1000 points
- Wall cost scaling: baseWallCost * 1.2^placedWalls
- Upgrade cost per track: floor(baseCost * growth^currentTrackLevel). Range: base 40, growth 1.6 (64, 102, 163, 262; 591 for the whole track). Damage: base 60, growth 1.6 (96, 153, 245, 393; 887). Accuracy: base 30, growth 1.5 (45, 67, 101, 151; 364). Damage is the strongest and so the most expensive; accuracy is the cheapest. Buying every track completely costs 1842 points, more than the 1000 needed to win, so players must choose. These are defaults chosen by the implementer (issue #60 left them open) and should be tuned with the balance reports
- Max level: `MAX_TOWER_LEVEL = 5` applies to each upgrade track separately (it started as a single tower level cap in #20). A tower's overall `level` (used for art and the level pips) is 1 + the number of upgrades bought across all tracks
- Tower range (grid cells): baseTowerRange + (rangeLevel - 1) * towerRangePerLevel, with baseTowerRange = 6 and towerRangePerLevel = 1.5 (range level 1 = 6, level 2 = 7.5, level 3 = 9, level 5 = 12). Creatures now have a short attack range too (see below), so the short base range is a deliberate trade-off: towers must be placed close to the lane and upgrades matter
- Damage types: the per-archetype multiplier table lives in data (`CREATURE_DAMAGE_MULTIPLIERS`, values 0.5, 1 or 1.5; see spec/02 for the table). Damage per hit = max(1, round(towerDamage * multiplier)); with level-1 damage every hit therefore does 1 or 2 (1.5 rounds up to 2, 0.5 is lifted to the minimum 1), so a level-1 tower can still kill every archetype. Matching the type to the next wave's weakness is worth up to +50% damage and is the intended "resistance shift" decision. Telemetry `towerDamageDealt` counts the damage after the multiplier. Baselines were refreshed for this change
- Tower damage per shot: damageLevel (1 to 5). Tower accuracy: 0.70 + (accuracyLevel - 1) * 0.075 (70%, 77.5%, 85%, 92.5%, 100%). Expected damage per tick is accuracy x damage, so level-1 towers deal 0.7 per tick against the new creature hit points
- Spawn protection: `CREATURE_SPAWN_PROTECTION_SECONDS = 1`, expressed in simulation ticks as `SPAWN_PROTECTION_TICKS = 5` because the client runs 5 ticks per second at 1x. Protected creatures cannot be targeted or damaged, so every creature gets at least 5 ticks of travel before it can be shot (balance note: this slightly lowers early kill rates; separate from `SPAWN_PROTECTION_RADIUS`, which is about tower placement)
- Creature hitpoints: swarm 2, runner 3, armored 5, tank 8 (raised from 1/2/3/5 so a level 1 tower never one-shots anything and a level 2 tower no longer one-shots a runner; swarm stays the easiest to kill, and a level 3+ tower can still one-shot a swarm or runner on purpose)
- Creature attack range (grid cells, Euclidean, inclusive, from the creature's current cell): runner 1, swarm 1, armored 1.5, tank 1.5. A creature only damages a tower or wall within its range and keeps walking otherwise. Balance note: towers placed far from the lane are now safe, and a tower beside the lane is only hurt while creatures pass close by, so tower damage intake drops sharply versus the old "hit from anywhere" behaviour
- The base range is short relative to the 50x50 map (it was 12 before), so a lone level 1 tower only covers a small stretch of the lane and range upgrades are a real choice

## Anti-snowball controls

There is no base, so "trailing" is measured in points. Both levers are driven by values in `packages/shared/src/game-rules.ts`. The numbers below are defaults chosen by the implementer (issue #17 left them open) and should be tuned with the balance reports.

- Catch-up bonus: at the end of every wave, after the wave-clear bonus, each surviving player with a living tower who is trailing the leader gets a bonus. The leader is the surviving player with the most points (points after the wave-clear bonus). Gap = leader points - player points. A player is trailing when gap >= `CATCH_UP_GAP_THRESHOLD` (100). Bonus = min(`CATCH_UP_MAX_BONUS` (30), floor(gap * `CATCH_UP_GAP_FRACTION` (0.1))), so a 100 point gap pays 10 and a 300+ point gap pays 30.
  - The leader (and anyone tied with the leader) never gets it, and eliminated players never get it.
  - It is paid in player id order, is counted as awarded points, and is never paid if the match already ended (a wave-clear score win still ends the match after the normal end-of-wave events, and the catch-up bonus does not run then).
  - It can never lift a player to the win score by itself: the bonus is reduced so the player stays at `WIN_SCORE - 1` at most (and skipped when that leaves nothing).
  - Emits a `catch-up-bonus` event and is recorded in wave telemetry (`catchUpBonusAwarded`) and per player balance data.
- Swarm income cap: each player may earn at most `SWARM_KILL_INCOME_CAP_PER_WAVE` (80) points from swarm kills per wave (10 swarm kills at the current reward of 8). A kill that would exceed the cap pays only what is left (possibly 0). The kill itself still counts as a kill; only the points are forfeited. The counter resets at wave start. Forfeited points are recorded in wave telemetry (`swarmIncomeCapped`), per player balance data, and a `swarm-income-capped` event.
- Both rules are deterministic: they use only points, wave state and player id order, no randomness.

## Constraints

- Towers cannot be sold. They cannot be relocated either, except for the one free move per player that unlocks after 5 completed rounds (see spec/02); the move costs no points
- Spending points is limited to upgrades and wall construction at MVP

## Data storage

Keep all tower and enemy stats in data files, not hardcoded constants.
