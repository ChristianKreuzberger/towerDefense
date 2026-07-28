import { getMapCell, type GameMap } from "./map-types.js";
import type { Tower } from "./tower-types.js";
import type { Wall } from "./wall-types.js";
import type { TowerPlacement, CommandRejectReason } from "./match-types.js";
import { BASE_WALL_COST, WALL_COST_GROWTH } from "./game-rules.js";

export interface TowerPlacementValidationResult {
  valid: boolean;
  reason?: CommandRejectReason;
}

export interface PathSafetyCheckResult {
  safe: boolean;
  reason?: CommandRejectReason;
}

export interface WallPlacement {
  playerId: string;
  x: number;
  y: number;
}

function toKey(x: number, y: number): string {
  return `${x},${y}`;
}

function toBuildableSet(map: GameMap): Set<string> {
  const buildable = new Set<string>();
  for (const cell of map.cells) {
    if (cell.buildable) {
      buildable.add(toKey(cell.x, cell.y));
    }
  }
  return buildable;
}

function hasLeftToRightPath(map: GameMap, occupied: Set<string>, buildable: Set<string>): boolean {
  if (map.width <= 0 || map.height <= 0) {
    return false;
  }

  const queue: Array<{ x: number; y: number }> = [];
  const visited = new Set<string>();

  for (let y = 0; y < map.height; y += 1) {
    const key = toKey(0, y);
    if (buildable.has(key) && !occupied.has(key)) {
      queue.push({ x: 0, y });
      visited.add(key);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }

    if (current.x === map.width - 1) {
      return true;
    }

    const neighbors = [
      { x: current.x, y: current.y - 1 },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x - 1, y: current.y }
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x < 0 || neighbor.x >= map.width || neighbor.y < 0 || neighbor.y >= map.height) {
        continue;
      }

      const key = toKey(neighbor.x, neighbor.y);
      if (visited.has(key) || !buildable.has(key) || occupied.has(key)) {
        continue;
      }

      visited.add(key);
      queue.push(neighbor);
    }
  }

  return false;
}

function getBorderReachableCells(
  map: GameMap,
  blocked: Set<string>,
  buildable: Set<string>
): Set<string> {
  const queue: Array<{ x: number; y: number }> = [];
  const visited = new Set<string>();

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const isBorder = x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
      if (!isBorder) {
        continue;
      }

      const key = toKey(x, y);
      if (buildable.has(key) && !blocked.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push({ x, y });
      }
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }

    const neighbors = [
      { x: current.x, y: current.y - 1 },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x - 1, y: current.y }
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x < 0 || neighbor.x >= map.width || neighbor.y < 0 || neighbor.y >= map.height) {
        continue;
      }

      const key = toKey(neighbor.x, neighbor.y);
      if (visited.has(key) || blocked.has(key) || !buildable.has(key)) {
        continue;
      }

      visited.add(key);
      queue.push(neighbor);
    }
  }

  return visited;
}

function canReachTower(
  tower: Tower,
  reachable: Set<string>,
  blocked: Set<string>,
  buildable: Set<string>,
  map: GameMap
): boolean {
  const adjacent = [
    { x: tower.x, y: tower.y - 1 },
    { x: tower.x + 1, y: tower.y },
    { x: tower.x, y: tower.y + 1 },
    { x: tower.x - 1, y: tower.y }
  ];

  return adjacent.some((cell) => {
    if (cell.x < 0 || cell.x >= map.width || cell.y < 0 || cell.y >= map.height) {
      return false;
    }

    const key = toKey(cell.x, cell.y);
    return buildable.has(key) && !blocked.has(key) && reachable.has(key);
  });
}

function getReachabilityByTower(
  towers: Tower[],
  reachable: Set<string>,
  blocked: Set<string>,
  buildable: Set<string>,
  map: GameMap
): Map<string, boolean> {
  const reachability = new Map<string, boolean>();
  for (const tower of towers) {
    reachability.set(tower.id, canReachTower(tower, reachable, blocked, buildable, map));
  }
  return reachability;
}

