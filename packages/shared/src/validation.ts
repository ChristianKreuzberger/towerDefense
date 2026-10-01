import { getMapCell, isInSpawnProtection, type GameMap } from "./map-types.js";
import { TOWER_TARGET_MODES, UPGRADE_TRACKS, type Tower, type TowerTargetMode, type UpgradeTrack } from "./tower-types.js";
import type { Wall } from "./wall-types.js";
import type { TowerPlacement, CommandRejectReason } from "./match-types.js";
import {
  BASE_WALL_COST,
  WALL_COST_GROWTH
} from "./game-rules.js";

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

  // Creatures only enter through the cave, so the route must start there when the map has one.
  const startRows = map.spawn ? [map.spawn.y] : Array.from({ length: map.height }, (_, y) => y);
  for (const y of startRows) {
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
      // Creatures only enter through the cave, so on maps with one it is the only seed; border seeding is the cave-less fallback.
      const isSeed = map.spawn
        ? x === map.spawn.x && y === map.spawn.y
        : x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
      if (!isSeed) {
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

// Shared by tower and wall placement so both enforce the same rule: keep a left-to-right
// route open and never cut off a tower that creatures could reach before.
function checkPlacementPathSafety(
  placement: { x: number; y: number },
  blockedBefore: Set<string>,
  existingTowers: Tower[],
  map: GameMap
): PathSafetyCheckResult {
  const buildable = toBuildableSet(map);

  // Border reachability alone would let a placement cut the only left-to-right lane (creatures then fall back to a one-cell route).
  const blockedAfter = new Set(blockedBefore);
  blockedAfter.add(toKey(placement.x, placement.y));
  if (hasLeftToRightPath(map, blockedBefore, buildable) && !hasLeftToRightPath(map, blockedAfter, buildable)) {
    return { safe: false, reason: "path-blocked" };
  }

  const reachableBefore = getBorderReachableCells(map, blockedBefore, buildable);
  const towerReachabilityBefore = getReachabilityByTower(
    existingTowers,
    reachableBefore,
    blockedBefore,
    buildable,
    map
  );

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

export function validatePathSafety(
  placement: TowerPlacement,
  existingTowers: Tower[],
  map: GameMap
): PathSafetyCheckResult {
  const blockedBefore = new Set<string>();
  for (const tower of existingTowers) {
    blockedBefore.add(toKey(tower.x, tower.y));
  }

  return checkPlacementPathSafety(placement, blockedBefore, existingTowers, map);
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

  const blockedBefore = new Set<string>();
  for (const wall of existingWalls) {
    blockedBefore.add(toKey(wall.x, wall.y));
  }
  for (const tower of existingTowers) {
    blockedBefore.add(toKey(tower.x, tower.y));
  }

  return checkPlacementPathSafety(placement, blockedBefore, existingTowers, map);
}

export function getWallCost(existingWallCount: number): number {
  return Math.floor(BASE_WALL_COST * WALL_COST_GROWTH ** existingWallCount);
}

export function isValidTowerUpgradeTarget(
  towerId: string,
  playerId: string,
  existingTowers: Tower[]
): boolean {
  const tower = existingTowers.find((entry) => entry.id === towerId);
  return tower ? tower.playerId === playerId : false;
}

export function isValidUpgradeTrack(track: unknown): track is UpgradeTrack {
  return typeof track === "string" && (UPGRADE_TRACKS as readonly string[]).includes(track);
}

export function isValidTowerTargetMode(mode: string): mode is TowerTargetMode {
  return (TOWER_TARGET_MODES as readonly string[]).includes(mode);
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

  if (isInSpawnProtection(map, placement.x, placement.y)) {
    return { valid: false, reason: "spawn-protected" };
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

  if (isInSpawnProtection(map, placement.x, placement.y)) {
    return { valid: false, reason: "spawn-protected" };
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
