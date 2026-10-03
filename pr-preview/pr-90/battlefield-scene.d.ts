import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { PlacementContext } from "./scene/types";
export type { PlacementContext } from "./scene/types";
export declare function cellSizeForWidth(width: number): number;
export interface BattlefieldMountOptions {
    onCellClick?: (x: number, y: number) => void;
    onViewChange?: () => void;
}
export interface BattlefieldMount {
    renderMap(snapshot: MatchSnapshot | null, transitionMs?: number, events?: MatchEvent[]): void;
    creaturePositions(): Array<{
        id: string;
        x: number;
        y: number;
    }>;
    cellToCss(x: number, y: number): {
        x: number;
        y: number;
    };
    cellSize(): number;
    setCursor(x: number, y: number): void;
    setPlacementContext(context: PlacementContext): void;
    zoomStep(direction: 1 | -1): void;
    resetView(): void;
    zoom(): number;
    destroy(): void;
}
export declare function createBattlefieldMount(container: HTMLElement, options?: BattlefieldMountOptions): BattlefieldMount;
//# sourceMappingURL=battlefield-scene.d.ts.map