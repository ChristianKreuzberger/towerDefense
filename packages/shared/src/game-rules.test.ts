import assert from "node:assert/strict";
import test from "node:test";

import { TICKS_PER_SECOND, getTowerDamage, getTowerRange, getTowerStats } from "./game-rules.js";

test("tower damage per shot equals the tower level", () => {
  assert.equal(getTowerDamage(1), 1);
  assert.equal(getTowerDamage(4), 4);
  assert.equal(getTowerDamage(0), 1);
});

test("tower stats combine level, range, damage and dps at the base tick rate", () => {
  const stats = getTowerStats(3);
  assert.equal(stats.level, 3);
  assert.equal(stats.range, getTowerRange(3));
  assert.equal(stats.damagePerShot, 3);
  assert.equal(stats.damagePerSecond, 3 * TICKS_PER_SECOND);
  // Towers never miss: every tick with a target in range is a hit.
  assert.equal(stats.accuracy, 1);
});
