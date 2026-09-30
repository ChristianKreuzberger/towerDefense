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

## Real-time playback

- Combat advances automatically on a client timer; players do not press a tick button
- Default is playing at 1x whenever the match is in the combat phase
- Base rate is 5 simulation ticks per second at 1x; 2x and 4x run 10 and 20 ticks per second
- Controls: Play/Pause toggle and 1x / 2x / 4x speed buttons, visible during combat
- Pausing stops tick requests only; placing walls, upgrades and target modes stay available while paused
- Ticks are requested in small batches (at most 4 per request, one request in flight) so a slow response never queues work
- Playback never runs while the browser tab is hidden and does not catch up on return
- Playback stops when the phase leaves combat (round end, match end) and resumes automatically when the next wave starts
- Creature positions are interpolated between the previous and latest snapshot over the real time one tick takes at the current speed, so motion looks continuous although the simulation is discrete
- Sub-cell progress (pathProgressUnits, 100 per cell) offsets the drawn position along the creature's heading

## Wall placement

- Walls are placed from the battlefield: toggle "Place Wall" (or press W), then click a buildable free tile; the mode stays active until toggled off
- Coordinate entry fields are not part of the normal UI

## Guidance overlay

- Guidance is a non-blocking coach mark: it never intercepts pointer input outside its own card and never covers the battlefield
- It can be dismissed with its close control and reappears only when the guidance step changes

## Diagnostics and debug

- Query `?perf=1` shows an overlay and exposes `window.__perf` (snapshot apply time, fps, snapshot size)
- Query `?debug=1` reveals developer controls: snapshot JSON, wall X/Y inputs, manual tick and advance-many buttons
- None of these appear in the default view

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
