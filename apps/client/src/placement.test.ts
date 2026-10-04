import assert from "node:assert/strict";
import test from "node:test";

import { isTouchConfirm, resolvePlacementCell, snapToSpot } from "./placement.js";

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

test("snapToSpot keeps a free spot, snaps a near miss, ignores far or taken spots", () => {
  const spots = [{ x: 10, y: 10 }, { x: 13, y: 10 }];
  const isFree = free(["10,10", "13,10"]);
  assert.deepEqual(snapToSpot({ x: 10, y: 10 }, spots, isFree), { x: 10, y: 10 });
  assert.deepEqual(snapToSpot({ x: 11, y: 11 }, spots, isFree), { x: 10, y: 10 });
  assert.equal(snapToSpot({ x: 12, y: 13 }, spots, isFree), null);
  assert.equal(snapToSpot({ x: 11, y: 10 }, spots, free(["13,10"])), null);
});

test("snapToSpot picks the nearest spot, upper-left on a tie", () => {
  const spots = [{ x: 12, y: 10 }, { x: 10, y: 10 }];
  const isFree = free(["12,10", "10,10"]);
  assert.deepEqual(snapToSpot({ x: 11, y: 10 }, spots, isFree), { x: 10, y: 10 });
  assert.deepEqual(snapToSpot({ x: 11, y: 10 }, [...spots].reverse(), isFree), { x: 10, y: 10 });
});

test("a touch confirms only when it hits the already selected spot", () => {
  assert.equal(isTouchConfirm(null, { x: 1, y: 1 }), false);
  assert.equal(isTouchConfirm({ x: 1, y: 1 }, { x: 2, y: 1 }), false);
  assert.equal(isTouchConfirm({ x: 1, y: 1 }, { x: 1, y: 1 }), true);
});
