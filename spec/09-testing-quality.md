# 09 Testing and Quality

## Test pyramid

- Unit tests for combat formulas, path checks, and economy math
- Integration tests for room command handling
- End-to-end smoke test for menu setup, tower placement, and one-wave completion

## High-value test cases

- AI players: every planned command is accepted by a real simulation; the same seed gives the same command list; hard beats medium beats easy over fixed seeds; a bots-only match reaches `ended` deterministically; bots wait for humans to place; unknown difficulty is a 400; rematch keeps `ai`; matches without bots and the balance baselines are unchanged
- Tower placement rejection when path would be fully blocked
- Tower cannot target or damage other towers
- Damage types: every type against every archetype gives max(1, round(damage * multiplier)); the minimum of 1 holds; `tower-hit.damage` equals the damage applied and the telemetry total; the same seed replays identically; set-damage-type is accepted only in prep before ready, and the transport rejects unknown types
- Each player must place exactly one tower before wave start
- Tower cannot be sold; it cannot be moved except for the single free move unlocked after 5 rounds (rejected before that, rejected a second time, rejected after ready or during a wave)
- Tower placement never invalidates all tower paths
- Anti-snowball: trailing player gets the catch-up bonus and the leader does not; the swarm income cap applies exactly at the boundary; same seed gives the same result; a wave-clear score win still ends the match after normal end-of-wave events
- Creature kill increments points and ends match at 1000 points
- End-of-round automatic tower repair is applied and announced
- Upgrade cost calculations remain deterministic
- Creature routing ignores tower list order, survives the loss of the first tower, and assigns live towers round robin
- `validateGameMap` rejects each kind of malformed map; generated maps are valid and leave at least 8 reachable tower sites on every seed (checked across several hundred seeds by counting sites, not by placing every combination)
- Tower spots: every default-size map has between 22 and `TOWER_SPOT_TOTAL` (32) spots over 300 seeds, all valid (off the road, outside spawn protection, spacing and coverage kept), the original 16 are an unchanged prefix of the list, small maps keep at least 8, and generation is deterministic per seed
- Touch placement: snapping picks the nearest free spot within 1.5 cells; the first tap selects (ghost and range shown, no tower placed), the Place button or a second tap on the same spot places; desktop click places at once

## Client audio and settings

- Client unit tests (`node --test` on the compiled output, fake `AudioContext` and storage) cover settings parsing and persistence, the event-to-sound mapping with its caps and suppression, and engine guards (no `AudioContext`, suspended, muted, hidden, throttling)
- The browser smoke tests must pass with `AudioContext` blocked, and cover settings persistence across reload and hotkey isolation while the dialog is open

## Tooling suggestions

- Vitest for unit and integration tests
- Playwright for browser smoke tests
- ESLint and TypeScript strict mode in CI

## CI quality gates

- Typecheck passes
- Lint passes
- Unit tests pass
- Coverage threshold for core simulation modules

## Non-functional checks

- Basic load simulation for 8-player local matches. Phase 3 adds a second perf scenario: 8 players with a mix of arrow, cannon and frost towers over 6 waves, so it includes the splitter (wave 4+) and the boss (wave 5), with the same budget. Phase 3 rules are tested beside the source: waves 1 to 3 unchanged, split and boss rules, splash, slow, determinism (same seed gives the same events) and bot-only matches finishing
- Repeated map-generation and match-restart stability check (without relying on
	machine-specific heap thresholds)

## Phase 3 performance check

Automated (`npm run test:perf`): the two simulation scenarios above. Pass bar: the slowest tick stays under 100 ms, active creatures stay under 300, and the average tick is printed against the 16 ms target. The second scenario fails if the splitter or the juggernaut never appears, so it cannot silently stop covering the new content.

Manual, not automated (needs a real mid-range phone; it cannot run in CI or in a headless browser): frame rate with the Phase 3 effects.
1. Device: a mid-range Android or iPhone from the last 4 years. Note the model, OS and browser version, and whether battery saver is on.
2. Serve the game on the local network (`npm run dev:game`, open `http://<computer-ip>:4173/?perf=1` on the phone). `?perf=1` shows the in-game overlay with the current and minimum FPS and the snapshot apply time; or attach Chrome remote debugging and read `window.__perf`.
3. Start a match with 8 seats, all of them bots (as many bots as the menu allows; one human to place a tower first is fine), so the busiest board is on screen. Leave Settings at the defaults: visual effects on, sound on, music off.
4. Let it play through wave 5 (splitters and the juggernaut). Call `window.__perf.reset()` when wave 5 starts if you use remote debugging.
5. Record minimum and average FPS over wave 5, and note any visible stutter.
6. Repeat once with "Visual effects" off in Settings to see how much the extras cost.
7. Pass bar: average at least 30 FPS and minimum at least 20 FPS with effects on. If it misses, file an issue with the numbers and device before tuning.

Result log (fill in per device; empty until someone runs it):

| Date | Device and browser | Effects | Avg FPS | Min FPS | Notes |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

Playtest: the 20-minute script, feedback form and findings template are in `12-playtest.md`. A session needs real people, so its results are recorded there by whoever runs it.
