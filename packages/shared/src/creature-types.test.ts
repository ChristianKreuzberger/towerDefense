import assert from "node:assert/strict";
import test from "node:test";

import { CREATURE_ARCHETYPE_STATS, type CreatureArchetype } from "./creature-types.js";
import { getTowerDamage } from "./game-rules.js";

test("no creature archetype dies to a single level-1 tower shot", () => {
  for (const [archetype, stats] of Object.entries(CREATURE_ARCHETYPE_STATS) as Array<[CreatureArchetype, { hp: number }]>) {
    assert.ok(stats.hp > getTowerDamage(1), `${archetype} has ${stats.hp} hp and would be one-shot`);
  }
});

test("tougher archetypes keep their hp order", () => {
  const hp = (name: CreatureArchetype): number => CREATURE_ARCHETYPE_STATS[name].hp;
  assert.ok(hp("swarm") < hp("runner") && hp("runner") < hp("armored") && hp("armored") < hp("tank"));
});
