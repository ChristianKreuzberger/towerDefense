import type { TowerUpgrades, UpgradeTrack } from "./tower-types.js";

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
// Names are shown in the HUD and the end screen; the cap keeps those layouts intact.
export const MAX_PLAYER_NAME_LENGTH = 24;
export const WIN_SCORE = 1000;
export const DEFAULT_MAP_WIDTH = 50;
export const DEFAULT_MAP_HEIGHT = 50;
export const DEFAULT_TOWER_HEALTH = 100;
export const BUILDABLE_CELL_THRESHOLD = 0.3;
export const BASE_WALL_COST = 25;
export const WALL_COST_GROWTH = 1.2;
export const BETWEEN_WAVE_TOWER_REPAIR_PERCENT = 0.2;
export const BETWEEN_WAVE_TOWER_REPAIR_MIN = 5;
export const DEFAULT_WALL_HEALTH = 60;
export const BETWEEN_WAVE_WALL_REPAIR_PERCENT = 0.25;
export const BETWEEN_WAVE_WALL_REPAIR_MIN = 4;
export const PATH_CELL_MAX_WEAR = 8;
// Wear a lane cell gains each time a creature moves onto it during a wave.
export const PATH_WEAR_PER_TRAVERSAL = 1;
export const BETWEEN_WAVE_PATH_WEAR_REPAIR = 3;
export const MOVEMENT_PROGRESS_UNITS_PER_CELL = 100;
export const BASE_CREATURE_MOVEMENT_SPEED_UNITS = MOVEMENT_PROGRESS_UNITS_PER_CELL;
export const CREATURE_MOVEMENT_SPEED_PENALTY_PER_WEAR = 10;
export const MIN_CREATURE_MOVEMENT_SPEED_UNITS = 40;
export const WAVE_CLEAR_BONUS = 15;
// Cells (Euclidean) around the monster cave where towers and walls are forbidden. Slightly smaller than the base
// tower range (6), so towers just outside barely reach the cave exit, and nobody can wall in or point-blank the spawn.
export const SPAWN_PROTECTION_RADIUS = 5;
// Creatures cannot be targeted or damaged for this long after spawning, so nobody camps the cave exit.
export const CREATURE_SPAWN_PROTECTION_SECONDS = 1;
// The client runs 5 simulation ticks per second at 1x speed, and the simulation counts ticks, not seconds.
export const SPAWN_PROTECTION_TICKS = CREATURE_SPAWN_PROTECTION_SECONDS * 5;
export const BASE_TOWER_RANGE = 6;
export const TOWER_RANGE_PER_LEVEL = 1.5;
// Highest level of each upgrade track (spec/06). A default chosen with the economy spec.
export const MAX_TOWER_LEVEL = 5;
// Cost of an upgrade is floor(base * growth ** currentTrackLevel); damage is the strongest track, so the dearest.
export const UPGRADE_TRACK_COSTS = {
  range: { base: 40, growth: 1.6 },
  damage: { base: 60, growth: 1.6 },
  accuracy: { base: 30, growth: 1.5 }
} as const;
export const BASE_TOWER_ACCURACY = 0.7;
export const TOWER_ACCURACY_PER_LEVEL = 0.075;

export const GAME_RULES = {
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  maxPlayerNameLength: MAX_PLAYER_NAME_LENGTH,
  winScore: WIN_SCORE,
  towersPerPlayer: 1,
  mapWidth: DEFAULT_MAP_WIDTH,
  mapHeight: DEFAULT_MAP_HEIGHT,
  defaultTowerHealth: DEFAULT_TOWER_HEALTH,
  buildableCellThreshold: BUILDABLE_CELL_THRESHOLD,
  baseWallCost: BASE_WALL_COST,
  wallCostGrowth: WALL_COST_GROWTH,
  upgradeTrackCosts: UPGRADE_TRACK_COSTS,
  betweenWaveTowerRepairPercent: BETWEEN_WAVE_TOWER_REPAIR_PERCENT,
  betweenWaveTowerRepairMin: BETWEEN_WAVE_TOWER_REPAIR_MIN,
  defaultWallHealth: DEFAULT_WALL_HEALTH,
  betweenWaveWallRepairPercent: BETWEEN_WAVE_WALL_REPAIR_PERCENT,
  betweenWaveWallRepairMin: BETWEEN_WAVE_WALL_REPAIR_MIN,
  pathCellMaxWear: PATH_CELL_MAX_WEAR,
  pathWearPerTraversal: PATH_WEAR_PER_TRAVERSAL,
  betweenWavePathWearRepair: BETWEEN_WAVE_PATH_WEAR_REPAIR,
  movementProgressUnitsPerCell: MOVEMENT_PROGRESS_UNITS_PER_CELL,
  baseCreatureMovementSpeedUnits: BASE_CREATURE_MOVEMENT_SPEED_UNITS,
  creatureMovementSpeedPenaltyPerWear: CREATURE_MOVEMENT_SPEED_PENALTY_PER_WEAR,
  minCreatureMovementSpeedUnits: MIN_CREATURE_MOVEMENT_SPEED_UNITS,
  waveClearBonus: WAVE_CLEAR_BONUS,
  spawnProtectionRadius: SPAWN_PROTECTION_RADIUS,
  creatureSpawnProtectionSeconds: CREATURE_SPAWN_PROTECTION_SECONDS,
  spawnProtectionTicks: SPAWN_PROTECTION_TICKS,
  baseTowerRange: BASE_TOWER_RANGE,
  towerRangePerLevel: TOWER_RANGE_PER_LEVEL,
  maxTowerLevel: MAX_TOWER_LEVEL,
  baseTowerAccuracy: BASE_TOWER_ACCURACY,
  towerAccuracyPerLevel: TOWER_ACCURACY_PER_LEVEL
} as const;

