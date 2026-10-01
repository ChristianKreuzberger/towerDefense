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
- Hot-seat turn handover: when a player's ready command is accepted during placement, the active player automatically switches to the next player (wrapping around) who is neither ready nor eliminated, and a toast plus the guide card announce "<name>, it's your turn". Nothing switches when no such player remains or the ready came from another phase
- Show active wave and remaining creatures
- Action toolbar (tower, wall, upgrade, ready) with icon, cost and hotkey on each button; costs come from the shared cost functions, never a client copy; the Upgrade button is enabled only in prep for a player who has not readied
- Action feedback appears as short-lived toasts (stacked, auto-dismissed), not a persistent log

## Real-time playback

- Combat advances automatically on a client timer; players do not press a tick button
- Default is playing at 1x whenever the match is in the combat phase
- Base rate is 5 simulation ticks per second at 1x; 2x and 4x run 10 and 20 ticks per second
- Controls: Play/Pause toggle and 1x / 2x / 4x speed buttons, visible during combat
- Pausing stops tick requests only; placing walls and target modes stay available while paused
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
- The monster cave (spawn) is drawn as a dark cave mouth on the left edge at the lane start, with a faint red tint over its protected area (no towers or walls, see spec/05). The right edge is marked as the goal; creatures leave at the last column

Towers
- Base ring in the player colour, a rotating turret, upgrade level visible as turret size, barrels and level pips, HP bar above the tower
- The turret turns toward the creature in `targetAssignments`. Towers only target creatures within their range; hovering a tower highlights it, draws a translucent range circle (radius = range in cells at the tower's current level) and a line to its current target. Hovering also shows a tooltip above the tower with its level, health, range, damage per shot, damage per second (at 1x playback) and accuracy; the numbers come from the shared `getTowerStats`, never a client copy. Accuracy is always 100% today because towers do not miss. While placing a tower, the ghost shows the level-1 range circle so the player can see what the tower will cover before committing

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

## Audio and settings

Sound effects are procedural Web Audio only: no audio files are downloaded or bundled, matching the procedural-art policy. Audio is presentation only. It is driven from client events and snapshot diffs; the simulation and server know nothing about it.

Settings dialog
- A "Settings" button sits in the main-menu actions (`#menuSettingsBtn`) and in the match session row (`#settingsBtn`)
- The dialog is a modal (`role="dialog"`, `aria-modal="true"`, labelled by its title) with an effects volume slider (0-100, default 70, with a visible value label), a mute toggle (`aria-pressed`) and a Close button
- Esc, Close or a click on the backdrop dismisses it; focus returns to the button that opened it
- While the dialog is open the rest of the page is `inert` (no Tab or pointer access behind it) and game hotkeys are ignored (Esc closes the dialog only)
- Moving the slider plays a short preview blip (not when muted); the blip is throttled
- `M` toggles mute from anywhere except form fields (key repeat is ignored). It is listed in the shortcut bar
- Settings persist in `localStorage` (see 08-data-persistence.md) and apply immediately

Engine rules
- The `AudioContext` is created lazily, never at import time, and unlocked (resumed) on the first `pointerdown`, `keydown` or `touchend`; the listeners are removed once the context is running and re-armed if the context later leaves the running state (for example Safari interruptions)
- If Web Audio is unavailable or throws, audio is a permanent no-op and nothing else is affected
- Output goes through a master gain, a compressor and fixed headroom. The master gain is the volume squared (perceptual curve); muted means gain 0 and no nodes are created
- Nothing plays while the document is hidden, while the context is not running, or on a fresh load, reconnect or event backlog (same suppression as visual effects: no previous snapshot, or more than 300 new events)
- Sounds are throttled per id (minimum interval, maximum simultaneous voices) and by a global voice cap. Priority sounds (wave start, wave clear, win, lose, tower destroyed) are never throttled or capped
- Tower pitch is derived deterministically from the player number; no randomness
- Cues from one batched response are spread across the glide time of that response, like visual effects

Event to sound table
| Source | Sound id | Notes |
| --- | --- | --- |
| `tower-hit` | `tower-shot` | at most one per tower id, at most 4 per snapshot |
| `creature-defeated` | `creature-kill` | at most 3 per snapshot |
| `creature-attack` | `tower-damaged` | |
| `tower-destroyed` | `tower-destroyed` | priority |
| `wall-hit` | `wall-hit` | |
| `wall-destroyed` | `wall-destroyed` | |
| `wave-start` event or phase change into `wave` | `wave-start` | once per snapshot |
| `wave-end` | `wave-clear`, plus `wave-clear-bonus` sparkle | |
| `tower-repaired` | `repair` | at most one per snapshot |
| phase change into `ended` from another phase | `win` (score-win) or `lose` (all-towers-destroyed) | priority |
| command accepted: place-tower, place-wall, upgrade-tower, ready-for-wave | `place-tower`, `place-wall`, `upgrade`, `ready` | |
| command rejected | `rejected` | debug commands and set-target-mode are silent |
| enabled button click | `ui-click` | `data-sfx` on a button overrides or disables (`none`) it |

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
- Return to short prep phase for upgrades (walls stay combat-only)

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
