import assert from "node:assert/strict";
import test from "node:test";

import { TOWER_TYPES } from "@tower-defense/shared";
import { TOWER_TYPE_COLOR, TOWER_TYPE_LABEL, describeTowerType } from "./tower-type-info.js";

test("every tower type has a label, a colour and a blurb built from the shared stats", () => {
  for (const type of TOWER_TYPES) {
    assert.ok(TOWER_TYPE_LABEL[type].length > 0);
    assert.equal(typeof TOWER_TYPE_COLOR[type], "number");
    assert.ok(describeTowerType(type).startsWith(TOWER_TYPE_LABEL[type]));
  }
  assert.match(describeTowerType("cannon"), /range 5, 60% accuracy/);
  assert.match(describeTowerType("frost"), /60% speed/);
  assert.match(describeTowerType("arrow"), /range 6, 70% accuracy/);
});
