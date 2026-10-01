// Deterministic 0..1 roll for one tower shot. It depends only on the match seed, wave, tick and tower id, so a
// replay gives the same hits and misses and the order in which towers resolve never changes the outcome.
export function rollShot(seed: number, wave: number, tick: number, towerId: string): number {
  let hash = 2166136261;
  const mix = (value: number): void => {
    hash = Math.imul(hash ^ (value | 0), 16777619);
    hash ^= hash >>> 15;
  };
  mix(seed);
  mix(wave);
  mix(tick);
  for (let index = 0; index < towerId.length; index += 1) {
    mix(towerId.charCodeAt(index));
  }
  // Final avalanche (murmur3 style) so neighbouring ticks do not produce neighbouring rolls.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}
