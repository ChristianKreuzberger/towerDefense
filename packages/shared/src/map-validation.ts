import { PATH_CELL_MAX_WEAR } from "./game-rules.js";
import { MAP_SCHEMA_VERSION, isInSpawnProtection, type GameMap } from "./map-types.js";

export type MapValidationErrorCode =
  | "unsupported-schema-version"
  | "invalid-dimensions"
  | "cell-count-mismatch"
  | "cell-out-of-bounds"
  | "invalid-cell"
  | "duplicate-cell"
  | "spawn-missing"
  | "spawn-not-on-left-edge"
  | "spawn-not-buildable"
  | "goal-missing"
  | "goal-not-on-right-edge"
  | "goal-not-buildable"
  | "goal-unreachable";

export interface MapValidationError {
  code: MapValidationErrorCode;
  message: string;
}

const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [MAP_SCHEMA_VERSION];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

// Shortest walkable route from the cave to the goal (cells in order), or undefined when there is none.
function findRoute(map: GameMap, buildable: Set<string>): Array<{ x: number; y: number }> | undefined {
  const { spawn, goal } = map;
  if (!spawn || !goal || !buildable.has(key(spawn.x, spawn.y)) || !buildable.has(key(goal.x, goal.y))) {
    return undefined;
  }

  const parent = new Map<string, string | undefined>([[key(spawn.x, spawn.y), undefined]]);
  const queue = [{ x: spawn.x, y: spawn.y }];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }
    if (current.x === goal.x && current.y === goal.y) {
      const route: Array<{ x: number; y: number }> = [];
      let cursor: string | undefined = key(current.x, current.y);
      while (cursor) {
        const [x, y] = cursor.split(",").map(Number) as [number, number];
        route.push({ x, y });
        cursor = parent.get(cursor);
      }
      return route.reverse();
    }
    for (const next of [
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
      { x: current.x - 1, y: current.y }
    ]) {
      const nextKey = key(next.x, next.y);
      if (buildable.has(nextKey) && !parent.has(nextKey)) {
        parent.set(nextKey, key(current.x, current.y));
        queue.push(next);
      }
    }
  }
  return undefined;
}

// Checks a map before a match starts. An empty list means the map is valid.
export function validateGameMap(map: GameMap): MapValidationError[] {
  const errors: MapValidationError[] = [];
  const add = (code: MapValidationErrorCode, message: string): void => {
    errors.push({ code, message });
  };

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(map.schemaVersion)) {
    add("unsupported-schema-version", `schemaVersion ${String(map.schemaVersion)} is not supported`);
  }

  if (!Array.isArray(map.cells)) {
    // Nothing below can run without a list of cells.
    add("cell-count-mismatch", "cells must be an array");
    return errors;
  }

  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width <= 0 || map.height <= 0) {
    add("invalid-dimensions", `width and height must be positive integers, got ${map.width}x${map.height}`);
  } else if (map.cells.length !== map.width * map.height) {
    add("cell-count-mismatch", `expected ${map.width * map.height} cells, got ${map.cells.length}`);
  }

  const buildable = new Set<string>();
  const seen = new Set<string>();
  for (const cell of map.cells) {
    if (
      !Number.isInteger(cell.x) || !Number.isInteger(cell.y)
      || cell.x < 0 || cell.y < 0 || cell.x >= map.width || cell.y >= map.height
    ) {
      add("cell-out-of-bounds", `cell ${key(cell.x, cell.y)} is not a whole-number position inside the grid`);
      continue;
    }
    if (
      typeof cell.buildable !== "boolean"
      || typeof cell.pathWear !== "number" || !Number.isFinite(cell.pathWear)
      || cell.pathWear < 0 || cell.pathWear > PATH_CELL_MAX_WEAR
    ) {
      add("invalid-cell", `cell ${key(cell.x, cell.y)} needs a boolean buildable and a pathWear from 0 to ${PATH_CELL_MAX_WEAR}`);
      continue;
    }
    if (seen.has(key(cell.x, cell.y))) {
      add("duplicate-cell", `cell ${key(cell.x, cell.y)} appears more than once`);
      continue;
    }
    seen.add(key(cell.x, cell.y));
    if (cell.buildable) {
      buildable.add(key(cell.x, cell.y));
    }
  }

  const { spawn, goal } = map;
  if (!spawn) {
    add("spawn-missing", "map has no spawn");
  } else {
    if (spawn.x !== 0) {
      add("spawn-not-on-left-edge", `spawn ${key(spawn.x, spawn.y)} must have x = 0`);
    }
    if (!buildable.has(key(spawn.x, spawn.y))) {
      add("spawn-not-buildable", `spawn ${key(spawn.x, spawn.y)} is not a buildable cell`);
    }
  }
  if (!goal) {
    add("goal-missing", "map has no goal");
  } else {
    if (goal.x !== map.width - 1) {
      add("goal-not-on-right-edge", `goal ${key(goal.x, goal.y)} must have x = ${map.width - 1}`);
    }
    if (!buildable.has(key(goal.x, goal.y))) {
      add("goal-not-buildable", `goal ${key(goal.x, goal.y)} is not a buildable cell`);
    }
  }

  // Only worth reporting once spawn and goal themselves are usable.
  if (spawn && goal && buildable.has(key(spawn.x, spawn.y)) && buildable.has(key(goal.x, goal.y))) {
    if (!findRoute(map, buildable)) {
      add("goal-unreachable", "the goal cannot be reached from the spawn over buildable cells");
    }
  }

  return errors;
}

// Tower pads: buildable cells outside the cave's protected area that creatures can never walk to (no buildable
// path from the spawn). A tower on a pad cannot cut the lane or any other tower's access, so pads can always be
// filled in any combination. Sorted by row then column so the result is deterministic.
export function findTowerSites(map: GameMap): Array<{ x: number; y: number }> {
  const { spawn } = map;
  if (!spawn) {
    return [];
  }
  const buildable = new Set(map.cells.filter((cell) => cell.buildable).map((cell) => key(cell.x, cell.y)));
  const walkable = new Set<string>();
  const queue: Array<{ x: number; y: number }> = [];
  if (buildable.has(key(spawn.x, spawn.y))) {
    walkable.add(key(spawn.x, spawn.y));
    queue.push({ x: spawn.x, y: spawn.y });
  }
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }
    for (const next of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 }
    ]) {
      const nextKey = key(next.x, next.y);
      if (buildable.has(nextKey) && !walkable.has(nextKey)) {
        walkable.add(nextKey);
        queue.push(next);
      }
    }
  }
  return map.cells
    .filter((cell) => cell.buildable && !walkable.has(key(cell.x, cell.y)) && !isInSpawnProtection(map, cell.x, cell.y))
    .map((cell) => ({ x: cell.x, y: cell.y }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}
