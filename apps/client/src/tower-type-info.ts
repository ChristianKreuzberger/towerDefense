import { MAX_TOWER_LEVEL, TOWER_TYPES, TOWER_TYPE_STATS, TICKS_PER_SECOND, getTowerStats, type DamageType, type TowerType, type TowerUpgrades } from "@tower-defense/shared";

export const TOWER_TYPE_LABEL: Record<TowerType, string> = { arrow: "Arrow", cannon: "Cannon", frost: "Frost" };

// Colour of the small type marker on a tower (arrow gets none: it is the plain tower).
export const TOWER_TYPE_COLOR: Record<TowerType, number> = { arrow: 0xf3ead6, cannon: 0xff8a3d, frost: 0x7fd6ff };

// One line per type for the picker, built from the shared stats so the text cannot drift from the rules.
export function describeTowerType(type: TowerType): string {
  const stats = TOWER_TYPE_STATS[type];
  const accuracy = Math.round(stats.baseAccuracy * 100);
  const common = `range ${stats.baseRange}, ${accuracy}% accuracy`;
  if (type === "cannon") {
    return `Cannon: ${common}, fires every ${stats.fireEveryTicks} ticks for ${stats.damageScale}x damage; splash hits creatures near the target.`;
  }
  if (type === "frost") {
    return `Frost: ${common}, weaker shots that slow a creature to ${Math.round(stats.slowSpeedFactor * 100)}% speed.`;
  }
  return `Arrow: ${common}, one steady shot per tick (${TICKS_PER_SECOND} per second).`;
}

export const TOWER_TYPE_OPTIONS: readonly TowerType[] = TOWER_TYPES;

export interface TowerTooltipInput {
  upgrades: TowerUpgrades;
  towerType: TowerType;
  damageType: DamageType;
  hp: number;
  maxHp: number;
}

// Rows for the hover tooltip. Uses the tower's own type: arrow numbers would be wrong for a cannon or frost tower.
export function towerTooltipRows(tower: TowerTooltipInput): Array<[string, string]> {
  const stats = getTowerStats(tower.upgrades, tower.towerType);
  const typeStats = TOWER_TYPE_STATS[tower.towerType];
  const trackLevel = (level: number): string => `${level}/${MAX_TOWER_LEVEL}`;
  const rows: Array<[string, string]> = [
    ["Tower", TOWER_TYPE_LABEL[tower.towerType]],
    ["Level", String(stats.level)],
    ["Health", `${tower.hp}/${tower.maxHp}`],
    ["Range", `${stats.range} cells (${trackLevel(tower.upgrades.range)})`],
    ["Damage", `${stats.damagePerShot} per shot (${trackLevel(tower.upgrades.damage)})`],
    ["Type", tower.damageType],
    ["DPS", String(Math.round(stats.damagePerSecond * 10) / 10)],
    ["Accuracy", `${Math.round(stats.accuracy * 100)}% (${trackLevel(tower.upgrades.accuracy)})`]
  ];
  if (typeStats.splashRadius > 0) {
    rows.push(["Splash", `${Math.round(typeStats.splashFactor * 100)}% damage within ${typeStats.splashRadius} cells`]);
  }
  if (typeStats.slowBaseTicks > 0) {
    rows.push(["Slow", `to ${Math.round(typeStats.slowSpeedFactor * 100)}% speed for ${typeStats.slowBaseTicks + tower.upgrades.damage} ticks`]);
  }
  return rows;
}
