export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const WIN_SCORE = 1000;
export const DEFAULT_MAP_WIDTH = 12;
export const DEFAULT_MAP_HEIGHT = 12;
export const DEFAULT_TOWER_HEALTH = 100;
export const BUILDABLE_CELL_THRESHOLD = 0.3;
export const BASE_WALL_COST = 25;
export const WALL_COST_GROWTH = 1.2;

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
  wallCostGrowth: WALL_COST_GROWTH
} as const;
