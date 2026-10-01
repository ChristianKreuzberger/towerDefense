import { getWaveComposition, type CreatureArchetype } from "@tower-defense/shared";

const LABEL: Record<CreatureArchetype, string> = { runner: "Runner", swarm: "Swarm", armored: "Armored", tank: "Tank" };

// "Next wave 3: 2x Runner, 1x Swarm, 1x Armored, 1x Tank" from the shared wave rule.
export function formatWavePreview(wave: number): string {
  const parts = getWaveComposition(wave).map((entry) => `${entry.count}x ${LABEL[entry.archetype]}`);
  return `Next wave ${wave}: ${parts.join(", ")}`;
}
