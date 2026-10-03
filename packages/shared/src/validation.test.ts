import assert from "node:assert/strict";
import test from "node:test";

import { SPAWN_PROTECTION_RADIUS } from "./game-rules.js";
import { MAP_SCHEMA_VERSION, isInSpawnProtection, type GameMap } from "./map-types.js";
import type { Tower } from "./tower-types.js";
import { getTowerUpgradeCost } from "./game-rules.js";
import {
  isValidTowerTargetMode,
  isValidTowerPlacement,
  isValidTowerUpgradeTarget,
  validatePathSafety
} from "./validation.js";

// '.' is road (walkable), '#' is grass, 'o' is a tower spot. Placement-only tests do not need MIN_TOWER_SITES spots.
function mapFrom(rows: string[]): GameMap {
  const cells = rows.flatMap((row, y) =>
    [...row].map((char, x) => ({ x, y, buildable: char === ".", pathWear: 0 }))
  );
  const towerSpots = rows.flatMap((row, y) =>
    [...row].flatMap((char, x) => (char === "o" ? [{ x, y }] : []))
  );
  return { schemaVersion: MAP_SCHEMA_VERSION, width: rows[0]?.length ?? 0, height: rows.length, seed: 1, cells, towerSpots };
}

function towerAt(id: string, x: number, y: number, playerId = id): Tower {
  return { id, playerId, x, y, health: 100, maxHealth: 100, level: 1, upgrades: { range: 1, damage: 1, accuracy: 1 }, targetMode: "first", damageType: "physical" };
}

// Every cell is a tower spot; there is no road.
const OPEN = mapFrom(["ooooo", "ooooo", "ooooo"]);
// Tower cells in a dead-end pocket: reachable only through (1,1), two lanes stay open.
const POCKET = mapFrom([".....", ".....", "#.###"]);
// t1 at (2,2) is walkable but sealed off by unwalkable cells.
const SEALED = mapFrom([".....", ".###.", ".#.#.", ".###.", "....."]);

test("tower placement: accepts a tower spot", () => {
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: 2, y: 1 }, [], OPEN), { valid: true });
  const beside = mapFrom(["ooo", "...", "ooo"]);
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: 1, y: 0 }, [], beside), { valid: true });
});

test("tower placement: rejects out-of-bounds cells", () => {
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: 9, y: 9 }, [], OPEN), {
    valid: false,
    reason: "out-of-bounds"
  });
});

test("tower placement: rejects the road and plain grass, which are not tower spots", () => {
  const map = mapFrom(["o#ooo", ".....", "ooooo"]);
  for (const [x, y] of [[2, 1], [1, 0]] as const) {
    assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x, y }, [], map), {
      valid: false,
      reason: "not-tower-spot"
    });
  }
});

test("tower placement: rejects overlap with an existing tower", () => {
  assert.deepEqual(
    isValidTowerPlacement({ playerId: "p2", x: 1, y: 1 }, [towerAt("t1", 1, 1)], OPEN),
    { valid: false, reason: "tower-overlap" }
  );
});

// Spots are never walkable, so these safety rules only matter for a hand-built map; they stay as a safety net.
test("path safety: rejects cutting the only left-to-right lane", () => {
  const corridor = mapFrom(["###", "...", "###"]);
  assert.deepEqual(validatePathSafety({ playerId: "p1", x: 1, y: 1 }, [], corridor), {
    safe: false,
    reason: "path-blocked"
  });
});

test("path safety: rejects a tower that cuts off an existing tower while a left-to-right lane stays open", () => {
  assert.deepEqual(
    validatePathSafety({ playerId: "p2", x: 1, y: 1 }, [towerAt("t1", 1, 2)], POCKET),
    { safe: false, reason: "path-blocked" }
  );
});

test("path safety: accepts a tower that leaves every existing tower reachable", () => {
  assert.deepEqual(validatePathSafety({ playerId: "p2", x: 4, y: 0 }, [towerAt("t1", 1, 2)], POCKET), { safe: true });
});

test("path safety: does not blame the new tower for a tower that was already unreachable", () => {
  assert.deepEqual(validatePathSafety({ playerId: "p2", x: 0, y: 0 }, [towerAt("t1", 2, 2)], SEALED), { safe: true });
});

test("upgrade costs grow with level", () => {
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

// Cave at (0,5) on a 20x11 map where every cell is a tower spot; protected radius is SPAWN_PROTECTION_RADIUS.
function mapWithSpawn(): GameMap {
  const rows = Array.from({ length: 11 }, () => "o".repeat(20));
  return { ...mapFrom(rows), spawn: { x: 0, y: 5 } };
}

test("spawn protection: rejects towers inside the protected radius", () => {
  const map = mapWithSpawn();
  assert.deepEqual(isValidTowerPlacement({ playerId: "p1", x: SPAWN_PROTECTION_RADIUS, y: 5 }, [], map), {
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

test("path safety: a tower may not cut the cave's lane even if another left-edge row stays open", () => {
  const rows = ["##########", "..........", "##########", "..........", "#.########"];
  const map: GameMap = { ...mapFrom(rows), spawn: { x: 0, y: 1 } };
  assert.deepEqual(validatePathSafety({ playerId: "p2", x: 7, y: 1 }, [towerAt("t1", 1, 4)], map), {
    safe: false,
    reason: "path-blocked"
  });
  // Same tower is fine on a map without a cave: the second row still gives a left-to-right route.
  assert.deepEqual(validatePathSafety({ playerId: "p2", x: 7, y: 1 }, [towerAt("t1", 1, 4)], mapFrom(rows)), {
    safe: true
  });
});

test("path safety: a tower may not cut another tower off from the cave even if it touches a map border elsewhere", () => {
  // Tower at (7,1) is reachable from the cave only through (7,2). Its other neighbour (7,0) sits on the top
  // border but is walled off from the cave, so only cave-seeded reachability sees the cut. The lower lane keeps
  // the left-to-right route open, so only the per-tower check can reject.
  const rows = ["#######.##", "#######.##", "..........", ".#########", ".........."];
  const map: GameMap = { ...mapFrom(rows), spawn: { x: 0, y: 2 } };
  assert.deepEqual(validatePathSafety({ playerId: "p2", x: 7, y: 2 }, [towerAt("t1", 7, 1)], map), {
    safe: false,
    reason: "path-blocked"
  });
});

test("spawn protection: a map without a cave protects nothing", () => {
  assert.equal(isInSpawnProtection(OPEN, 0, 0), false);
});
