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

How-to-play tour
- A short step-by-step dialog (goal, prep, combat, between waves, controls) that explains the game. It is shown automatically before the map preview the first time a match starts in this browser (menu Start Match or Rematch, never on reconnect). Dismissing it, by finishing, "Skip tour" or Esc, marks it as seen (spec/08), so later matches go straight to the map preview
- A "How to play" button in the main menu actions (`#menuTourBtn`) and in the match session row (`#tourBtn`) reopens it at any time; opened that way it only closes and returns focus to the opener, it does not open the map preview
- Controls: Back, Next (on the last step "Start playing"), Skip tour, and a "Step n of N" indicator. Numbers in the text (win score, starting points, wave-clear bonus, round of the free move) come from the shared rules, never a client copy
- Same dialog pattern as the map preview: `role="dialog"`, `aria-modal="true"`, labelled by its title, page behind `inert`, focus wraps inside, game hotkeys are ignored while it is open

Map preview step
- Shown as a dialog over the board right after a new match (menu Start Match or Rematch) has been generated. It is not shown when the client reconnects to a running match
- Content: a small overview of the generated map (tower pads, the lane creatures walk, blocked ground, the monster cave and its protected no-build area, with a legend). The lane is the set of buildable cells connected to the cave; other buildable cells are tower pads, the seed and size, and the player list with each player's colour/number and name
- A "Continue" button (focused when the dialog opens) closes it and starts placement for the first player; Esc does the same. It follows the match-end modal pattern: `role="dialog"`, `aria-modal="true"`, labelled by its title, page behind `inert`, focus wraps inside
- While it is open no tower can be placed and game hotkeys are ignored
- The overview is drawn from the snapshot's map cells only, so it shows whatever the map contains

## In-round HUD requirements

- Compact scoreboard, one chip per player: colour swatch with the player number, name, points with a bar toward the 1000-point goal, tower HP bar
- Scoreboard chips double as player switchers: clicking a chip, or activating the real button around its name with Enter or Space, selects that player. The chip itself is not a button, so the nested HP progressbar stays exposed to assistive tech
- The active chip is highlighted with a border and glow, the name button carries `aria-current="true"` and a non-colour marker (a ▶ before the name)
- Keys 1-8 select player N (ignored if that player does not exist); the keys only work while a match is on screen (not on the menu or the match-end overlay) and never while typing in a form field. Tab is deliberately left alone so keyboard-only navigation keeps working
- The "Active Player" select stays and is kept in sync with the chips in both directions
- Hot-seat turn handover: when a player's ready command is accepted during placement, the active player automatically switches to the next player (wrapping around) who is neither ready nor eliminated, and a large turn banner plus the guide card announce "<name>, it's your turn". Nothing switches when no such player remains or the ready came from another phase
- Turn reset after every wave: when the match moves from the wave phase back to placement (never when it ends), the active player resets to the first non-eliminated player in seating order (all ready flags are cleared at that point), so every round starts with the same player and the same banner. This runs once per wave-to-placement transition and never on the initial load, a reconnect or replayed event history
- Turn banner: a big, centered banner (separate from the wave banner so both can show after a wave ends) with the player's name and "it's your turn". The text uses the player's colour, at least 40px on desktop (scaled down with the viewport on phones, never below 28px, wrapping instead of overflowing), and stays visible for about 3.5 seconds. It is `aria-live="polite"`, does not take pointer events, and under `prefers-reduced-motion` it appears without animation. It is only shown when more than one player is in the match. Generic action toasts are unchanged
- The guide card title is larger (18px) so the turn message is readable from across the table
- Show active wave and remaining creatures
- Action toolbar (tower, move, three upgrade buttons, ready) with icon, cost and hotkey on each button; costs come from the shared cost functions, never a client copy; each upgrade button (Range `U`, Damage `I`, Accuracy `O`) is enabled only in prep for a player who has not readied and whose tower is below max level on that track (it then shows "MAX" instead of a cost; each shows its own cost); target-mode controls are enabled whenever the player has a living tower and the match is running (prep and combat)
- Action feedback appears as short-lived toasts (stacked, auto-dismissed), not a persistent log

## Real-time playback

