import assert from "node:assert/strict";
import test from "node:test";

import { getCreatureAttackDamageAt } from "./creature-types.js";

test("creature attack damage rises in steps as the tower gets closer", () => {
  const origin = { x: 10, y: 10 };
  assert.equal(getCreatureAttackDamageAt("runner", origin, { x: 11, y: 10 }), 4);
  assert.equal(getCreatureAttackDamageAt("runner", origin, { x: 11, y: 11 }), 4);
  assert.equal(getCreatureAttackDamageAt("runner", origin, { x: 12, y: 10 }), 2);
  assert.equal(getCreatureAttackDamageAt("runner", origin, { x: 12, y: 11 }), 2);
  assert.equal(getCreatureAttackDamageAt("runner", origin, { x: 13, y: 10 }), 0);
  assert.equal(getCreatureAttackDamageAt("armored", origin, { x: 12, y: 11 }), 5);
  assert.equal(getCreatureAttackDamageAt("tank", origin, { x: 13, y: 10 }), 4);
  assert.equal(getCreatureAttackDamageAt("tank", origin, { x: 13, y: 11 }), 4);
  assert.equal(getCreatureAttackDamageAt("tank", origin, { x: 13, y: 12 }), 0);
  assert.equal(getCreatureAttackDamageAt("tank", origin, { x: 10, y: 10 }), 11);
});
