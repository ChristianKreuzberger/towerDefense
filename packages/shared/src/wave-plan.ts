import type { CreatureArchetype } from "./creature-types.js";

// Spawn order cycles through these, so every wave is fully predictable (and previewable) from its number.
export const WAVE_SPAWN_ARCHETYPES: readonly CreatureArchetype[] = ["runner", "swarm", "armored", "tank"];
export const WAVE_SPAWN_INTERVAL_TICKS = 2;

// Phase 3 content (spec/02): splitters replace every 5th creature from this wave on, and every
// BOSS_WAVE_INTERVAL-th wave ends with one extra juggernaut.
export const WAVE_SPLITTER_FROM_WAVE = 4;
export const WAVE_SPLITTER_EVERY = 5;
export const BOSS_WAVE_INTERVAL = 5;

export function isBossWave(wave: number): boolean {
  const whole = Math.floor(wave);
  return whole > 0 && whole % BOSS_WAVE_INTERVAL === 0;
}

// Creatures from the normal cycle, without the boss.
function getWaveNormalCreatureCount(wave: number): number {
  // ceil(1.5 * (wave + 2)) in integer math, so the count never depends on float rounding.
  const base = Math.max(0, Math.floor(wave)) + 2;
  return Math.ceil((base * 3) / 2);
}

export function getWaveCreatureCount(wave: number): number {
  return getWaveNormalCreatureCount(wave) + (isBossWave(wave) ? 1 : 0);
}

// 1-based position of a creature within its wave.
export function getWaveCreatureArchetype(spawnOrdinal: number, wave: number): CreatureArchetype {
  const ordinal = Math.max(1, spawnOrdinal);
  if (isBossWave(wave) && ordinal === getWaveNormalCreatureCount(wave) + 1) {
    return "juggernaut";
  }
  if (Math.floor(wave) >= WAVE_SPLITTER_FROM_WAVE && ordinal % WAVE_SPLITTER_EVERY === 0) {
    return "splitter";
  }
  return WAVE_SPAWN_ARCHETYPES[(ordinal - 1) % WAVE_SPAWN_ARCHETYPES.length] ?? "runner";
}

export interface WaveCompositionEntry {
  archetype: CreatureArchetype;
  count: number;
}

// What a wave brings, in first-appearance order, for example [{ runner, 2 }, { swarm, 1 }, { armored, 1 }].
export function getWaveComposition(wave: number): WaveCompositionEntry[] {
  const counts = new Map<CreatureArchetype, number>();
  for (let ordinal = 1; ordinal <= getWaveCreatureCount(wave); ordinal += 1) {
    const archetype = getWaveCreatureArchetype(ordinal, wave);
    counts.set(archetype, (counts.get(archetype) ?? 0) + 1);
  }
  return [...counts].map(([archetype, count]) => ({ archetype, count }));
}
