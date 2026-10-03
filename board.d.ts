import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { BattlefieldMount } from "./battlefield-scene";
export declare function setCellClickHandler(handler: (x: number, y: number) => void): void;
export declare function setViewChangeHandler(handler: () => void): void;
export declare const battlefieldMount: BattlefieldMount;
export declare function rebuildBattlefield(): void;
export declare function updateBattlefield(snapshot: MatchSnapshot | null, transitionMs?: number, events?: MatchEvent[]): void;
export declare function syncPlacementContext(snapshot: MatchSnapshot | null): void;
export declare function renderSnapshot(snapshot: MatchSnapshot | null): void;
export declare function occupiedCellKeys(snapshot: MatchSnapshot): Set<string>;
export declare function firstFreeTowerSpot(snapshot: MatchSnapshot | null): {
    x: number;
    y: number;
} | null;
export declare function syncCursorToTowerSpot(snapshot: MatchSnapshot | null): void;
export declare function adjustCoord(dx: number, dy: number): void;
export declare function setMoveMode(next: boolean): void;
//# sourceMappingURL=board.d.ts.map