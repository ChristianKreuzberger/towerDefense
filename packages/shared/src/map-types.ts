import { SPAWN_PROTECTION_RADIUS } from "./game-rules.js";

export interface MapCell {
  x: number;
  y: number;
  // Walkable road cell. Towers are never placed on these; see GameMap.towerSpots.
  buildable: boolean;
  pathWear: number;
}

// Bump when the map shape changes; validateGameMap rejects versions it does not know.
export const MAP_SCHEMA_VERSION = 2;

export interface GameMap {
  schemaVersion: number;
  width: number;
  height: number;
  seed: number;
  cells: MapCell[];
  // The only cells where towers may be placed (non-walkable cells beside the road).
  towerSpots: Array<{ x: number; y: number }>;
  // Monster cave on the left edge; optional so hand-built test maps need no cave.
  spawn?: { x: number; y: number };
  // Where the lane leaves the map on the right edge; optional for the same reason as spawn.
  goal?: { x: number; y: number };
}

export function getMapCell(map: GameMap, x: number, y: number): MapCell | undefined {
  return map.cells.find((cell) => cell.x === x && cell.y === y);
}

export function isInSpawnProtection(map: { spawn?: GameMap["spawn"] | undefined }, x: number, y: number): boolean {
  if (!map.spawn) {
    return false;
  }
  return Math.hypot(x - map.spawn.x, y - map.spawn.y) <= SPAWN_PROTECTION_RADIUS;
}

export function isTowerSpot(map: Pick<GameMap, "towerSpots">, x: number, y: number): boolean {
  return map.towerSpots.some((spot) => spot.x === x && spot.y === y);
}
