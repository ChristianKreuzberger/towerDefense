export type CreatureArchetype = "runner" | "tank" | "armored" | "swarm";

export interface CreatureArchetypeStats {
  hp: number;
  rewardPoints: number;
  attackDamage: number;
  // Cells; short on purpose so only towers/walls beside the lane get attacked.
  attackRange: number;
}

export const CREATURE_ARCHETYPE_STATS: Record<CreatureArchetype, CreatureArchetypeStats> = {
  runner: { hp: 2, rewardPoints: 10, attackDamage: 1, attackRange: 1 },
  swarm: { hp: 1, rewardPoints: 8, attackDamage: 1, attackRange: 1 },
  armored: { hp: 3, rewardPoints: 14, attackDamage: 2, attackRange: 1.5 },
  tank: { hp: 5, rewardPoints: 20, attackDamage: 3, attackRange: 1.5 }
};

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
