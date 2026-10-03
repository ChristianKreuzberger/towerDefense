import test from "node:test";
import assert from "node:assert/strict";

import { MAP_SCHEMA_VERSION, MIN_TOWER_SITES, findTowerSites, validateGameMap } from "@tower-defense/shared";

import { createMatch } from "./match-simulation.js";
import { generateMap } from "./procedural-map.js";

test("generated maps carry the schema version and a goal on the right edge", () => {
  const map = generateMap(42);
  assert.equal(map.schemaVersion, MAP_SCHEMA_VERSION);
  assert.ok(map.goal);
  assert.equal(map.goal.x, map.width - 1);
  assert.equal(map.cells.find((cell) => cell.x === map.goal?.x && cell.y === map.goal?.y)?.buildable, true);
});

test("every generated map passes validation and leaves room for 8 towers", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const map = generateMap(seed);
    assert.deepEqual(validateGameMap(map), [], `seed ${seed} is invalid`);
    assert.ok(findTowerSites(map).length >= MIN_TOWER_SITES, `seed ${seed} has too few tower sites`);
  }
});

test("the tower site guarantee also holds on small maps, where the generator has to add pads", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const map = generateMap(seed, 20, 20);
    assert.deepEqual(validateGameMap(map), [], `seed ${seed} is invalid`);
    assert.ok(findTowerSites(map).length >= MIN_TOWER_SITES, `seed ${seed} has too few tower sites`);
  }
});

test("generation stays deterministic per seed", () => {
  assert.deepEqual(generateMap(2024), generateMap(2024));
});

test("createMatch refuses to start with a malformed map", () => {
  assert.throws(
    () => createMatch({ players: [{ id: "p1", name: "A" }], seed: 1, map: { ...generateMap(1), schemaVersion: 99 } }),
    /unsupported-schema-version/
  );
});
