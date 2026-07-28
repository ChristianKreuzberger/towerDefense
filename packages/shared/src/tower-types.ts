export const TOWER_TARGET_MODES = ["first", "last", "strongest", "nearest"] as const;
export type TowerTargetMode = (typeof TOWER_TARGET_MODES)[number];
export const DEFAULT_TOWER_TARGET_MODE: TowerTargetMode = "first";

export interface Tower {
  id: string;
  playerId: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  level: number;
  targetMode: TowerTargetMode;
}
