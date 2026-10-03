import assert from "node:assert/strict";
import test from "node:test";

import { getWaveComposition, getWaveCreatureArchetype, getWaveCreatureCount } from "./wave-plan.js";

test("wave N has ceil(1.5 x (N + 2)) creatures", () => {
  assert.deepEqual([1, 2, 3, 5].map(getWaveCreatureCount), [5, 6, 8, 11]);
  assert.equal(getWaveCreatureCount(0), 3);
  assert.equal(getWaveCreatureCount(-4), 3);
});

test("spawn order cycles runner, swarm, armored, tank", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(getWaveCreatureArchetype), ["runner", "swarm", "armored", "tank", "runner", "swarm"]);
});

test("composition lists each archetype once with its count, in spawn order", () => {
  assert.deepEqual(getWaveComposition(1), [
    { archetype: "runner", count: 2 },
    { archetype: "swarm", count: 1 },
    { archetype: "armored", count: 1 },
    { archetype: "tank", count: 1 }
  ]);
  assert.deepEqual(getWaveComposition(3), [
    { archetype: "runner", count: 2 },
    { archetype: "swarm", count: 2 },
    { archetype: "armored", count: 2 },
    { archetype: "tank", count: 2 }
  ]);
  const total = getWaveComposition(9).reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(total, getWaveCreatureCount(9));
});
