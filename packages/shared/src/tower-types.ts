export const TOWER_TARGET_MODES = ["first", "last", "strongest", "nearest"] as const;
export type TowerTargetMode = (typeof TOWER_TARGET_MODES)[number];
export const DEFAULT_TOWER_TARGET_MODE: TowerTargetMode = "first";

export const DAMAGE_TYPES = ["physical", "explosive", "magic"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
export const DEFAULT_DAMAGE_TYPE: DamageType = "physical";

export const UPGRADE_TRACKS = ["range", "damage", "accuracy"] as const;
export type UpgradeTrack = (typeof UPGRADE_TRACKS)[number];
// Level of each independent upgrade track, 1 (base) up to MAX_TOWER_LEVEL.
export type TowerUpgrades = Record<UpgradeTrack, number>;

export interface Tower {
  id: string;
  playerId: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  // Overall tier: 1 + the number of upgrades bought across all tracks. Drives the art, not the stats.
  level: number;
  upgrades: TowerUpgrades;
  targetMode: TowerTargetMode;
  damageType: DamageType;
}
