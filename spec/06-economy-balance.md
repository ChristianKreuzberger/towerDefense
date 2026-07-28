# 06 Economy and Balance

## Economy model for MVP

Point economy with per-player score tracking.

## Income sources

- Creature kill rewards (primary)
- Wave-clear bonus
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

## Anti-snowball controls

- Catch-up bonus on low remaining base HP
- Cap burst income from swarm kills

## Constraints

- Towers cannot be sold or relocated after placement
- Spending points is limited to upgrades and wall construction at MVP

## Data storage

Keep all tower and enemy stats in data files, not hardcoded constants.
