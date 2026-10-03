import assert from "node:assert/strict";
import test from "node:test";

import { rollShot } from "./shot-roll.js";

test("rolls are deterministic and within [0, 1)", () => {
  assert.equal(rollShot(777, 1, 9, "tower-p1"), rollShot(777, 1, 9, "tower-p1"));
  for (let tick = 0; tick < 500; tick += 1) {
    const roll = rollShot(777, 2, tick, "tower-p1");
    assert.ok(roll >= 0 && roll < 1);
  }
});

test("rolls differ by seed, wave, tick and tower", () => {
  const base = rollShot(777, 1, 9, "tower-p1");
  assert.notEqual(rollShot(778, 1, 9, "tower-p1"), base);
  assert.notEqual(rollShot(777, 2, 9, "tower-p1"), base);
  assert.notEqual(rollShot(777, 1, 10, "tower-p1"), base);
  assert.notEqual(rollShot(777, 1, 9, "tower-p2"), base);
});

test("rolls are spread evenly enough that observed hit rate tracks accuracy", () => {
  for (const accuracy of [0.7, 0.85, 1]) {
    let hits = 0;
    const shots = 4000;
    for (let tick = 0; tick < shots; tick += 1) {
      if (rollShot(42, 1 + (tick % 7), tick, `tower-p${1 + (tick % 3)}`) < accuracy) {
        hits += 1;
      }
    }
    assert.ok(Math.abs(hits / shots - accuracy) < 0.03, `accuracy ${accuracy} gave ${hits / shots}`);
  }
  assert.equal(rollShot(1, 1, 1, "x") < 1, true);
});
