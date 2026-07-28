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
