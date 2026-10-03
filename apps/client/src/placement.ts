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

// How far (in cells) a touch may miss a spot and still select it; a fingertip covers several 8 px cells.
export const TOUCH_SNAP_RADIUS = 1.5;

// The free spot a touch at `cell` means: the cell itself when it is one, else the nearest free spot within the
// radius (ties go to the upper-left one so the result never depends on iteration order).
export function snapToSpot(
  cell: PlacementCell,
  spots: Iterable<PlacementCell>,
  isFreeSpot: (cell: PlacementCell) => boolean,
  radius: number = TOUCH_SNAP_RADIUS
): PlacementCell | null {
  if (isFreeSpot(cell)) {
    return cell;
  }
  let best: PlacementCell | null = null;
  let bestDistance = Infinity;
  for (const spot of spots) {
    const distance = Math.hypot(spot.x - cell.x, spot.y - cell.y);
    if (distance > radius || !isFreeSpot(spot)) {
      continue;
    }
    const better =
      distance < bestDistance
      || (distance === bestDistance && best !== null && (spot.y < best.y || (spot.y === best.y && spot.x < best.x)));
    if (better) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

// Touch placement is two steps: the first tap on a spot only selects it, a tap on the selected spot confirms.
export function isTouchConfirm(selected: PlacementCell | null, tapped: PlacementCell): boolean {
  return selected !== null && selected.x === tapped.x && selected.y === tapped.y;
}
