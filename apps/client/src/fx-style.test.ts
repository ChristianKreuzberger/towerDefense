import assert from "node:assert/strict";
import test from "node:test";

import { DAMAGE_TYPES } from "@tower-defense/shared";
import { DAMAGE_TYPE_FX_COLOR, isBigKill, shakeScale } from "./scene/fx-style.js";

test("every damage type has its own hit colour", () => {
  const colors = DAMAGE_TYPES.map((type) => DAMAGE_TYPE_FX_COLOR[type]);
  assert.equal(new Set(colors).size, DAMAGE_TYPES.length);
});

test("shake grows with damage but is capped", () => {
  assert.equal(shakeScale(1), 1);
  assert.ok(shakeScale(4) > shakeScale(2));
  assert.equal(shakeScale(100), 2);
  assert.equal(shakeScale(0), 1);
});

test("only tank and boss rewards count as big kills", () => {
  assert.equal(isBigKill(10), false);
  assert.equal(isBigKill(20), true);
  assert.equal(isBigKill(60), true);
});
