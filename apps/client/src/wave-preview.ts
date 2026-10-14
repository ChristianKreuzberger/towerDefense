import { DAMAGE_TYPES, getCreatureWeaknesses, getDamageMultiplier, getWaveComposition, type CreatureArchetype } from "@tower-defense/shared";

const LABEL: Record<CreatureArchetype, string> = {
  runner: "Runner",
  swarm: "Swarm",
  armored: "Armored",
  tank: "Tank",
  splitter: "Splitter",
  juggernaut: "Juggernaut (boss)"
};

// "Next wave 3: 2x Runner (weak: physical, resists: magic), ..." from the shared wave rule and damage data.
export function formatWavePreview(wave: number): string {
  const parts = getWaveComposition(wave).map((entry) => {
    const weak = getCreatureWeaknesses(entry.archetype);
    const resists = DAMAGE_TYPES.filter((type) => getDamageMultiplier(entry.archetype, type) < 1);
    const hints = [weak.length > 0 ? `weak: ${weak.join("/")}` : "", resists.length > 0 ? `resists: ${resists.join("/")}` : ""].filter(Boolean);
    return `${entry.count}x ${LABEL[entry.archetype]}${hints.length > 0 ? ` (${hints.join(", ")})` : ""}`;
  });
  return `Next wave ${wave}: ${parts.join(", ")}`;
}
