import type { Creature, Tower } from "@tower-defense/shared";

export function compareFirst(tower: Tower, a: Creature, b: Creature): number {
  const pathIndexCompare = b.pathIndex - a.pathIndex;
  if (pathIndexCompare !== 0) {
    return pathIndexCompare;
  }

  return compareByFallbackOrder(tower, a, b);
}

export function compareLast(tower: Tower, a: Creature, b: Creature): number {
  const pathIndexCompare = a.pathIndex - b.pathIndex;
  if (pathIndexCompare !== 0) {
    return pathIndexCompare;
  }

  return compareByFallbackOrder(tower, a, b);
}

export function compareStrongest(tower: Tower, a: Creature, b: Creature): number {
  const hpCompare = b.hp - a.hp;
  if (hpCompare !== 0) {
    return hpCompare;
  }

  const pathIndexCompare = b.pathIndex - a.pathIndex;
  if (pathIndexCompare !== 0) {
    return pathIndexCompare;
  }

  return compareByFallbackOrder(tower, a, b);
}

export function compareNearest(tower: Tower, a: Creature, b: Creature): number {
  const distanceA = getSquaredDistance(tower, a);
  const distanceB = getSquaredDistance(tower, b);
  if (distanceA !== distanceB) {
    return distanceA - distanceB;
  }

  const pathIndexCompare = b.pathIndex - a.pathIndex;
  if (pathIndexCompare !== 0) {
    return pathIndexCompare;
  }

  return compareByFallbackOrder(tower, a, b);
}

export function compareByFallbackOrder(tower: Tower, a: Creature, b: Creature): number {
  const spawnTickCompare = a.spawnTick - b.spawnTick;
  if (spawnTickCompare !== 0) {
    return spawnTickCompare;
  }

  const distanceCompare = getSquaredDistance(tower, a) - getSquaredDistance(tower, b);
  if (distanceCompare !== 0) {
    return distanceCompare;
  }

  return a.id.localeCompare(b.id);
}

export function getSquaredDistance(tower: Tower, creature: Creature): number {
  const dx = tower.x - creature.x;
  const dy = tower.y - creature.y;
  return (dx * dx) + (dy * dy);
}

export function isTowerBetterCreatureTarget(creature: Creature, candidate: Tower, current: Tower): boolean {
  const candidateDistance = getSquaredTowerDistanceForCreature(creature, candidate);
  const currentDistance = getSquaredTowerDistanceForCreature(creature, current);
  if (candidateDistance !== currentDistance) {
    return candidateDistance < currentDistance;
  }

  if (candidate.health !== current.health) {
    return candidate.health < current.health;
  }

  return candidate.id.localeCompare(current.id) < 0;
}

export function getSquaredTowerDistanceForCreature(creature: Creature, tower: Tower): number {
  const dx = creature.x - tower.x;
  const dy = creature.y - tower.y;
  return (dx * dx) + (dy * dy);
}
