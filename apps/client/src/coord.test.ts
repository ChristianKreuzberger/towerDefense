import assert from "node:assert/strict";
import test from "node:test";
import { clampCoord, coordValue } from "./coord.js";

test("coordValue parses whole numbers", () => {
  assert.equal(coordValue({ value: "7" }), 7);
  assert.equal(coordValue({ value: " 12 " }), 12);
  assert.equal(coordValue({ value: "0" }), 0);
});

test("coordValue falls back to 0 for empty, text and non-finite input", () => {
  assert.equal(coordValue({ value: "" }), 0);
  assert.equal(coordValue({ value: "abc" }), 0);
  assert.equal(coordValue({ value: "NaN" }), 0);
  assert.equal(coordValue({ value: "Infinity" }), 0);
});

test("coordValue truncates fractions so the result is always an integer", () => {
  assert.equal(coordValue({ value: "3.9" }), 3);
  assert.equal(coordValue({ value: "-2.5" }), -2);
  assert.ok(Number.isInteger(coordValue({ value: "1e1" })));
});

test("clampCoord keeps values inside the map and tolerates NaN", () => {
  assert.equal(clampCoord(5, 10), 5);
  assert.equal(clampCoord(-3, 10), 0);
  assert.equal(clampCoord(99, 10), 9);
  assert.equal(clampCoord(Number.NaN, 10), 0);
  assert.equal(clampCoord(4, 0), 0);
});