export function validatePathSafety(
  placement: TowerPlacement,
  existingTowers: Tower[],
  map: GameMap
): PathSafetyCheckResult {
  const buildable = toBuildableSet(map);

  const occupiedBefore = new Set<string>();
  for (const tower of existingTowers) {
    occupiedBefore.add(toKey(tower.x, tower.y));
  }

  const pathBefore = hasLeftToRightPath(map, occupiedBefore, buildable);
  const occupiedAfter = new Set(occupiedBefore);
  occupiedAfter.add(toKey(placement.x, placement.y));
  const pathAfter = hasLeftToRightPath(map, occupiedAfter, buildable);

  if (pathBefore && !pathAfter) {
    return { safe: false, reason: "path-blocked" };
  }

  return { safe: true };
}

function validateWallPathSafety(
  placement: WallPlacement,
  existingWalls: Wall[],
  existingTowers: Tower[],
  map: GameMap
): PathSafetyCheckResult {
  if (existingTowers.length === 0) {
    return { safe: true };
  }

  const buildable = toBuildableSet(map);

  const blockedBefore = new Set<string>();
  for (const wall of existingWalls) {
    blockedBefore.add(toKey(wall.x, wall.y));
  }
  for (const tower of existingTowers) {
    blockedBefore.add(toKey(tower.x, tower.y));
  }

  const reachableBefore = getBorderReachableCells(map, blockedBefore, buildable);
  const towerReachabilityBefore = getReachabilityByTower(
    existingTowers,
    reachableBefore,
    blockedBefore,
    buildable,
    map
  );

  const blockedAfter = new Set(blockedBefore);
  blockedAfter.add(toKey(placement.x, placement.y));
  const reachableAfter = getBorderReachableCells(map, blockedAfter, buildable);
  const towerReachabilityAfter = getReachabilityByTower(
    existingTowers,
    reachableAfter,
    blockedAfter,
    buildable,
    map
  );

  for (const tower of existingTowers) {
    const reachableBeforeTower = towerReachabilityBefore.get(tower.id) ?? false;
    const reachableAfterTower = towerReachabilityAfter.get(tower.id) ?? false;
    if (reachableBeforeTower && !reachableAfterTower) {
      return { safe: false, reason: "path-blocked" };
    }
  }

  return { safe: true };
}

export function getWallCost(existingWallCount: number): number {
  return Math.floor(BASE_WALL_COST * WALL_COST_GROWTH ** existingWallCount);
}

export function isValidWallPlacement(
  placement: WallPlacement,
  existingWalls: Wall[],
  existingTowers: Tower[],
  map: GameMap
): TowerPlacementValidationResult {
  const cell = getMapCell(map, placement.x, placement.y);
  if (!cell) {
    return { valid: false, reason: "out-of-bounds" };
  }

  if (!cell.buildable) {
    return { valid: false, reason: "cell-not-buildable" };
  }

  const towerOverlap = existingTowers.some((tower) => tower.x === placement.x && tower.y === placement.y);
  if (towerOverlap) {
    return { valid: false, reason: "tower-overlap" };
  }

  const wallOverlap = existingWalls.some((wall) => wall.x === placement.x && wall.y === placement.y);
  if (wallOverlap) {
    return { valid: false, reason: "wall-overlap" };
  }

  const pathSafety = validateWallPathSafety(placement, existingWalls, existingTowers, map);
  if (!pathSafety.safe) {
    return pathSafety.reason
      ? { valid: false, reason: pathSafety.reason }
      : { valid: false, reason: "path-blocked" };
  }

  return { valid: true };
}

export function isValidTowerPlacement(
  placement: TowerPlacement,
  existingTowers: Tower[],
  map: GameMap
): TowerPlacementValidationResult {
  const cell = getMapCell(map, placement.x, placement.y);
  if (!cell) {
    return { valid: false, reason: "out-of-bounds" };
  }

  if (!cell.buildable) {
    return { valid: false, reason: "cell-not-buildable" };
  }

  const overlap = existingTowers.some((tower) => tower.x === placement.x && tower.y === placement.y);
  if (overlap) {
    return { valid: false, reason: "tower-overlap" };
  }

  const pathSafety = validatePathSafety(placement, existingTowers, map);
  if (!pathSafety.safe) {
    return pathSafety.reason
      ? { valid: false, reason: pathSafety.reason }
      : { valid: false, reason: "path-blocked" };
  }

  return { valid: true };
}
