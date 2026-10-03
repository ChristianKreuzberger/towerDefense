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

- Basic load simulation for 8-player local matches
- Repeated map-generation and match-restart stability check (without relying on
	machine-specific heap thresholds)