export function getBetweenWaveTowerRepairAmount(maxHealth: number): number {
  return Math.max(
    BETWEEN_WAVE_TOWER_REPAIR_MIN,
    Math.floor(maxHealth * BETWEEN_WAVE_TOWER_REPAIR_PERCENT)
  );
}

export function getBetweenWaveWallRepairAmount(maxHealth: number): number {
  return Math.max(
    BETWEEN_WAVE_WALL_REPAIR_MIN,
    Math.floor(maxHealth * BETWEEN_WAVE_WALL_REPAIR_PERCENT)
  );
}

export function getCreatureMovementSpeedUnits(pathWear: number): number {
  const clampedWear = Math.max(0, Math.min(PATH_CELL_MAX_WEAR, pathWear));
  return Math.max(
    MIN_CREATURE_MOVEMENT_SPEED_UNITS,
    BASE_CREATURE_MOVEMENT_SPEED_UNITS - (clampedWear * CREATURE_MOVEMENT_SPEED_PENALTY_PER_WEAR)
  );
}

export function getWaveClearBonus(): number {
  return WAVE_CLEAR_BONUS;
}

// Range is measured in grid cells (Euclidean) and grows with each range level.
export function getTowerRange(rangeLevel: number): number {
  return BASE_TOWER_RANGE + (Math.max(1, rangeLevel) - 1) * TOWER_RANGE_PER_LEVEL;
}

// Simulation ticks per second of game time at 1x playback; towers fire once per tick.
export const TICKS_PER_SECOND = 5;

export function getTowerDamage(damageLevel: number): number {
  return Math.max(1, damageLevel);
}

// 0..1 chance that a shot hits; 100% at the max accuracy level.
export function getTowerAccuracy(accuracyLevel: number): number {
  const accuracy = BASE_TOWER_ACCURACY + (Math.max(1, accuracyLevel) - 1) * TOWER_ACCURACY_PER_LEVEL;
  return Math.min(1, Math.round(accuracy * 1000) / 1000);
}

export interface TowerStats {
  // Overall tier: 1 + upgrades bought across all tracks.
  level: number;
  upgrades: TowerUpgrades;
  range: number;
  damagePerShot: number;
  // Per second if every shot hit; multiply by accuracy for the expected value.
  damagePerSecond: number;
  accuracy: number;
}

export const BASE_TOWER_UPGRADES: TowerUpgrades = { range: 1, damage: 1, accuracy: 1 };

export function getTowerOverallLevel(upgrades: TowerUpgrades): number {
  return 1 + (upgrades.range - 1) + (upgrades.damage - 1) + (upgrades.accuracy - 1);
}

export function getTowerStats(upgrades: TowerUpgrades): TowerStats {
  const damagePerShot = getTowerDamage(upgrades.damage);
  return {
    level: getTowerOverallLevel(upgrades),
    upgrades,
    range: getTowerRange(upgrades.range),
    damagePerShot,
    damagePerSecond: damagePerShot * TICKS_PER_SECOND,
    accuracy: getTowerAccuracy(upgrades.accuracy)
  };
}

export function getTowerUpgradeCost(track: UpgradeTrack, currentTrackLevel: number): number {
  const { base, growth } = UPGRADE_TRACK_COSTS[track];
  return Math.floor(base * growth ** currentTrackLevel);
}
