export type CreatureArchetype = "runner" | "tank" | "armored" | "swarm";

export interface CreatureArchetypeStats {
  hp: number;
  rewardPoints: number;
  attackDamage: number;
}

export const CREATURE_ARCHETYPE_STATS: Record<CreatureArchetype, CreatureArchetypeStats> = {
  runner: { hp: 2, rewardPoints: 10, attackDamage: 1 },
  swarm: { hp: 1, rewardPoints: 8, attackDamage: 1 },
  armored: { hp: 3, rewardPoints: 14, attackDamage: 2 },
  tank: { hp: 5, rewardPoints: 20, attackDamage: 3 }
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
