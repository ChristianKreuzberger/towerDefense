export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const WIN_SCORE = 1000;
export const DEFAULT_MAP_WIDTH = 12;
export const DEFAULT_MAP_HEIGHT = 12;
export const DEFAULT_TOWER_HEALTH = 100;
export const BUILDABLE_CELL_THRESHOLD = 0.3;
export const BASE_WALL_COST = 25;
export const WALL_COST_GROWTH = 1.2;
export const BASE_TOWER_UPGRADE_COST = 50;
export const TOWER_UPGRADE_COST_GROWTH = 1.6;
export const BETWEEN_WAVE_TOWER_REPAIR_PERCENT = 0.2;
export const BETWEEN_WAVE_TOWER_REPAIR_MIN = 5;
export const DEFAULT_WALL_HEALTH = 60;
export const BETWEEN_WAVE_WALL_REPAIR_PERCENT = 0.25;
export const BETWEEN_WAVE_WALL_REPAIR_MIN = 4;
export const PATH_CELL_MAX_WEAR = 8;
export const BETWEEN_WAVE_PATH_WEAR_REPAIR = 3;
export const MOVEMENT_PROGRESS_UNITS_PER_CELL = 100;
export const BASE_CREATURE_MOVEMENT_SPEED_UNITS = MOVEMENT_PROGRESS_UNITS_PER_CELL;
export const CREATURE_MOVEMENT_SPEED_PENALTY_PER_WEAR = 10;
export const MIN_CREATURE_MOVEMENT_SPEED_UNITS = 40;

export const GAME_RULES = {
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  winScore: WIN_SCORE,
  towersPerPlayer: 1,
  mapWidth: DEFAULT_MAP_WIDTH,
  mapHeight: DEFAULT_MAP_HEIGHT,
  defaultTowerHealth: DEFAULT_TOWER_HEALTH,
  buildableCellThreshold: BUILDABLE_CELL_THRESHOLD,
  baseWallCost: BASE_WALL_COST,
  wallCostGrowth: WALL_COST_GROWTH,
  baseTowerUpgradeCost: BASE_TOWER_UPGRADE_COST,
  towerUpgradeCostGrowth: TOWER_UPGRADE_COST_GROWTH,
  betweenWaveTowerRepairPercent: BETWEEN_WAVE_TOWER_REPAIR_PERCENT,
  betweenWaveTowerRepairMin: BETWEEN_WAVE_TOWER_REPAIR_MIN,
  defaultWallHealth: DEFAULT_WALL_HEALTH,
  betweenWaveWallRepairPercent: BETWEEN_WAVE_WALL_REPAIR_PERCENT,
  betweenWaveWallRepairMin: BETWEEN_WAVE_WALL_REPAIR_MIN,
  pathCellMaxWear: PATH_CELL_MAX_WEAR,
  betweenWavePathWearRepair: BETWEEN_WAVE_PATH_WEAR_REPAIR,
  movementProgressUnitsPerCell: MOVEMENT_PROGRESS_UNITS_PER_CELL,
  baseCreatureMovementSpeedUnits: BASE_CREATURE_MOVEMENT_SPEED_UNITS,
  creatureMovementSpeedPenaltyPerWear: CREATURE_MOVEMENT_SPEED_PENALTY_PER_WEAR,
  minCreatureMovementSpeedUnits: MIN_CREATURE_MOVEMENT_SPEED_UNITS
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
