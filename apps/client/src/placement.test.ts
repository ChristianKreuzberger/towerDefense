import assert from "node:assert/strict";
import test from "node:test";

import { resolvePlacementCell } from "./placement.js";

const free = (cells: string[]) => (cell: { x: number; y: number }): boolean => cells.includes(`${cell.x},${cell.y}`);

test("a free tower spot under the cursor is used, never the first free tile", () => {
  const result = resolvePlacementCell({
    cursor: { x: 7, y: 9 },
    cursorChosen: true,
    isFreeSpot: free(["7,9", "1,1"]),
    firstFree: () => ({ x: 1, y: 1 })
  });
  assert.deepEqual(result, { x: 7, y: 9 });
});

test("a chosen but unusable tile is reported instead of placing elsewhere", () => {
  const result = resolvePlacementCell({
    cursor: { x: 7, y: 9 },
    cursorChosen: true,
    isFreeSpot: free(["1,1"]),
    firstFree: () => ({ x: 1, y: 1 })
  });
  assert.equal(result, null);
});

test("a player who never chose a tile gets the first free one", () => {
  const result = resolvePlacementCell({
    cursor: { x: 0, y: 0 },
    cursorChosen: false,
    isFreeSpot: free(["1,1"]),
    firstFree: () => ({ x: 1, y: 1 })
  });
  assert.deepEqual(result, { x: 1, y: 1 });
});
