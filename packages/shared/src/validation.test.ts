import assert from "node:assert/strict";
import test from "node:test";

import type { GameMap } from "./map-types.js";
import type { Tower } from "./tower-types.js";
import type { Wall } from "./wall-types.js";
import {
  getTowerUpgradeCost,
  getWallCost,
  isValidTowerTargetMode,
  isValidTowerPlacement,
  isValidTowerUpgradeTarget,
  isValidWallPlacement
} from "./validation.js";

// '.' is buildable, '#' is not.
function mapFrom(rows: string[]): GameMap {
  const cells = rows.flatMap((row, y) =>
    [...row].map((char, x) => ({ x, y, buildable: char === ".", pathWear: 0 }))
  );
  return { width: rows[0]?.length ?? 0, height: rows.length, seed: 1, cells };
}

function towerAt(id: string, x: number, y: number, playerId = id): Tower {
  return { id, playerId, x, y, health: 100, maxHealth: 100, level: 0, targetMode: "first" };
}

function wallAt(x: number, y: number): Wall {
  return { id: `w-${x}-${y}`, playerId: "p1", x, y, health: 10, maxHealth: 10 };
}

const OPEN = mapFrom([".....", ".....", "....."]);
// Tower cells in a dead-end pocket: reachable only through (1,1), two lanes stay open.
const POCKET = mapFrom([".....", ".....", "#.###"]);
// t1 at (2,2) is buildable but sealed off by unbuildable cells.
const SEALED = mapFrom([".....", ".###.", ".#.#.", ".###.", "....."]);

test("tower placement: accepts the first tower on an open map", () => {
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: 2, y: 1 }, [], OPEN), { valid: true });
});

test("tower placement: rejects out-of-bounds cells", () => {
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: 9, y: 9 }, [], OPEN), {
    valid: false,
    reason: "out-of-bounds"
  });
});

test("tower placement: rejects non-buildable cells", () => {
  const map = mapFrom(["..#..", ".....", "....."]);
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: 2, y: 0 }, [], map), {
    valid: false,
    reason: "cell-not-buildable"
  });
});

test("tower placement: rejects overlap with an existing tower", () => {
  assert.deepEqual(
    isValidTowerPlacement({ playerId: "p2", x: 1, y: 1 }, [towerAt("t1", 1, 1)], OPEN),
    { valid: false, reason: "tower-overlap" }
  );
});

test("tower placement: rejects cutting the only left-to-right lane", () => {
  const corridor = mapFrom(["###", "...", "###"]);
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: 1, y: 1 }, [], corridor), {
    valid: false,
    reason: "path-blocked"
  });
});

test("tower placement: rejects a tower that cuts off an existing tower while a left-to-right lane stays open", () => {
  assert.deepEqual(
    isValidTowerPlacement({ playerId: "p2", x: 1, y: 1 }, [towerAt("t1", 1, 2)], POCKET),
    { valid: false, reason: "path-blocked" }
  );
});

test("tower placement: accepts a tower that leaves every existing tower reachable", () => {
  assert.deepEqual(
    isValidTowerPlacement({ playerId: "p2", x: 4, y: 0 }, [towerAt("t1", 1, 2)], POCKET),
    { valid: true }
  );
});

test("tower placement: does not blame the new tower for a tower that was already unreachable", () => {
  assert.deepEqual(
    isValidTowerPlacement({ playerId: "p2", x: 0, y: 0 }, [towerAt("t1", 2, 2)], SEALED),
    { valid: true }
  );
});

test("wall placement: rejects bad cells and overlaps", () => {
  const map = mapFrom(["..#..", ".....", "....."]);
  const towers = [towerAt("t1", 0, 1)];
  const walls = [wallAt(3, 1)];
  assert.equal(isValidWallPlacement({ playerId: "p1", x: -1, y: 0 }, walls, towers, map).reason, "out-of-bounds");
  assert.equal(isValidWallPlacement({ playerId: "p1", x: 2, y: 0 }, walls, towers, map).reason, "cell-not-buildable");
  assert.equal(isValidWallPlacement({ playerId: "p1", x: 0, y: 1 }, walls, towers, map).reason, "tower-overlap");
  assert.equal(isValidWallPlacement({ playerId: "p1", x: 3, y: 1 }, walls, towers, map).reason, "wall-overlap");
});

test("wall placement: is allowed when no tower exists yet", () => {
  assert.deepEqual(isValidWallPlacement({ playerId: "p1", x: 1, y: 1 }, [], [], OPEN), { valid: true });
});

test("wall placement: rejects cutting the only lane and cutting off a tower", () => {
  const corridor = mapFrom(["###", "...", "###"]);
  assert.equal(
    isValidWallPlacement({ playerId: "p1", x: 1, y: 1 }, [], [towerAt("t1", 0, 1)], corridor).reason,
    "path-blocked"
  );
  assert.equal(
    isValidWallPlacement({ playerId: "p1", x: 1, y: 1 }, [], [towerAt("t1", 1, 2)], POCKET).reason,
    "path-blocked"
  );
  assert.deepEqual(isValidWallPlacement({ playerId: "p1", x: 4, y: 0 }, [], [towerAt("t1", 1, 2)], POCKET), {
    valid: true
  });
});

test("cost helpers grow with count and level", () => {
  assert.ok(getWallCost(1) >= getWallCost(0));
  assert.ok(getTowerUpgradeCost(2) >= getTowerUpgradeCost(0));
});

test("upgrade target and target mode checks", () => {
  const towers = [towerAt("t1", 0, 0, "p1")];
  assert.equal(isValidTowerUpgradeTarget("t1", "p1", towers), true);
  assert.equal(isValidTowerUpgradeTarget("t1", "p2", towers), false);
  assert.equal(isValidTowerUpgradeTarget("nope", "p1", towers), false);
  assert.equal(isValidTowerTargetMode("first"), true);
  assert.equal(isValidTowerTargetMode("bogus"), false);
});