- Combat advances automatically on a client timer; players do not press a tick button
- Default is playing at 1x whenever the match is in the combat phase
- Base rate is 5 simulation ticks per second at 1x; 2x and 4x run 10 and 20 ticks per second
- Controls: Play/Pause toggle and 1x / 2x / 4x speed buttons, visible during combat
- Pausing stops tick requests only; target modes stay available while paused and also in prep
- Player names are always rendered as text (never as HTML) and are limited to 24 characters
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
- The map only distinguishes buildable cells from non-buildable ones. Buildable cells are the walkable layer: they are drawn as the road, creatures walk on them and towers are placed on them (see spec/05, Creature lane). Non-buildable cells are raised grass pads that creatures never enter. There are no blocked cells in the simulation, so decoration (pebbles, tufts, flowers) is purely cosmetic and never implies blocking
- Grass cells pick one of several variants from a seeded hash of (map seed, x, y), so a map always looks the same
- The road is drawn as one continuous surface: edges against grass pads are chosen from the four-neighbour mask (rounded edge, shadow), interior cells are plain road
- Path wear draws darker ruts over the road and scales with the wear value
- The monster cave (spawn) is drawn as a dark cave mouth on the left edge at the lane start, with a faint red tint over its protected area (no towers, see spec/05). The right edge is marked as the goal; creatures leave at the last column

