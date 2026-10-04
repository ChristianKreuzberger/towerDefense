import type { CreatureArchetype } from "./creature-types.js";

// Spawn order cycles through these, so every wave is fully predictable (and previewable) from its number.
export const WAVE_SPAWN_ARCHETYPES: readonly CreatureArchetype[] = ["runner", "swarm", "armored", "tank"];
export const WAVE_SPAWN_INTERVAL_TICKS = 2;

export function getWaveCreatureCount(wave: number): number {
  // ceil(1.5 * (wave + 2)) in integer math, so the count never depends on float rounding.
  const base = Math.max(0, Math.floor(wave)) + 2;
  return Math.ceil((base * 3) / 2);
}

// 1-based position of a creature within its wave.
export function getWaveCreatureArchetype(spawnOrdinal: number): CreatureArchetype {
  return WAVE_SPAWN_ARCHETYPES[(Math.max(1, spawnOrdinal) - 1) % WAVE_SPAWN_ARCHETYPES.length] ?? "runner";
}

export interface WaveCompositionEntry {
  archetype: CreatureArchetype;
  count: number;
}

// What a wave brings, in first-appearance order, for example [{ runner, 2 }, { swarm, 1 }, { armored, 1 }].
export function getWaveComposition(wave: number): WaveCompositionEntry[] {
  const counts = new Map<CreatureArchetype, number>();
  for (let ordinal = 1; ordinal <= getWaveCreatureCount(wave); ordinal += 1) {
    const archetype = getWaveCreatureArchetype(ordinal);
    counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
  }
  return [...counts].map(([archetype, count]) => ({ archetype, count }));
}
