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

export const TOWER_TYPES = ["arrow", "cannon", "frost"] as const;
export type TowerType = (typeof TOWER_TYPES)[number];
export const DEFAULT_TOWER_TYPE: TowerType = "arrow";

export interface TowerTypeStats {
  // Level 1 values; upgrades add the same per-level steps for every type (game-rules.ts).
  baseRange: number;
  baseAccuracy: number;
  // The tower fires on ticks where waveTick % fireEveryTicks === 0 (stateless, so no extra RNG draws).
  fireEveryTicks: number;
  // Damage per shot = max(1, round(damage level * damageScale)).
  damageScale: number;
  // Splash: other creatures within splashRadius cells of the target take max(1, round(main damage * splashFactor)). 0 = none.
  splashRadius: number;
  splashFactor: number;
  // Slow: a hit slows the creature to slowSpeedFactor of its speed for slowBaseTicks + damage level ticks. 0 ticks = none.
  slowSpeedFactor: number;
  slowBaseTicks: number;
}

// Data, not simulation logic (spec/02 and spec/06). Arrow equals the original single tower.
export const TOWER_TYPE_STATS: Record<TowerType, TowerTypeStats> = {
  arrow: { baseRange: 6, baseAccuracy: 0.7, fireEveryTicks: 1, damageScale: 1, splashRadius: 0, splashFactor: 0, slowSpeedFactor: 1, slowBaseTicks: 0 },
  cannon: { baseRange: 5, baseAccuracy: 0.6, fireEveryTicks: 2, damageScale: 2, splashRadius: 1.5, splashFactor: 0.5, slowSpeedFactor: 1, slowBaseTicks: 0 },
  frost: { baseRange: 6, baseAccuracy: 0.8, fireEveryTicks: 1, damageScale: 0.5, splashRadius: 0, splashFactor: 0, slowSpeedFactor: 0.6, slowBaseTicks: 2 }
};

// A slowed creature never drops below this many movement units per tick.
export const SLOW_MIN_SPEED_UNITS = 20;

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
  // Chosen at placement and fixed for the life of the tower.
  towerType: TowerType;
}
