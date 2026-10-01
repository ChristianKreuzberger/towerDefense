import { MAX_TOWER_LEVEL, TOWER_MOVE_AFTER_WAVES, UPGRADE_TRACKS, type TowerUpgrades, type UpgradeTrack } from "@tower-defense/shared";

export interface ToolbarInput {
  phase: "placement" | "wave" | "ended";
  upgrades: TowerUpgrades | null;
  eliminated: boolean;
  readyForWave: boolean;
  // `towerMoveAvailable` from the snapshot (token unused, unlocked, prep phase) and the wave number for the label.
  towerMoveAvailable: boolean;
  wave: number;
}

export interface UpgradeButtonState {
  enabled: boolean;
  maxed: boolean;
}

export interface ToolbarState {
  upgrades: Record<UpgradeTrack, UpgradeButtonState>;
  wallEnabled: boolean;
  targetModeEnabled: boolean;
  readyEnabled: boolean;
  placeTowerEnabled: boolean;
  moveEnabled: boolean;
  // What the move button's cost slot shows: "free", "after R5" (still locked), "used", or "-" outside prep.
  moveLabel: string;
}

function moveLabel(input: ToolbarInput): string {
  if (input.phase !== "placement" || input.upgrades === null || input.eliminated) {
    return "-";
  }
  if (input.towerMoveAvailable) {
    return "free";
  }
  return input.wave <= TOWER_MOVE_AFTER_WAVES ? `after R${TOWER_MOVE_AFTER_WAVES}` : "used";
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
    targetModeEnabled: hasLivingTower && input.phase !== "ended",
    readyEnabled: canBuyNow,
    placeTowerEnabled: input.upgrades === null && !input.eliminated && input.phase === "placement",
    moveEnabled: input.towerMoveAvailable && canBuyNow,
    moveLabel: moveLabel(input)
  };
}
