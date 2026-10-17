import assert from "node:assert/strict";
import test from "node:test";

import { getWaveComposition, getWaveCreatureArchetype, getWaveCreatureCount } from "./wave-plan.js";

test("wave N has ceil(1.5 x (N + 2)) creatures", () => {
  assert.deepEqual([1, 2, 3, 4, 6].map(getWaveCreatureCount), [5, 6, 8, 9, 12]);
  assert.equal(getWaveCreatureCount(0), 3);
  assert.equal(getWaveCreatureCount(-4), 3);
});

test("spawn order cycles runner, swarm, armored, tank", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((ordinal) => getWaveCreatureArchetype(ordinal, 1)),
    ["runner", "swarm", "armored", "tank", "runner", "swarm"]
  );
});

function waveArchetypes(wave: number): string[] {
  return Array.from({ length: getWaveCreatureCount(wave) }, (_, index) => getWaveCreatureArchetype(index + 1, wave));
}

test("waves 1 to 3 have no splitter and no boss (unchanged content)", () => {
  assert.deepEqual(waveArchetypes(1), ["runner", "swarm", "armored", "tank", "runner"]);
  assert.deepEqual(waveArchetypes(2), ["runner", "swarm", "armored", "tank", "runner", "swarm"]);
  assert.deepEqual(waveArchetypes(3), ["runner", "swarm", "armored", "tank", "runner", "swarm", "armored", "tank"]);
});

test("from wave 4 every 5th creature is a splitter", () => {
  assert.deepEqual(waveArchetypes(4), [
    "runner", "swarm", "armored", "tank", "splitter", "swarm", "armored", "tank", "runner"
  ]);
  assert.equal(waveArchetypes(9).filter((archetype) => archetype === "splitter").length, 3);
});

test("wave 5 and 10 end with exactly one juggernaut as an extra creature", () => {
  for (const wave of [5, 10, 15]) {
    const archetypes = waveArchetypes(wave);
    assert.equal(archetypes.at(-1), "juggernaut");
    assert.equal(archetypes.filter((archetype) => archetype === "juggernaut").length, 1);
  }
  assert.equal(getWaveCreatureCount(5), 12);
  assert.equal(getWaveCreatureCount(10), 19);
  assert.ok(!waveArchetypes(6).includes("juggernaut"));
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
  assert.deepEqual(getWaveComposition(5).at(-1), { archetype: "juggernaut", count: 1 });
  const total = getWaveComposition(9).reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(total, getWaveCreatureCount(9));
});
