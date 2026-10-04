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
- Optional tower repair boosts later (auto-repair remains baseline)

## Balance principles

- Early waves teach basics with low punishment
- Mid waves require mixed tower composition
- Late waves force adaptation to armor/resistance shifts
- Path wear (spec/05) is a soft brake on busy lanes: it is bounded by the minimum creature speed, and between-wave repair keeps it from building up forever

- Wave size is ceil(1.5 x (N + 2)) creatures (see spec/02). Bigger waves mean more kills and points per wave, more tower wear, and longer waves; the swarm income cap per wave (80) and rewards are unchanged, so tower HP was raised from 100 to 175 (the between-wave repair stays 20% of max health, now 35 HP). Without it a lone tower died in wave 1 on about half of all seeds, and after creature attacks became 20% stronger it still died in wave 2 of the solo baseline scenario at 150 HP. Reward values and the 1000-point goal are unchanged

## Example tuning parameters

- Starting points: `STARTING_POINTS` = 100 per player. A tower close to the cave is in more danger but also has the advantage, and whoever places later gets the worse spots, so everyone can buy a first upgrade in the opening prep, after placing a tower and before readying. 100 buys one damage upgrade (96), one range upgrade (64) or one accuracy upgrade (45), so a late placer can offset a weak spot with range or damage. A default chosen by the implementer; tune with the balance reports
- Win threshold: 1000 points
- Upgrade cost per track: floor(baseCost * growth^currentTrackLevel). Range: base 40, growth 1.6 (64, 102, 163, 262; 591 for the whole track). Damage: base 60, growth 1.6 (96, 153, 245, 393; 887). Accuracy: base 30, growth 1.5 (45, 67, 101, 151; 364). Damage is the strongest and so the most expensive; accuracy is the cheapest. Buying every track completely costs 1842 points, more than the 1000 needed to win, so players must choose. These are defaults chosen by the implementer (issue #60 left them open) and should be tuned with the balance reports
- Max level: `MAX_TOWER_LEVEL = 5` applies to each upgrade track separately (it started as a single tower level cap in #20). A tower's overall `level` (used for art and the level pips) is 1 + the number of upgrades bought across all tracks
- Tower range (grid cells): baseTowerRange + (rangeLevel - 1) * towerRangePerLevel, with baseTowerRange = 6 and towerRangePerLevel = 1.5 (range level 1 = 6, level 2 = 7.5, level 3 = 9, level 5 = 12). Creatures can hit towers up to 3.5 cells from the lane and hit harder the closer they are (see below), so the short base range is a deliberate trade-off: a tower close to the lane fires more but takes more damage, and upgrades matter
- Damage types: the per-archetype multiplier table lives in data (`CREATURE_DAMAGE_MULTIPLIERS`, values 0.5, 1 or 1.5; see spec/02 for the table). Damage per hit = max(1, round(towerDamage * multiplier)); with level-1 damage every hit therefore does 1 or 2 (1.5 rounds up to 2, 0.5 is lifted to the minimum 1), so a level-1 tower can still kill every archetype. Matching the type to the next wave's weakness is worth up to +50% damage and is the intended "resistance shift" decision. Telemetry `towerDamageDealt` counts the damage after the multiplier. Baselines were refreshed for this change
- Tower damage per shot: damageLevel (1 to 5). Tower accuracy: 0.70 + (accuracyLevel - 1) * 0.075 (70%, 77.5%, 85%, 92.5%, 100%). Expected damage per tick is accuracy x damage, so level-1 towers deal 0.7 per tick against the new creature hit points
- Spawn protection: `CREATURE_SPAWN_PROTECTION_SECONDS = 1`, expressed in simulation ticks as `SPAWN_PROTECTION_TICKS = 5` because the client runs 5 ticks per second at 1x. Protected creatures cannot be targeted or damaged, so every creature gets at least 5 ticks of travel before it can be shot (balance note: this slightly lowers early kill rates; separate from `SPAWN_PROTECTION_RADIUS`, which is about tower placement)
- Creature hitpoints: swarm 2, runner 3, armored 5, tank 8 (raised from 1/2/3/5). A level 1 tower cannot one-shot a runner, armored or tank, but an explosive level 1 shot does round(1 x 1.5) = 2 to a swarm creature, which is its full HP, so it one-shots a swarm; and a damage level 2 physical shot does round(2 x 1.5) = 3 to a runner, which one-shots it. The type multipliers (spec/02) decide who one-shots what, so matching the type matters; a level 3+ tower can one-shot a swarm or runner on purpose
- Creature attack range (reach, grid cells, Euclidean, inclusive, from the creature's current cell): runner 2.5, swarm 2.5, armored 3.5, tank 3.5 (raised from 1/1/1.5/1.5 in issue #69, because towers beside the lane were almost never in danger). A creature damages every tower within its reach each tick and keeps walking otherwise
- Closer is stronger (`CREATURE_PROXIMITY_DAMAGE_BANDS`): damage per hit = base attack damage (runner 1, swarm 1, armored 2, tank 3) x the multiplier of the first band whose distance covers the tower: within 1.5 cells x3, within 2.5 x2, within 3.5 x1, then x `CREATURE_ATTACK_DAMAGE_SCALE` (1.2, issue #84: play-testing found the game too easy) and rounded to a whole number. Beyond the creature's own reach the damage is 0. Resulting damage per hit:

  | Archetype | d <= 1.5 | d <= 2.5 | d <= 3.5 |
  | --- | --- | --- | --- |
  | runner | 4 | 2 | 0 (out of reach) |
  | swarm | 4 | 2 | 0 (out of reach) |
  | armored | 7 | 5 | 2 |
  | tank | 11 | 7 | 4 |

  The worst single hit is 11 HP (tank beside a tower). All values are integers and distance checks use squared distances, so the outcome stays deterministic
- Balance note: a tower within 3.5 cells of the lane is in real danger and can lose more HP per wave than the between-wave repair (20% of max health, 35 HP at the default 175 HP) gives back; a tower 4 to 6 cells away is safe but covers less of the lane with its range of 6, so it fires less. Every tower in reach is hit, so towers clustered on one stretch of lane all take damage. Baselines were refreshed for this change
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
- Spending points is limited to tower upgrades at MVP (there are no walls; they were removed from the game)

## Data storage

Keep all tower and enemy stats in data files, not hardcoded constants.
