# 04 Technical Architecture

## Proposed stack

- Client MVP: TypeScript + Vite with DOM/CSS presentation
- Client future presentation upgrade: Phaser 3 + TypeScript + Vite
- Simulation host: Node.js + TypeScript
- Future online adapter: Colyseus (not enabled in MVP)
- Shared package: game constants, DTOs, validation schemas, deterministic formulas
- Database: PostgreSQL
- Optional cache/session: Redis

## Repository structure

- apps/client
- apps/server
- packages/shared
- packages/simulation
- packages/transport
- spec

## Runtime boundaries

- Client handles menu, presentation, input, and local split-player controls
- Simulation core owns authoritative game state in offline MVP
- Transport adapter boundary allows online mode to be added later
- Shared package prevents drift in formulas and types

## Build tools

- Client dev/build: Vite
- Server dev: tsx
- Server production build: tsup or esbuild

## Configuration

- Environment variables per app
- Strict schema validation for env at startup
- Separate dev, staging, and production configs

## Observability

- Structured logging (pino)
- Match lifecycle logs (room create, wave start, wave end)
- Error tracking hook points for both client and server

## Performance targets

- Support up to 8 players and 300 active creatures in MVP
- Keep server tick processing under 16 ms budget at normal load

## Product constraints reflected in architecture

- One fixed tower per player after placement
- Tower-vs-tower combat disabled in simulation rules
- Procedural map generation runs before mandatory initial tower placement
- Round transition pipeline includes automatic tower repair and UI event emission

## MVP presentation decision

The current offline MVP uses a DOM/CSS client because it supports the required
menu, placement, wave, repair, and end-of-match flows with deterministic browser
smoke coverage. Phaser 3 remains the planned post-kickoff presentation upgrade
for richer battlefield rendering and effects; migrating the client is not
required for the current simulation or offline acceptance gates.
