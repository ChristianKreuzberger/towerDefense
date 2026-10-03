// The tower goes where the player pointed. Only a player who never chose a tile gets the first free one, as a
// quick start; a chosen but unusable tile is reported (null) instead of silently placing the tower elsewhere.
export function resolvePlacementCell(choice) {
    if (choice.isFreeSpot(choice.cursor)) {
        return choice.cursor;
    }
    return choice.cursorChosen ? null : choice.firstFree();
}
