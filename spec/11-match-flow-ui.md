# 11 Match Flow and UI Spec

## Menu flow

1. Open main menu
2. Select Play
3. Choose number of human players (1 to 8)
4. Show AI players entry with disabled state and offline note
5. Enter a name for each human player
6. Start match

## Match initialization flow

1. Generate procedural map from seed
2. Show map preview and player list
3. Ask each player to place exactly one tower
4. Prevent wave start until all required towers are placed

## In-round HUD requirements

- Show each player name
- Show each player points
- Show tower HP status indicators
- Show active wave and remaining creatures

## Between-round UX requirements

- Announce round completion
- Trigger automatic repair for all surviving towers
- Show repair results clearly (text and HP bar refill animation)
- Return to short prep phase for upgrades and wall placement

## Combat communication rules

- Towers target creatures only
- Friendly tower targeting and damage are disabled
- Creatures attack towers when in attack range

## Win and endgame UX

- Match ends immediately when a player reaches 1000 points
- Show winner name and final score table
- Offer rematch with same player setup and new map seed

## Offline-first messaging

- Main menu includes "Offline Mode" label
- AI option shows "Coming later"
- Online mode option is hidden or disabled for MVP
