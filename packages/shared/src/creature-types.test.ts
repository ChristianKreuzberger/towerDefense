import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATURE_ARCHETYPES,
  CREATURE_ARCHETYPE_STATS,
  getCreatureAttackDamageAt,
  getDamageMultiplier,
  getDamageAgainst
} from "./creature-types.js";
import { DAMAGE_TYPES } from "./tower-types.js";

test("every archetype has exactly one weakness and one resistance", () => {
  for (const archetype of CREATURE_ARCHETYPES) {
    const multipliers = DAMAGE_TYPES.map((type) => getDamageMultiplier(archetype, type));
    assert.equal(multipliers.filter((value) => value === 1.5).length, 1, archetype);
    assert.equal(multipliers.filter((value) => value === 0.5).length, 1, archetype);
  }
});

test("Phase 3 archetype stats and multipliers", () => {
  assert.deepEqual(CREATURE_ARCHETYPE_STATS.splitter, { hp: 6, rewardPoints: 12, attackDamage: 1, attackRange: 2.5 });
  assert.deepEqual(CREATURE_ARCHETYPE_STATS.juggernaut, { hp: 20, rewardPoints: 60, attackDamage: 4, attackRange: 3.5 });
  assert.equal(getDamageAgainst(1, "explosive", "splitter"), 2);
  assert.equal(getDamageAgainst(1, "magic", "splitter"), 1);
  assert.equal(getDamageAgainst(1, "physical", "splitter"), 1);
  assert.equal(getDamageAgainst(1, "magic", "juggernaut"), 2);
  assert.equal(getDamageAgainst(2, "explosive", "juggernaut"), 1);
});

test("juggernaut hits 14, 10 and 5 in the proximity bands", () => {
  const from = { x: 0, y: 0 };
  assert.equal(getCreatureAttackDamageAt("juggernaut", from, { x: 1.5, y: 0 }), 14);
  assert.equal(getCreatureAttackDamageAt("juggernaut", from, { x: 2.5, y: 0 }), 10);
  assert.equal(getCreatureAttackDamageAt("juggernaut", from, { x: 3.5, y: 0 }), 5);
  assert.equal(getCreatureAttackDamageAt("juggernaut", from, { x: 3.6, y: 0 }), 0);
});
