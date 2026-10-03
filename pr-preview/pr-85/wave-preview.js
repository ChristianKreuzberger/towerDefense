import { getCreatureWeaknesses, getWaveComposition } from "@tower-defense/shared";
const LABEL = { runner: "Runner", swarm: "Swarm", armored: "Armored", tank: "Tank" };
// "Next wave 3: 2x Runner (weak: physical), 1x Swarm (weak: explosive), ..." from the shared wave rule and damage data.
export function formatWavePreview(wave) {
    const parts = getWaveComposition(wave).map((entry) => {
        const weak = getCreatureWeaknesses(entry.archetype);
        return `${entry.count}x ${LABEL[entry.archetype]}${weak.length > 0 ? ` (weak: ${weak.join("/")})` : ""}`;
    });
    return `Next wave ${wave}: ${parts.join(", ")}`;
}
