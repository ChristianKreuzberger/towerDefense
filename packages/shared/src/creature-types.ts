import { DAMAGE_TYPES, type DamageType } from "./tower-types.js";

export type CreatureArchetype = "runner" | "tank" | "armored" | "swarm";

export interface CreatureArchetypeStats {
  hp: number;
  rewardPoints: number;
  attackDamage: number;
  // Cells; short on purpose so only towers beside the lane get attacked.
  attackRange: number;
}

export const CREATURE_ARCHETYPE_STATS: Record<CreatureArchetype, CreatureArchetypeStats> = {
  runner: { hp: 3, rewardPoints: 10, attackDamage: 1, attackRange: 1 },
  swarm: { hp: 2, rewardPoints: 8, attackDamage: 1, attackRange: 1 },
  armored: { hp: 5, rewardPoints: 14, attackDamage: 2, attackRange: 1.5 },
  tank: { hp: 8, rewardPoints: 20, attackDamage: 3, attackRange: 1.5 }
};

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
