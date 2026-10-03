import assert from "node:assert/strict";
import test from "node:test";

import { MAP_SCHEMA_VERSION, type GameMap } from "./map-types.js";
import { validateGameMap } from "./map-validation.js";

// '.' is road (buildable), '#' is grass, 'o' is grass with a tower spot.
function mapFrom(rows: string[], overrides: Partial<GameMap> = {}): GameMap {
  const cells = rows.flatMap((row, y) =>
    [...row].map((char, x) => ({ x, y, buildable: char === ".", pathWear: 0 }))
  );
  const towerSpots = rows.flatMap((row, y) =>
    [...row].flatMap((char, x) => (char === "o" ? [{ x, y }] : []))
  );
  const width = rows[0]?.length ?? 0;
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    width,
    height: rows.length,
    seed: 1,
    cells,
    towerSpots,
    spawn: { x: 0, y: 1 },
    goal: { x: width - 1, y: 1 },
    ...overrides
  };
}

// Cave protection reaches x = 5 on the road row, so the eight spots start at x = 6.
const VALID_ROWS = ["##############", "..............", "##############", "##############", "######oooooooo"];
const SPOTS = "######oooooooo";

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
  assert.ok(codes(mapFrom(VALID_ROWS, { goal: { x: 12, y: 1 } })).includes("goal-not-on-right-edge"));
  assert.ok(codes(mapFrom(VALID_ROWS, { goal: { x: 13, y: 0 } })).includes("goal-not-buildable"));
});

test("rejects a goal that cannot be reached from the spawn", () => {
  const open = [".............."  , "......#.......", "..............", SPOTS];
  assert.deepEqual(codes(mapFrom(open, { spawn: { x: 0, y: 0 }, goal: { x: 13, y: 1 } })), []);
  const walled = ["......#.......", "......#.......", "......#.......", SPOTS];
  assert.deepEqual(codes(mapFrom(walled, { spawn: { x: 0, y: 0 }, goal: { x: 13, y: 1 } })), ["goal-unreachable"]);
});

test("rejects a map without a tower spot list or with too few spots", () => {
  const noList: Partial<GameMap> = mapFrom(VALID_ROWS);
  delete noList.towerSpots;
  assert.deepEqual(codes(noList as GameMap), ["missing-tower-spots"]);
  const few = mapFrom(VALID_ROWS);
  few.towerSpots = few.towerSpots.slice(0, 7);
  assert.deepEqual(codes(few), ["too-few-tower-spots"]);
});

test("rejects tower spots on the road, inside the cave area, duplicated or out of bounds", () => {
  const base = mapFrom(VALID_ROWS);
  const spots = base.towerSpots;
  assert.ok(codes({ ...base, towerSpots: [...spots, { x: 7, y: 1 }] }).includes("tower-spot-on-lane"));
  assert.ok(codes({ ...base, towerSpots: [...spots, { x: 2, y: 3 }] }).includes("tower-spot-in-spawn-protection"));
  assert.ok(codes({ ...base, towerSpots: [...spots, { ...spots[0]! }] }).includes("duplicate-tower-spot"));
  assert.ok(codes({ ...base, towerSpots: [...spots, { x: 40, y: 3 }] }).includes("tower-spot-out-of-bounds"));
});

test("rejects a version 1 map, which has no tower spots", () => {
  assert.ok(codes(mapFrom(VALID_ROWS, { schemaVersion: 1 })).includes("unsupported-schema-version"));
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
