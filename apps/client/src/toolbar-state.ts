import { MAX_TOWER_LEVEL, UPGRADE_TRACKS, type TowerUpgrades, type UpgradeTrack } from "@tower-defense/shared";

export interface ToolbarInput {
  phase: "placement" | "wave" | "ended";
  upgrades: TowerUpgrades | null;
  eliminated: boolean;
  readyForWave: boolean;
}

export interface UpgradeButtonState {
  enabled: boolean;
  maxed: boolean;
}

export interface ToolbarState {
  upgrades: Record<UpgradeTrack, UpgradeButtonState>;
  wallEnabled: boolean;
  targetModeEnabled: boolean;
}

// Mirrors what the simulation accepts, so a control looks usable only when its command would be accepted.
export function getToolbarState(input: ToolbarInput): ToolbarState {
  const hasLivingTower = input.upgrades !== null && !input.eliminated;
  const canBuyNow = hasLivingTower && input.phase === "placement" && !input.readyForWave;
  const upgrades = {} as Record<UpgradeTrack, UpgradeButtonState>;
  for (const track of UPGRADE_TRACKS) {
    const maxed = input.upgrades !== null && input.upgrades[track] >= MAX_TOWER_LEVEL;
    upgrades[track] = { maxed, enabled: canBuyNow && !maxed };
  }
  return {
    upgrades,
    wallEnabled: !input.eliminated && input.phase === "wave",
    targetModeEnabled: hasLivingTower && input.phase !== "ended"
  };
}
