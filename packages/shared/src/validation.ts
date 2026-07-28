import { getMapCell, type GameMap } from "./map-types.js";
import type { Tower } from "./tower-types.js";
import type { TowerPlacement, CommandRejectReason } from "./match-types.js";

export interface TowerPlacementValidationResult {
  valid: boolean;
  reason?: CommandRejectReason;
}

export interface PathSafetyCheckResult {
  safe: boolean;
  reason?: CommandRejectReason;
}

export function validatePathSafety(
  _placement: TowerPlacement,
  _existingTowers: Tower[],
  _map: GameMap
): PathSafetyCheckResult {
  return { safe: true };
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
