import { TOWER_TYPES, TOWER_TYPE_STATS, TICKS_PER_SECOND, type TowerType } from "@tower-defense/shared";

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
