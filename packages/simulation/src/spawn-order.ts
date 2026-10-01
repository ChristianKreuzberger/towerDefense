import { isInSpawnProtection } from "@tower-defense/shared";

import { generateMap } from "./procedural-map.js";

// Towers have a limited range, so callers that need a tower to actually fire want candidate cells
// ordered by distance to the monster cave where creatures spawn.
export function getBuildableCellsNearSpawn(seed: number): Array<{ x: number; y: number }> {
  const map = generateMap(seed);
  const spawn = map.spawn;
  if (!spawn) {
    throw new Error("expected the map to have a monster cave");
  }

  // Cells inside the cave's protected area can never hold a tower, so they are not candidates.
  return map.cells
    .filter((cell) => cell.buildable && !isInSpawnProtection(map, cell.x, cell.y))
    .map((cell) => ({ x: cell.x, y: cell.y, distance: Math.hypot(cell.x - spawn.x, cell.y - spawn.y) }))
    .sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)
    .map(({ x, y }) => ({ x, y }));
}