Towers
- Base ring in the player colour, a rotating turret, upgrade level visible as turret size, barrels and level pips, HP bar above the tower
- Tower style tiers: every 3rd upgrade (counted across all tracks, so by the tower's overall `level`) switches the tower to a new look. Tier = floor((level - 1) / 3), tiers 0 to 4 (level 13 is the highest). Each tier has its own turret art and its shots look different (longer, thicker bolts with a brighter muzzle flash from tier 2, a white core from tier 3). The level pips under the tower show progress to the next tier (0 to 2 pips)
- Level-up: when an upgrade is bought the tower plays a short shine (gold ring, sparkles, a small pulse and a floating "Level up"); when the purchase starts a new tier it is bigger and says "New style!". Nothing plays on first render or reconnect, and with reduced motion only the floating text shows
- The turret turns toward the creature in `targetAssignments`. Towers only target creatures within their range; hovering a tower highlights it, draws a translucent range circle (radius = range in cells at the tower's current level) and a line to its current target. Hovering also shows a tooltip above the tower with its level, the level of each upgrade track (range, damage, accuracy), health, range, damage per shot, damage per second (at 1x playback) and accuracy; the numbers come from the shared `getTowerStats`, never a client copy. The tooltip also names the tower's damage type. Accuracy is the shared `getTowerAccuracy` value. While placing a tower, the ghost shows the level-1 range circle so the player can see what the tower will cover before committing

Ruins
- A destroyed tower leaves ruins on its cell (broken base in the owner's colour, rubble, scorch mark) for the rest of the match. They are presentation only: they do not block placement, targeting or paths
- Hovering the ruins shows a tooltip with the owner's name and the wave in which the tower was destroyed. Ruins are derived from `tower-destroyed` events, so towers destroyed before the client connected leave none
- Ruins are cleared when a new map starts (rematch)

Creatures
- Four silhouettes, readable without text: runner (slim, pointed), swarm (small round bug), armored (plated hex), tank (large square with tracks and cannon)
- Creatures face their heading, bob while walking, show an HP bar only when damaged, and leave a puff when they die

Effects (driven by snapshot events, presentation only)
- `tower-hit`: projectile from tower to creature, hit spark, turret recoil
- `creature-defeated`: particle burst and a floating "+points" in the scoring player's colour
- `creature-attack`: tower flash and shake
- `tower-destroyed`: explosion (flash, fireball, debris, smoke) played on the tower; the tower vanishes only once the explosion has peaked and leaves ruins behind (see Ruins). With `prefers-reduced-motion` the explosion is a single short static flash
- `wave-end`: wave-clear banner
- `tower-hit` and `creature-defeated` carry the cell the creature was in. Strong towers can kill a creature within the same batched response that spawned it, so it never appears in a snapshot; the client falls back to that cell so shots and kills are still shown
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

Next-wave preview and HUD
- During prep (placement phase) the phase banner shows what the coming wave brings, for example "Next wave 3: 2x Runner (weak: physical), 1x Swarm (weak: explosive), 1x Armored (weak: magic), 1x Tank (weak: physical)" (each archetype's weaknesses are the damage types whose multiplier is above 1, from the shared data); it is hidden during combat and after the match ends. The composition comes from the shared wave rule, never a client copy
- The battlefield meta line shows how many creatures of the current wave are still to spawn, next to the active count
- The ended status text names the winner (never the raw id)

Damage type selector
- A "Damage" select sits next to the Target Mode select with Physical, Explosive and Magic. It is enabled only when the simulation would accept `set-damage-type` (player has a living tower, prep phase, not ready; `damageTypeEnabled` in the toolbar state) and shows the tower's current type from the snapshot. Rejections show a toast with their own text

Move tower
- A "Move Tower" button (hotkey `V`, cost shown as "free") appears in the toolbar. It is available only when the simulation would accept a move (`towerMoveAvailable` for the player, prep phase, not ready); before the unlock it is dimmed and a press explains "unlocks after round 5"
- Pressing it enters move mode (the button shows pressed, Esc or pressing again leaves it); the next click on a tile sends the move. Move mode also ends when the move is accepted, the phase changes or the active player changes
- The tower glides to its new tile with a short pop
- Cost-slot label (from state, never from DOM text): `free` (move available), `after R5` (locked, wave 5 or earlier), `used` (unlocked, not ready, token spent), `ready` (unlocked and the player is ready; the snapshot cannot tell a spent token from an unspent one, so the hint is hedged: "You can only move your tower before you ready up (if you have not used your free move yet)"), and `-` outside prep, with no living tower or when eliminated. The `ready` check comes before the token check because the simulation reports `towerMoveAvailable: false` for a ready player

Match lifecycle and hotkeys
- "Back To Menu" leaves the match running on the host and stops playback. While a match that has not ended exists, the menu shows a "Resume Match" button that returns to it
- "Start Match" asks for confirmation ("Replace the running match?") when a match that has not ended exists; cancelling leaves it untouched
- Guide "Place Tower" and the `T` key place the tower on the tile the player chose (the board cursor, which a click also sets), not the first free tile
- Hotkeys R, T, W, V, U, I and O do nothing when their action is not available (wrong phase, already ready, tower already placed, match ended) and while any dialog is open. Esc dismisses the guide card
- When the match has ended the Ready and Place Tower buttons are disabled, so closing the end modal never leaves live controls behind
- On page load the menu and game screens stay hidden until the reconnect check has answered (at most about a second), so a running match does not flash the menu first

Match-end modal
- Same pattern as the settings dialog: `role="dialog"`, `aria-modal="true"`, labelled by its "Match Ended" title
- Focus moves to the Rematch button when it opens and the rest of the page is `inert` (no Tab or pointer access behind it)
- Esc or the Close button dismisses it; focus returns to the element that had it before (or the Settings button if that is gone). Once dismissed it does not reopen on later snapshot refreshes of the same ended match; a new match or rematch resets that
- While it is open game hotkeys are ignored
- The guide's close button is a "×" with an accessible name and a `title` tooltip ("Dismiss guidance")
- The shortcut bar lists exactly the hotkeys that exist: R, T, W, V, U/I/O, 1-8 (switch player), P, M and the arrow keys

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
| `tower-hit`, `tower-miss` | `tower-shot` | at most one per tower id, at most 4 per snapshot; a miss draws the shot flying past the creature with a floating "miss" |
| `creature-defeated` | `creature-kill` | at most 3 per snapshot |
| `creature-attack` | `tower-damaged` | |
| `tower-destroyed` | `tower-destroyed` | priority |
| `wave-start` event or phase change into `wave` | `wave-start` | once per snapshot |
| `wave-end` | `wave-clear`, plus `wave-clear-bonus` sparkle | |
| `tower-repaired` | `repair` | at most one per snapshot |
| phase change into `ended` from another phase | `win` (score-win) or `lose` (all-towers-destroyed) | priority |
| command accepted: place-tower, upgrade-tower, ready-for-wave | `place-tower`, `upgrade`, `ready` | |
| command rejected | `rejected` | debug commands are silent; a rejected set-target-mode shows a toast but plays no sound |
| enabled button click | `ui-click` | `data-sfx` on a button overrides or disables (`none`) it |

## Tile entry

- Coordinate entry fields are not part of the normal UI

## Guidance overlay

- Guidance is a non-blocking coach mark: it never intercepts pointer input outside its own card and never covers the battlefield
- It can be dismissed with its close control and reappears only when the guidance step changes

## Diagnostics and debug

- Query `?perf=1` shows an overlay and exposes `window.__perf` (snapshot apply time, fps, snapshot size)
- Query `?debug=1` reveals developer controls: snapshot JSON, tile X/Y inputs, manual tick and advance-many buttons, and a "Demo combat" button that feeds synthetic creatures and events to the board (client only, no simulation involved) to exercise creature and effect visuals
- None of these appear in the default view

## Between-round UX requirements

- Announce round completion
- Trigger automatic repair for all surviving towers
- Show repair results clearly (text and HP bar refill animation)
- Return to short prep phase for upgrades

## Combat communication rules

- Towers target creatures only
- Friendly tower targeting and damage are disabled
- Creatures attack every tower within their attack range, and hit harder the closer the tower is

## Win and endgame UX

- Match ends immediately when a player reaches 1000 points
- Show winner name and final score table
- Offer rematch with same player setup and new map seed

## Offline-first messaging

- Main menu includes "Offline Mode" label
- AI option shows "Coming later"
- Online mode option is hidden or disabled for MVP
