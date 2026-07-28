# 03 Multiplayer Networking

## Model

MVP runs offline in a single local process with an authoritative simulation core. Input adapters feed intents into the same command pipeline that future online transport will use.

## Deployment modes

- Mode A (MVP): local/offline session, no network dependency
- Mode B (future): online room sync over WebSocket
- Both modes share command validation and simulation modules

## Tick and sync

- Simulation tick: 20 to 30 Hz
- Client render: variable frame rate with interpolation
- Local state snapshots every N ticks plus event stream

## Client commands

- placeTower
- placeWall
- upgradeTower
- setTargetMode
- readyForWave
- pingMap

Each command includes playerId, matchId, local timestamp, and payload.

## Validation rules on server

- Player has permission in room
- Command references valid entity IDs
- Sufficient resources
- Placement legality and path viability
- Cooldown and anti-spam checks

## Reliability strategy

- Local mode uses in-process dispatch with command sequencing
- Future online mode uses WebSocket transport with ack and retry
- Sequence numbers are retained in both modes for deterministic replay/debug

## Reconnect and recovery

- MVP local mode has no reconnect requirement
- Future online mode target: reconnect grace period and full snapshot recovery

## Security concerns

- Never trust client-side gold, HP, cooldowns, or damage
- Rate limit command spam per connection
- Validate all map and command payloads with strict schemas

## Recommended library

Use a transport adapter interface now. Implement local adapter in MVP, then add Colyseus adapter later without changing core simulation rules.
