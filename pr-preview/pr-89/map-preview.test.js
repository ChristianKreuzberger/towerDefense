import assert from "node:assert/strict";
import test from "node:test";
import { MAP_SCHEMA_VERSION } from "@tower-defense/shared";
import { classifyMapCells } from "./map-preview.js";
// '.' is road, '#' is grass, 'o' is a tower spot.
function mapFrom(rows, spawn) {
    const cells = rows.flatMap((row, y) => [...row].map((char, x) => ({ x, y, buildable: char === ".", pathWear: 0 })));
    const towerSpots = rows.flatMap((row, y) => [...row].flatMap((char, x) => (char === "o" ? [{ x, y }] : [])));
    return { schemaVersion: MAP_SCHEMA_VERSION, width: rows[0]?.length ?? 0, height: rows.length, seed: 5, cells, towerSpots, ...(spawn ? { spawn } : {}) };
}
test("cells are classified as cave, lane, pad or blocked", () => {
    // Row 0: cave, road, grass, tower spot. Row 1: road, road, grass, grass.
    const grid = classifyMapCells(mapFrom(["..#o", "..##"], { x: 0, y: 0 }));
    assert.deepEqual(grid.map((row) => row.map((cell) => cell.kind)), [
        ["cave", "lane", "blocked", "pad"],
        ["lane", "lane", "blocked", "blocked"]
    ]);
});
test("the protected area is marked within the protection radius of the cave, including lane cells", () => {
    const wide = mapFrom([".".repeat(12), "#".repeat(12)], { x: 0, y: 0 });
    const grid = classifyMapCells(wide);
    assert.equal(grid[0]?.[1]?.isProtected, true);
    assert.equal(grid[0]?.[1]?.kind, "lane");
    assert.equal(grid[0]?.[4]?.isProtected, true);
    assert.equal(grid[0]?.[11]?.isProtected, false);
});
test("a map without a cave has no protected cells", () => {
    const grid = classifyMapCells(mapFrom(["o.", ".#"]));
    assert.equal(grid.flat().some((cell) => cell.isProtected), false);
    assert.equal(grid[0]?.[0]?.kind, "pad");
    assert.equal(grid[0]?.[1]?.kind, "lane");
});
