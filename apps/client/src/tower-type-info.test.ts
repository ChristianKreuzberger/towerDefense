import assert from "node:assert/strict";
import test from "node:test";

import { TOWER_TYPES } from "@tower-defense/shared";
import { TOWER_TYPE_COLOR, TOWER_TYPE_LABEL, describeTowerType, towerTooltipRows } from "./tower-type-info.js";

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

const base = { upgrades: { range: 1, damage: 1, accuracy: 1 }, damageType: "physical" as const, hp: 100, maxHp: 175 };

test("tooltip rows use the tower's own type, not the arrow numbers", () => {
  const rows = (type: "arrow" | "cannon" | "frost") => new Map(towerTooltipRows({ ...base, towerType: type }));
  assert.equal(rows("arrow").get("Range"), "6 cells (1/5)");
  assert.equal(rows("cannon").get("Range"), "5 cells (1/5)");
  assert.equal(rows("cannon").get("Damage"), "2 per shot (1/5)");
  assert.equal(rows("cannon").get("Health"), "100/175");
  assert.ok(rows("cannon").has("Splash"));
  assert.ok(!rows("cannon").has("Slow"));
  assert.match(rows("frost").get("Slow") ?? "", /60% speed/);
  assert.ok(!rows("arrow").has("Splash"));
});
