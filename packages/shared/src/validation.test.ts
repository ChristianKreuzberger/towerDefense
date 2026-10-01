import assert from "node:assert/strict";
import test from "node:test";

import { SPAWN_PROTECTION_RADIUS } from "./game-rules.js";
import { isInSpawnProtection, type GameMap } from "./map-types.js";
import type { Tower } from "./tower-types.js";
import type { Wall } from "./wall-types.js";
import { getTowerUpgradeCost } from "./game-rules.js";
import {
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
  return { schemaVersion: 1, width: rows[0]?.length ?? 0, height: rows.length, seed: 1, cells };
}

function towerAt(id: string, x: number, y: number, playerId = id): Tower {
  return { id, playerId, x, y, health: 100, maxHealth: 100, level: 1, upgrades: { range: 1, damage: 1, accuracy: 1 }, targetMode: "first", damageType: "physical" };
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
  assert.ok(getTowerUpgradeCost("damage", 2) >= getTowerUpgradeCost("damage", 1));
});

test("upgrade target and target mode checks", () => {
  const towers = [towerAt("t1", 0, 0, "p1")];
  assert.equal(isValidTowerUpgradeTarget("t1", "p1", towers), true);
  assert.equal(isValidTowerUpgradeTarget("t1", "p2", towers), false);
  assert.equal(isValidTowerUpgradeTarget("nope", "p1", towers), false);
  assert.equal(isValidTowerTargetMode("first"), true);
  assert.equal(isValidTowerTargetMode("bogus"), false);
});

// Cave at (0,5) on a 20x11 open map; protected radius is SPAWN_PROTECTION_RADIUS.
function mapWithSpawn(): GameMap {
  const rows = Array.from({ length: 11 }, () => ".".repeat(20));
  return { ...mapFrom(rows), spawn: { x: 0, y: 5 } };
}

test("spawn protection: rejects towers and walls inside the protected radius", () => {
  const map = mapWithSpawn();
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: SPAWN_PROTECTION_RADIUS, y: 5 }, [], map), {
    valid: false,
    reason: "spawn-protected"
  });
  assert.deepEqual(isValidWallPlacement({ playerId: "p1", x: 1, y: 4 }, [], [towerAt("t1", 15, 5)], map), {
    valid: false,
    reason: "spawn-protected"
  });
});

test("spawn protection: allows placement just outside the protected radius", () => {
  const map = mapWithSpawn();
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: SPAWN_PROTECTION_RADIUS + 1, y: 5 }, [], map), {
    valid: true
  });
  assert.equal(isInSpawnProtection(map, SPAWN_PROTECTION_RADIUS, 5), true);
  assert.equal(isInSpawnProtection(map, SPAWN_PROTECTION_RADIUS + 1, 5), false);
});

test("spawn protection: a wall may not cut the cave's lane even if another left-edge row stays open", () => {
  const rows = ["##########", "..........", "##########", "..........", "#.########"];
  const map: GameMap = { ...mapFrom(rows), spawn: { x: 0, y: 1 } };
  assert.deepEqual(isValidWallPlacement({ playerId: "p1", x: 7, y: 1 }, [], [towerAt("t1", 1, 4)], map), {
    valid: false,
    reason: "path-blocked"
  });
  // Same wall is fine on a map without a cave: the second row still gives a left-to-right route.
  assert.deepEqual(isValidWallPlacement({ playerId: "p1", x: 7, y: 1 }, [], [towerAt("t1", 1, 4)], mapFrom(rows)), {
    valid: true
  });
});

test("spawn protection: a wall may not cut a tower off from the cave even if it touches a map border elsewhere", () => {
  // Tower at (7,1) is reachable from the cave only through (7,2). Its other neighbour (7,0) sits on the top
  // border but is walled off from the cave, so only cave-seeded reachability sees the cut. The lower lane keeps
  // the left-to-right route open, so only the per-tower check can reject.
  const rows = ["#######.##", "#######.##", "..........", ".#########", ".........."];
  const map: GameMap = { ...mapFrom(rows), spawn: { x: 0, y: 2 } };
  assert.deepEqual(isValidWallPlacement({ playerId: "p1", x: 7, y: 2 }, [], [towerAt("t1", 7, 1)], map), {
    valid: false,
    reason: "path-blocked"
  });
});

test("spawn protection: a map without a cave protects nothing", () => {
  assert.equal(isInSpawnProtection(OPEN, 0, 0), false);
});
