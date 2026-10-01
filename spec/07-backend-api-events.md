# 07 Backend API and Events

## Transport

MVP transport is local in-process command dispatch. Online transport will be added later through an adapter (for example Colyseus WebSocket rooms).

## REST endpoints (supporting)

- Offline MVP can run without REST requirements
- Future online endpoints:
- POST /rooms/create
- POST /rooms/join
- GET /maps
- GET /maps/:id
- GET /health

## Local host HTTP API (offline MVP)

The offline MVP host exposes a small JSON API used by the browser client:

- POST /api/start { seed, players } -> { setup, snapshot } (always a full snapshot)
- GET /api/snapshot -> { snapshot } (full snapshot)
- POST /api/command { command } -> { result, snapshot }
- POST /api/advance-many { ticks } -> { acceptedTicks, stoppedReason, snapshot } (ticks clamped to 1..500, stops when the phase leaves "wave")

### Lite snapshots

A full snapshot is about 130 KB because it repeats the static map, the entire
event history, and all completed-wave telemetry on every response. The client
polls and advances many times per second, so GET /api/snapshot, POST
/api/command and POST /api/advance-many accept lite options:

- Query string for GET: `?lite=1&eventsSince=<n>`
- JSON body fields for POST: `lite: true`, `eventsSince: <n>`

When `lite` is set the response snapshot differs from the full shape as follows:

- `map.cells` is omitted. `map` carries `width`, `height`, `seed`, `spawn: { x, y }`
  (the monster cave, also present in full snapshots) and
  `wornCells: [{ x, y, pathWear }]` (only cells whose pathWear is above 0).
  Cell layout is a pure function of (seed, width, height); clients fetch it once
  with a full snapshot and cache it by that key.
- `events` contains only events from index `eventsSince` onwards (default 0) and
  `eventsOffset` is set to that index, so the client can append and keep its own
  history. `eventsTotal` is the full event count.
- `telemetry.completedWaves` and `balanceAnalysisExports` are emptied (they are
  analysis data, not needed for presentation).

All other fields (phase, wave, waveTick, towers, walls, creatures, players,
winnerId, endReason, ...) are identical to the full snapshot. Non-lite requests
are unchanged, so existing tools and tests keep working. Simulation state and
determinism are not affected; lite is a serialization concern of the host only.

## Realtime command contracts

- placeTower { tileX, tileY, towerType }
- placeWall { tileX, tileY, wallType }
- moveTower { towerId, x, y } (once per player, unlocked after 5 completed rounds, prep phase only and before the player is ready; accepted moves emit a `tower-moved` event)
- upgradeTower { towerId, track } where track is `range`, `damage` or `accuracy` (prep phase only, rejected once the player is ready or during the wave)
- setDamageType { towerId, damageType } where damageType is `physical`, `explosive` or `magic` (prep phase only, rejected once the player is ready; wire command `set-damage-type`)
- setTargetMode { towerId, mode }
- readyForWave { ready: boolean } (`allPlayersReadyForWave` excludes eliminated players)
- setPlayerName { playerName }

## Server event contracts

- matchSnapshot
- entitySpawned
- entityUpdated
- entityRemoved
- waveStarted
- waveEnded
- resourceChanged
- pointsChanged
- towerDamaged
- towerDestroyed
- towersAutoRepaired
- commandRejected
- matchEnded

## Damage type data

- Snapshot `towers[].damageType` is the tower's `DamageType` (`physical` | `explosive` | `magic`)
- `tower-hit.damage` is the damage after the creature's multiplier; telemetry `towerDamageDealt` sums the same value
- `tower-hit` also carries `damageType` so clients can tint the shot without looking up the tower

## Error strategy

- Command-level rejection with machine-readable reason codes
- Non-fatal validation errors do not disconnect by default
- Fatal protocol violations can disconnect with explicit reason

Common rejection reasons:
- PLAYER_LIMIT_REACHED
- INVALID_PLAYER_NAME
- TOWER_ALREADY_PLACED
- TOWER_MOVE_NOT_ALLOWED
- PATH_BLOCKED
- SPAWN_PROTECTED (tower or wall inside the monster cave's protected area; wire code `spawn-protected`)
- INSUFFICIENT_POINTS
- TOWER_MAX_LEVEL (upgrade track at max level; wire code `tower-max-level`)
- INVALID_UPGRADE_TRACK (wire code `invalid-upgrade-track`)
- DAMAGE_TYPE_PHASE_NOT_ACTIVE, INVALID_DAMAGE_TYPE_TARGET, INVALID_DAMAGE_TYPE (wire codes `damage-type-phase-not-active`, `invalid-damage-type-target`, `invalid-damage-type`)
- TOWER_MOVE_LOCKED, TOWER_MOVE_USED, MOVE_PHASE_NOT_ACTIVE, INVALID_MOVE_TARGET (wire codes `tower-move-locked`, `tower-move-used`, `move-phase-not-active`, `invalid-move-target`; the target cell itself is judged by the normal placement reasons)

Transport-level validation (host API, before the simulation sees a command or setup). These are structured errors `{ ok: false, error: <code>, message }` with HTTP 400 and never end the session:
- `invalid-json`: the request body is not valid JSON
- `invalid-command`: missing or unsupported command, non-string ids, a missing or unknown `upgrade-tower` `track`, an unknown `set-target-mode` mode (never coerced to `first`), or an unknown `set-damage-type` `damageType` (never coerced to `physical`)
- `invalid-coordinates`: `place-tower` / `place-wall` `x`/`y` are not finite integers. Integers outside the map are a normal command rejection with reason `out-of-bounds` (HTTP 200, `result.accepted = false`), decided by the simulation
- `invalid-setup`: player count outside 1..8, duplicate player IDs (rejected, not de-duplicated), a name longer than `MAX_PLAYER_NAME_LENGTH` (24 characters), or a seed that is present but not a finite integer. A missing seed uses the documented default 777. Blank player names get `Player N`. The client never sends an empty or non-integer seed and also treats `ok: false` in a 200 body as an error
- CORS: the Node server answers cross-origin requests with `Access-Control-Allow-Origin: *` and handles `OPTIONS` preflight (it is a local, unauthenticated dev host)

## Contract versioning

- Include protocolVersion in handshake
- Backward compatibility window for one minor version

## Online patchability note

All commands and events should stay transport-agnostic so local and online modes can share identical game logic.
