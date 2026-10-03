import type { MatchSnapshot, Tower } from "@tower-defense/shared";
import type { ToolbarState } from "./toolbar-state";
export declare function isTowerMenuOpen(): boolean;
export declare function openTowerMenu(tower: Tower, phase: MatchSnapshot["phase"]): void;
export declare function closeTowerMenu(): void;
export declare function syncTowerMenu(snapshot: MatchSnapshot, tower: Tower | undefined, state: ToolbarState, points: number): void;
export declare function positionTowerMenu(): void;
export declare function installTowerMenu(): void;
//# sourceMappingURL=tower-menu.d.ts.map