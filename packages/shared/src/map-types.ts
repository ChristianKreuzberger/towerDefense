import { SPAWN_PROTECTION_RADIUS } from "./game-rules.js";

export interface MapCell {
  x: number;
  y: number;
  buildable: boolean;
  pathWear: number;
}

export interface GameMap {
  width: number;
  height: number;
  seed: number;
  cells: MapCell[];
  // Monster cave on the left edge; optional so hand-built test maps need no cave.
  spawn?: { x: number; y: number };
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
