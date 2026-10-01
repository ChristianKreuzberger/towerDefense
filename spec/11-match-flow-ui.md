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

- Compact scoreboard, one chip per player: colour swatch with the player number, name, points with a bar toward the 1000-point goal, tower HP bar
- Scoreboard chips double as player switchers: clicking a chip, or activating the real button around its name with Enter or Space, selects that player. The chip itself is not a button, so the nested HP progressbar stays exposed to assistive tech
- The active chip is highlighted with a border and glow, the name button carries `aria-current="true"` and a non-colour marker (a ▶ before the name)
- Keys 1-8 select player N (ignored if that player does not exist); the keys only work while a match is on screen (not on the menu or the match-end overlay) and never while typing in a form field. Tab is deliberately left alone so keyboard-only navigation keeps working
- The "Active Player" select stays and is kept in sync with the chips in both directions
- Show active wave and remaining creatures
- Action toolbar (tower, wall, upgrade, ready) with icon, cost and hotkey on each button; costs come from the shared cost functions, never a client copy
- Action feedback appears as short-lived toasts (stacked, auto-dismissed), not a persistent log

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

## Visual design

Art direction: clean tabletop / toy diorama. Flat shapes, soft drop shadows, crisp dark outlines, a limited desaturated palette, and strong contrast between the walkable road and the raised grass pads.

Asset policy
- All art is procedural. Textures are drawn once with the 2D canvas API at boot (and again only when the cell size changes) and uploaded as Phaser textures; nothing is downloaded and there are no image or font files
- Typography uses a system font stack only
- No per-frame allocation: sprites, health bars, projectiles and particles are created on first use, pooled, and only mutated afterwards

Palette and identity
- `apps/client/src/art/palette.ts` is the single source of player colours. The CSS custom properties `--p1` to `--p8` are generated from it at startup; style.css does not define them
- A player is never identified by colour alone: towers carry the player number on their base and the scoreboard swatch shows the same number
- UI is a dark frame with cream text (no parchment)

Board scaling
- The canvas keeps a fixed internal resolution per map size and is scaled by CSS to fit the board container (both width and viewport height), keeping the aspect ratio
- Default board display size is 20% larger than the original: cell sizes are 34 / 26 / 19 px (small / medium / large maps, previously 28 / 22 / 16), and the viewport-height cap is relaxed to match, so on short screens the board may exceed the viewport height and the page scrolls (`calc(120vh - 204px)`). This is done by the internal resolution, not CSS zoom or transform
- Pointer to cell conversion measures the canvas rectangle at event time, so any CSS scaling stays correct

Terrain
- The map only distinguishes buildable cells from non-buildable ones. Buildable cells are the walkable layer: they are drawn as the road, creatures walk on them and towers and walls are placed on them (see spec/05, Creature lane). Non-buildable cells are raised grass pads that creatures never enter. There are no blocked cells in the simulation, so decoration (pebbles, tufts, flowers) is purely cosmetic and never implies blocking
- Grass cells pick one of several variants from a seeded hash of (map seed, x, y), so a map always looks the same
- The road is drawn as one continuous surface: edges against grass pads are chosen from the four-neighbour mask (rounded edge, shadow), interior cells are plain road
- Path wear draws darker ruts over the road and scales with the wear value
- The left map edge is marked as the spawn gate and the right edge as the goal, matching the simulation (creatures enter at x = 0 and leave at the last column)

Towers
- Base ring in the player colour, a rotating turret, upgrade level visible as turret size, barrels and level pips, HP bar above the tower
- The turret turns toward the creature in `targetAssignments`. Towers only target creatures within their range; hovering a tower highlights it, draws a translucent range circle (radius = range in cells at the tower's current level) and a line to its current target. While placing a tower, the ghost shows the level-1 range circle so the player can see what the tower will cover before committing

Creatures
- Four silhouettes, readable without text: runner (slim, pointed), swarm (small round bug), armored (plated hex), tank (large square with tracks and cannon)
- Creatures face their heading, bob while walking, show an HP bar only when damaged, and leave a puff when they die

Walls
- Solid blocks filling the cell, a crack overlay at 66 percent HP and a heavier one at 33 percent

Effects (driven by snapshot events, presentation only)
- `tower-hit`: projectile from tower to creature, hit spark, turret recoil
- `creature-defeated`: particle burst and a floating "+points" in the scoring player's colour
- `creature-attack`: tower flash and shake
- `tower-destroyed`: smoke
- `wall-hit`: spark
- `wave-end`: wave-clear banner
- Events of one batched response are spread across the glide time of that response so they do not all fire at once; the number of effects per snapshot is capped
- With `prefers-reduced-motion` there is no shake, no particle burst and no banner animation; flashes become short static highlights

## Wall placement

- Walls are placed from the battlefield: toggle "Place Wall" (or press W), then click a buildable free tile; the mode stays active until toggled off
- Coordinate entry fields are not part of the normal UI

## Guidance overlay

- Guidance is a non-blocking coach mark: it never intercepts pointer input outside its own card and never covers the battlefield
- It can be dismissed with its close control and reappears only when the guidance step changes

## Diagnostics and debug

- Query `?perf=1` shows an overlay and exposes `window.__perf` (snapshot apply time, fps, snapshot size)
- Query `?debug=1` reveals developer controls: snapshot JSON, wall X/Y inputs, manual tick and advance-many buttons, and a "Demo combat" button that feeds synthetic creatures and events to the board (client only, no simulation involved) to exercise creature and effect visuals
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
