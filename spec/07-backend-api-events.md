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

- `map.cells` is omitted. `map` carries `width`, `height`, `seed` and
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
- upgradeTower { towerId }
- setTargetMode { towerId, mode }
- readyForWave { ready: boolean }
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
- INSUFFICIENT_POINTS

## Contract versioning

- Include protocolVersion in handshake
- Backward compatibility window for one minor version

## Online patchability note

All commands and events should stay transport-agnostic so local and online modes can share identical game logic.
