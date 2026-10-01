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

### Input validation and errors

The host validates input and rejects bad values instead of coercing them. Every
rejected request returns HTTP 400 with `{ ok: false, error, message }`:

- `invalid-json`: the body is not valid JSON.
- `invalid-setup`: /api/start with a player count outside 1..8 or duplicate player ids.
- `invalid-seed`: /api/start with a `seed` that is not a finite integer (omitted defaults to 777).
- `invalid-command`: missing or malformed `command`, or an unsupported command type.
- `invalid-coordinates`: place-tower / place-wall `x`/`y` that are not integers inside the map.
- `invalid-target-mode`: set-target-mode `mode` not one of first, last, strongest, nearest.
- `match-not-started`, `not-found`: as before.

Game-rule rejections (for example `tower-already-placed`) are unchanged: they
return 200 with `result.accepted: false`.

### CORS

All responses carry `Access-Control-Allow-Origin: *` and OPTIONS requests are
answered with 204 plus the allowed methods and headers, so a client served from
another origin (for example Vite dev with `VITE_API_BASE_URL`) can call the API.
This is meant for the local offline host only; revisit before any online mode.

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
