import { type GameMap, type MatchSnapshot } from "@tower-defense/shared";
export type PreviewCellKind = "pad" | "lane" | "blocked" | "cave";
export interface PreviewCell {
    kind: PreviewCellKind;
    isProtected: boolean;
}
export declare function classifyMapCells(map: GameMap): PreviewCell[][];
export declare function drawMapPreview(canvas: HTMLCanvasElement, map: GameMap): void;
export interface MapPreviewDialog {
    open(snapshot: MatchSnapshot): void;
    close(): void;
    isOpen(): boolean;
}
export declare function mountMapPreview(options: {
    root: HTMLElement;
    playerNumber(playerId: string): number;
    onContinue(): void;
}): MapPreviewDialog;
//# sourceMappingURL=map-preview.d.ts.map