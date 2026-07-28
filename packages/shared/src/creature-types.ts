export type CreatureArchetype = "runner" | "tank" | "armored" | "swarm";

export interface Creature {
  id: string;
  archetype: CreatureArchetype;
  hp: number;
  x: number;
  y: number;
  pathIndex: number;
  spawnTick: number;
  targetTowerId: string;
}
