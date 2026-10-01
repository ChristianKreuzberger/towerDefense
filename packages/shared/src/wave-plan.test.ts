import assert from "node:assert/strict";
import test from "node:test";

import { getWaveComposition, getWaveCreatureArchetype, getWaveCreatureCount } from "./wave-plan.js";

test("wave N has N + 2 creatures", () => {
  assert.deepEqual([1, 2, 5].map(getWaveCreatureCount), [3, 4, 7]);
});

test("spawn order cycles runner, swarm, armored, tank", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(getWaveCreatureArchetype), ["runner", "swarm", "armored", "tank", "runner", "swarm"]);
});

test("composition lists each archetype once with its count, in spawn order", () => {
  assert.deepEqual(getWaveComposition(1), [
    { archetype: "runner", count: 1 },
    { archetype: "swarm", count: 1 },
    { archetype: "armored", count: 1 }
  ]);
  assert.deepEqual(getWaveComposition(3), [
    { archetype: "runner", count: 2 },
    { archetype: "swarm", count: 1 },
    { archetype: "armored", count: 1 },
    { archetype: "tank", count: 1 }
  ]);
  const total = getWaveComposition(9).reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(total, getWaveCreatureCount(9));
});
