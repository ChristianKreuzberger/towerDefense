export interface PlacementCell {
  x: number;
  y: number;
}

export interface PlacementChoice {
  cursor: PlacementCell;
  // True once the player clicked a tile or moved the cursor; before that the cursor is just a default.
  cursorChosen: boolean;
  isFreeSpot(cell: PlacementCell): boolean;
  firstFree(): PlacementCell | null;
}

// The tower goes where the player pointed. Only a player who never chose a tile gets the first free one, as a
// quick start; a chosen but unusable tile is reported (null) instead of silently placing the tower elsewhere.
export function resolvePlacementCell(choice: PlacementChoice): PlacementCell | null {
  if (choice.isFreeSpot(choice.cursor)) {
    return choice.cursor;
  }
  return choice.cursorChosen ? null : choice.firstFree();
}
