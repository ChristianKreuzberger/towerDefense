import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TOWER_HEALTH,
  MAX_TOWER_LEVEL,
  getBetweenWaveTowerRepairAmount,
  TICKS_PER_SECOND,
  getTowerAccuracy,
  getTowerDamage,
  getTowerOverallLevel,
  getTowerRange,
  getTowerStats,
  getTowerStyleTier,
  TOWER_STYLE_TIERS,
  getTowerUpgradeCost
} from "./game-rules.js";
import { UPGRADE_TRACKS } from "./tower-types.js";

test("each track scales on its own: range, damage and accuracy", () => {
  assert.deepEqual([1, 2, 3, 5].map(getTowerRange), [6, 7.5, 9, 12]);
  assert.deepEqual([1, 2, 5].map(getTowerDamage), [1, 2, 5]);
  assert.equal(getTowerDamage(0), 1);
  assert.deepEqual([1, 2, 3, 4, 5].map(getTowerAccuracy), [0.7, 0.775, 0.85, 0.925, 1]);
});

test("accuracy never exceeds 100% even past the cap", () => {
  assert.equal(getTowerAccuracy(MAX_TOWER_LEVEL + 3), 1);
});

test("tower stats combine the three tracks", () => {
  const stats = getTowerStats({ range: 3, damage: 2, accuracy: 5 });
  assert.equal(stats.level, 1 + 2 + 1 + 4);
  assert.equal(stats.range, getTowerRange(3));
  assert.equal(stats.damagePerShot, 2);
  assert.equal(stats.damagePerSecond, 2 * TICKS_PER_SECOND);
  assert.equal(stats.accuracy, 1);
});

test("overall level is 1 plus the upgrades bought", () => {
  assert.equal(getTowerOverallLevel({ range: 1, damage: 1, accuracy: 1 }), 1);
  assert.equal(getTowerOverallLevel({ range: 2, damage: 3, accuracy: 1 }), 4);
});

test("upgrade costs per track match the documented tables", () => {
  const costs = (track: (typeof UPGRADE_TRACKS)[number]): number[] =>
    [1, 2, 3, 4].map((level) => getTowerUpgradeCost(track, level));
  assert.deepEqual(costs("range"), [64, 102, 163, 262]);
  assert.deepEqual(costs("damage"), [96, 153, 245, 393]);
  assert.deepEqual(costs("accuracy"), [45, 67, 101, 151]);
});

test("buying every track completely costs more than the win score, so players must choose", () => {
  let total = 0;
  for (const track of UPGRADE_TRACKS) {
    for (let level = 1; level < MAX_TOWER_LEVEL; level += 1) {
      total += getTowerUpgradeCost(track, level);
    }
  }
  assert.equal(total, 591 + 887 + 364);
  assert.ok(total > 1000);
});

test("the tower style changes on every 3rd upgrade", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 13].map(getTowerStyleTier), [0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4]);
});

test("the style tier never exceeds the last tier and tolerates bad levels", () => {
  assert.equal(getTowerStyleTier(99), TOWER_STYLE_TIERS - 1);
  assert.equal(getTowerStyleTier(0), 0);
  // The highest reachable overall level (every track maxed) is exactly the last tier.
  assert.equal(getTowerStyleTier(1 + 3 * (MAX_TOWER_LEVEL - 1)), TOWER_STYLE_TIERS - 1);
});

test("towers start with 150 HP and repair 30 HP between waves", () => {
  assert.equal(DEFAULT_TOWER_HEALTH, 150);
  assert.equal(getBetweenWaveTowerRepairAmount(DEFAULT_TOWER_HEALTH), 30);
});
