import { generateMap } from "./procedural-map.js";

// Towers have a limited range, so callers that need a tower to actually fire want candidate spots
// ordered by distance to the monster cave where creatures spawn.
export function getTowerSpotsNearSpawn(seed: number): Array<{ x: number; y: number }> {
  const map = generateMap(seed);
  const spawn = map.spawn;
  if (!spawn) {
    throw new Error("expected the map to have a monster cave");
  }

  return map.towerSpots
    .map((spot) => ({ x: spot.x, y: spot.y, distance: Math.hypot(spot.x - spawn.x, spot.y - spawn.y) }))
    .sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)
    .map(({ x, y }) => ({ x, y }));
}
