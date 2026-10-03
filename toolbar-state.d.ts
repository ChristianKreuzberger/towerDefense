import { type TowerUpgrades, type UpgradeTrack } from "@tower-defense/shared";
export interface ToolbarInput {
    phase: "placement" | "wave" | "ended";
    upgrades: TowerUpgrades | null;
    eliminated: boolean;
    readyForWave: boolean;
    towerMoveAvailable: boolean;
    wave: number;
    bot?: boolean;
}
export interface UpgradeButtonState {
    enabled: boolean;
    maxed: boolean;
}
export interface ToolbarState {
    upgrades: Record<UpgradeTrack, UpgradeButtonState>;
    targetModeEnabled: boolean;
    damageTypeEnabled: boolean;
    readyEnabled: boolean;
    placeTowerEnabled: boolean;
    moveEnabled: boolean;
    moveLabel: string;
    moveHint: string;
}
export declare function getToolbarState(input: ToolbarInput): ToolbarState;
//# sourceMappingURL=toolbar-state.d.ts.map