# 02 Gameplay Rules

## Match loop

1. Menu setup: choose number of human players (1 to 8), enter each player name, show disabled AI player option
2. Procedural map generation and pre-round placement phase
3. Mandatory placement: each player places exactly one tower
4. Wave combat phase
5. Reward and short prep phase with automatic tower repairs
6. Repeat until a player reaches 1000 points

## Shared objectives

- Keep all player towers alive
- Optimize tower upgrades and wall placement
- Score points efficiently by killing creatures

## Tower placement rules

- Towers can only be placed on buildable cells
- Placement cannot overlap existing towers
- Placement cannot make all enemy paths invalid
- Each player places one tower at match start
- Once placed, a tower cannot be moved or sold

## Tower lifecycle

- Upgrade (multiple levels)
- Cannot shoot other towers under any condition
- Can shoot invading creatures based on tower range and targeting rules
- Takes damage from creature attacks
- Auto-repaired between rounds (must be clearly shown in UI)

## Walls

- Players can spend points to place walls
- Walls block creature movement and alter pathing
- Wall placement must preserve at least one valid path to each live tower
- Walls are persistent once placed for MVP

## Enemy model

- Creatures path toward towers and attempt to attack them
- Creatures cannot move through walls
- Archetypes: runner, tank, armored, swarm
- Later archetypes can include shield or split-on-death

## Damage and targeting

- Targeting modes: first, last, strongest, nearest
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
