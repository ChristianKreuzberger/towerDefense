import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATURE_ARCHETYPE_STATS,
  getCreatureWeaknesses,
  getDamageAgainst,
  getDamageMultiplier,
  type CreatureArchetype
} from "./creature-types.js";
import { getTowerDamage } from "./game-rules.js";
import { DAMAGE_TYPES } from "./tower-types.js";

const ARCHETYPES = Object.keys(CREATURE_ARCHETYPE_STATS) as CreatureArchetype[];

test("every archetype has one weakness and one resistance, all multipliers from the allowed set", () => {
  for (const archetype of ARCHETYPES) {
    const values = DAMAGE_TYPES.map((type) => getDamageMultiplier(archetype, type));
    for (const value of values) {
      assert.ok([0.5, 1, 1.5].includes(value), `${archetype} has multiplier ${value}`);
    }
    assert.equal(values.filter((value) => value > 1).length, 1, `${archetype} needs exactly one weakness`);
    assert.equal(values.filter((value) => value < 1).length, 1, `${archetype} needs exactly one resistance`);
  }
});

test("the documented multiplier table (physical, explosive, magic)", () => {
  const table = Object.fromEntries(
    ARCHETYPES.map((archetype) => [archetype, DAMAGE_TYPES.map((type) => getDamageMultiplier(archetype, type))])
  );
  assert.deepEqual(table, {
    runner: [1.5, 1, 0.5],
    swarm: [0.5, 1.5, 1],
    armored: [0.5, 1, 1.5],
    tank: [1.5, 0.5, 1]
  });
});

test("damage against an archetype is max(1, round(damage * multiplier)) for each type and damage level", () => {
  for (const archetype of ARCHETYPES) {
    for (const type of DAMAGE_TYPES) {
      for (let damage = 1; damage <= 5; damage += 1) {
        const expected = Math.max(1, Math.round(damage * getDamageMultiplier(archetype, type)));
        assert.equal(getDamageAgainst(damage, type, archetype), expected);
      }
    }
  }
  // Minimum damage: a resisted level-1 hit still does 1.
  assert.equal(getDamageAgainst(1, "magic", "runner"), 1);
  assert.equal(getDamageAgainst(1, "physical", "runner"), 2);
});

test("a level-1 tower can kill every archetype with every damage type", () => {
  for (const archetype of ARCHETYPES) {
    for (const type of DAMAGE_TYPES) {
      const perHit = getDamageAgainst(getTowerDamage(1), type, archetype);
      assert.ok(perHit >= 1);
      assert.ok(perHit * CREATURE_ARCHETYPE_STATS[archetype].hp >= CREATURE_ARCHETYPE_STATS[archetype].hp);
    }
  }
});

test("weaknesses list the types with a multiplier above 1", () => {
  assert.deepEqual(getCreatureWeaknesses("runner"), ["physical"]);
  assert.deepEqual(getCreatureWeaknesses("swarm"), ["explosive"]);
  assert.deepEqual(getCreatureWeaknesses("armored"), ["magic"]);
  assert.deepEqual(getCreatureWeaknesses("tank"), ["physical"]);
});
