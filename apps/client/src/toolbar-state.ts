import { MAX_TOWER_LEVEL } from "@tower-defense/shared";

export interface ToolbarInput {
  phase: "placement" | "wave" | "ended";
  towerLevel: number | null;
  eliminated: boolean;
  readyForWave: boolean;
}

export interface ToolbarState {
  upgradeEnabled: boolean;
  upgradeMaxed: boolean;
  wallEnabled: boolean;
  targetModeEnabled: boolean;
}

// Mirrors what the simulation accepts, so a control looks usable only when its command would be accepted.
export function getToolbarState(input: ToolbarInput): ToolbarState {
  const hasLivingTower = input.towerLevel !== null && !input.eliminated;
  const upgradeMaxed = input.towerLevel !== null && input.towerLevel >= MAX_TOWER_LEVEL;
  return {
    upgradeMaxed,
    upgradeEnabled: hasLivingTower && !upgradeMaxed && input.phase === "placement" && !input.readyForWave,
    wallEnabled: !input.eliminated && input.phase === "wave",
    targetModeEnabled: hasLivingTower && input.phase !== "ended"
  };
}
