import { createMatch } from "./match-simulation.js";
import { generateMap } from "./procedural-map.js";

// Towers have a limited range, so callers that need a tower to actually fire want candidate cells
// ordered by distance to where creatures spawn. The spawn point is read from a real probe match
// instead of assuming where the gate is.
export function getBuildableCellsNearSpawn(seed: number): Array<{ x: number; y: number }> {
  const buildable = generateMap(seed).cells.filter((entry) => entry.buildable);
  const first = buildable[0];
  if (!first) {
    throw new Error("expected at least one buildable cell");
  }

  const probe = createMatch({ players: [{ id: "p1", name: "Probe" }], seed });
  probe.applyCommand({ type: "place-tower", playerId: "p1", x: first.x, y: first.y });
  probe.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  probe.applyCommand({ type: "advance-wave" });
  const spawn = probe.getSnapshot().creatures[0];
  if (!spawn) {
    throw new Error("expected a spawned creature");
  }

  return buildable
    .filter((cell) => cell.x !== spawn.x || cell.y !== spawn.y)
    .map((cell) => ({ x: cell.x, y: cell.y, distance: Math.hypot(cell.x - spawn.x, cell.y - spawn.y) }))
    .sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x)
    .map(({ x, y }) => ({ x, y }));
}
