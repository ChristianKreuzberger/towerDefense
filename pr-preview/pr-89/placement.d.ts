export interface PlacementCell {
    x: number;
    y: number;
}
export interface PlacementChoice {
    cursor: PlacementCell;
    cursorChosen: boolean;
    isFreeSpot(cell: PlacementCell): boolean;
    firstFree(): PlacementCell | null;
}
export declare function resolvePlacementCell(choice: PlacementChoice): PlacementCell | null;
//# sourceMappingURL=placement.d.ts.map