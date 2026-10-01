# 08 Data and Persistence

## MVP persistence scope

- Local player profile (display name)
- Match history summary
- Map catalog metadata
- Procedural map seeds used per match
- Client-local preferences in browser `localStorage` under `towerDefense.settings.v1`: `{ "version": 1, "effectsVolume": 0..1, "muted": boolean }`. Defaults are 0.7 and false. Parsing is field-wise: an invalid field falls back to its default without discarding valid ones. Unavailable or throwing storage is tolerated and the settings then live in memory only. Preferences are never sent to the server

## Suggested database tables

- local_players
- matches
- match_players
- maps
- map_versions

## What should not be persisted at MVP

- Full event replay stream (optional later)
- Deep progression trees
- Online account/auth data

## IDs and keys

- Use UUIDs for public entity identifiers
- Use createdAt and updatedAt timestamps on all core tables

## Offline to online migration plan

- Keep local player identity separate from future account identity
- Add optional accountId foreign key later without rewriting match history

## Privacy and security

- Store minimal personal data
- Hash auth secrets if account auth is added
- Keep server logs free from sensitive payloads
