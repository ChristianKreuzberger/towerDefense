import { DAMAGE_TYPES, type DamageType } from "./tower-types.js";

export type CreatureArchetype = "runner" | "tank" | "armored" | "swarm";

export interface CreatureArchetypeStats {
  hp: number;
  rewardPoints: number;
  attackDamage: number;
  // Cells. Reach of the attack; towers further away are safe from this archetype.
  attackRange: number;
}

export const CREATURE_ARCHETYPE_STATS: Record<CreatureArchetype, CreatureArchetypeStats> = {
  runner: { hp: 3, rewardPoints: 10, attackDamage: 1, attackRange: 2.5 },
  swarm: { hp: 2, rewardPoints: 8, attackDamage: 1, attackRange: 2.5 },
  armored: { hp: 5, rewardPoints: 14, attackDamage: 2, attackRange: 3.5 },
  tank: { hp: 8, rewardPoints: 20, attackDamage: 3, attackRange: 3.5 }
};

// Closer is stronger: the first band whose distance covers the tower multiplies the base attack damage.
// Ordered nearest first; the outer band matches the longest reach, so no tower in reach falls through.
export const CREATURE_PROXIMITY_DAMAGE_BANDS = [
  { maxDistance: 1.5, multiplier: 3 },
  { maxDistance: 2.5, multiplier: 2 },
  { maxDistance: 3.5, multiplier: 1 }
] as const;

// Damage multiplier per archetype and damage type: 0.5 resists, 1 neutral, 1.5 weak. Data, not simulation logic.
export const CREATURE_DAMAGE_MULTIPLIERS: Record<CreatureArchetype, Record<DamageType, number>> = {
  runner: { physical: 1.5, explosive: 1, magic: 0.5 },
  swarm: { physical: 0.5, explosive: 1.5, magic: 1 },
  armored: { physical: 0.5, explosive: 1, magic: 1.5 },
  tank: { physical: 1.5, explosive: 0.5, magic: 1 }
};

export function getDamageMultiplier(archetype: CreatureArchetype, damageType: DamageType): number {
  return CREATURE_DAMAGE_MULTIPLIERS[archetype][damageType];
}

// Never below 1, so a resisted hit still counts and a level-1 tower can kill every archetype.
export function getDamageAgainst(towerDamage: number, damageType: DamageType, archetype: CreatureArchetype): number {
  return Math.max(1, Math.round(towerDamage * getDamageMultiplier(archetype, damageType)));
}

export function getCreatureWeaknesses(archetype: CreatureArchetype): DamageType[] {
  return DAMAGE_TYPES.filter((type) => getDamageMultiplier(archetype, type) > 1);
}

export function getCreatureBaseHp(archetype: CreatureArchetype): number {
  return CREATURE_ARCHETYPE_STATS[archetype].hp;
}

export function getCreatureRewardPoints(archetype: CreatureArchetype): number {
  return CREATURE_ARCHETYPE_STATS[archetype].rewardPoints;
}

export function getCreatureAttackDamage(archetype: CreatureArchetype): number {
  return CREATURE_ARCHETYPE_STATS[archetype].attackDamage;
}

export function getCreatureAttackRange(archetype: CreatureArchetype): number {
  return CREATURE_ARCHETYPE_STATS[archetype].attackRange;
}

// Squared distance keeps the inclusive check exact for ranges like 1.5 (no sqrt rounding).
export function isWithinCreatureAttackRange(
  archetype: CreatureArchetype,
  from: { x: number; y: number },
  to: { x: number; y: number }
): boolean {
  const range = getCreatureAttackRange(archetype);
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  return dx * dx + dy * dy <= range * range;
}

// Damage one hit does to a tower at this distance; 0 when the tower is out of reach.
// Squared distances keep band edges like 1.5 exact and the result deterministic.
export function getCreatureAttackDamageAt(
  archetype: CreatureArchetype,
  from: { x: number; y: number },
  to: { x: number; y: number }
): number {
  if (!isWithinCreatureAttackRange(archetype, from, to)) {
    return 0;
  }
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const squaredDistance = dx * dx + dy * dy;
  const band = CREATURE_PROXIMITY_DAMAGE_BANDS.find((entry) => squaredDistance <= entry.maxDistance * entry.maxDistance);
  return band ? getCreatureAttackDamage(archetype) * band.multiplier : 0;
}

export interface Creature {
  id: string;
  archetype: CreatureArchetype;
  hp: number;
  x: number;
  y: number;
  pathIndex: number;
  pathProgressUnits: number;
  spawnTick: number;
  targetTowerId: string;
}
