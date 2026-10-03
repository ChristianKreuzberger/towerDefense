import assert from "node:assert/strict";
import test from "node:test";

import { MAP_SCHEMA_VERSION, type GameMap } from "./map-types.js";
import { findTowerSites, validateGameMap } from "./map-validation.js";

// '.' is buildable, '#' is not.
function mapFrom(rows: string[], overrides: Partial<GameMap> = {}): GameMap {
  const cells = rows.flatMap((row, y) =>
    [...row].map((char, x) => ({ x, y, buildable: char === ".", pathWear: 0 }))
  );
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    width: rows[0]?.length ?? 0,
    height: rows.length,
    seed: 1,
    cells,
    spawn: { x: 0, y: 1 },
    goal: { x: 4, y: 1 },
    ...overrides
  };
}

const VALID_ROWS = ["#####", ".....", "#####"];

function codes(map: GameMap): string[] {
  return validateGameMap(map).map((error) => error.code);
}

test("a well-formed map has no validation errors", () => {
  assert.deepEqual(validateGameMap(mapFrom(VALID_ROWS)), []);
});

test("rejects an unsupported schema version", () => {
  assert.deepEqual(codes(mapFrom(VALID_ROWS, { schemaVersion: 99 })), ["unsupported-schema-version"]);
});

test("rejects dimensions that do not match the cells", () => {
  assert.ok(codes(mapFrom(VALID_ROWS, { width: 6 })).includes("cell-count-mismatch"));
  assert.ok(codes(mapFrom(VALID_ROWS, { width: 0 })).includes("invalid-dimensions"));
});

test("rejects out-of-bounds and duplicate cells", () => {
  const base = mapFrom(VALID_ROWS);
  const outOfBounds = { ...base, cells: [...base.cells.slice(0, -1), { x: 9, y: 9, buildable: true, pathWear: 0 }] };
  assert.ok(codes(outOfBounds).includes("cell-out-of-bounds"));
  const duplicate = { ...base, cells: [...base.cells.slice(0, -1), { ...base.cells[0]! }] };
  assert.ok(codes(duplicate).includes("duplicate-cell"));
});

test("rejects a spawn that is missing, off the left edge or not buildable", () => {
  const withoutSpawn: Partial<GameMap> = mapFrom(VALID_ROWS);
  delete withoutSpawn.spawn;
  assert.ok(codes(withoutSpawn as GameMap).includes("spawn-missing"));
  assert.ok(codes(mapFrom(VALID_ROWS, { spawn: { x: 1, y: 1 } })).includes("spawn-not-on-left-edge"));
  assert.ok(codes(mapFrom(VALID_ROWS, { spawn: { x: 0, y: 0 } })).includes("spawn-not-buildable"));
});

test("rejects a goal that is missing, off the right edge or not buildable", () => {
  const withoutGoal: Partial<GameMap> = mapFrom(VALID_ROWS);
  delete withoutGoal.goal;
  assert.ok(codes(withoutGoal as GameMap).includes("goal-missing"));
  assert.ok(codes(mapFrom(VALID_ROWS, { goal: { x: 3, y: 1 } })).includes("goal-not-on-right-edge"));
  assert.ok(codes(mapFrom(VALID_ROWS, { goal: { x: 4, y: 0 } })).includes("goal-not-buildable"));
});

test("rejects a goal that cannot be reached from the spawn", () => {
  assert.deepEqual(codes(mapFrom([".....", "..#..", "....."], { spawn: { x: 0, y: 0 }, goal: { x: 4, y: 1 } })), []);
  assert.deepEqual(codes(mapFrom(["..#..", "..#..", "..#.."], { spawn: { x: 0, y: 0 }, goal: { x: 4, y: 1 } })), [
    "goal-unreachable"
  ]);
});

test("findTowerSites returns only pads that creatures cannot walk to, outside the cave area", () => {
  const walls = "############";
  const lane = "............";
  const map = mapFrom([walls, lane, walls, ".....#.#...."], { spawn: { x: 0, y: 1 }, goal: { x: 11, y: 1 } });
  // Cells x 0..4 of the last row are inside the cave's protected radius.
  assert.deepEqual(
    findTowerSites(map).map((cell) => `${cell.x},${cell.y}`),
    ["6,3", "8,3", "9,3", "10,3", "11,3"]
  );

  // Open cells beside the lane are walkable, so they are not sites.
  assert.deepEqual(findTowerSites(mapFrom([lane, lane, lane], { spawn: { x: 0, y: 1 }, goal: { x: 11, y: 1 } })), []);
});

test("rejects fractional cell coordinates", () => {
  const map = mapFrom(VALID_ROWS);
  map.cells[2] = { x: 0.5, y: 0, buildable: false, pathWear: 0 };
  assert.ok(codes(map).includes("cell-out-of-bounds"));
});

test("rejects a non-boolean buildable flag and a bad pathWear", () => {
  const badBuildable = mapFrom(VALID_ROWS);
  badBuildable.cells[0] = { x: 0, y: 0, buildable: "yes" as unknown as boolean, pathWear: 0 };
  assert.ok(codes(badBuildable).includes("invalid-cell"));
  for (const pathWear of [Number.NaN, -1, 9, Number.POSITIVE_INFINITY, "3" as unknown as number]) {
    const map = mapFrom(VALID_ROWS);
    map.cells[0] = { x: 0, y: 0, buildable: false, pathWear };
    assert.ok(codes(map).includes("invalid-cell"), `pathWear ${String(pathWear)}`);
  }
});

test("a non-array cells value returns an error instead of throwing", () => {
  const map = { ...mapFrom(VALID_ROWS), cells: null as unknown as GameMap["cells"] };
  assert.ok(codes(map).includes("cell-count-mismatch"));
});
