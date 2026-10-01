import assert from "node:assert/strict";
import { test } from "node:test";
import { describeRuin, ownerNameFor } from "./ruins.js";

test("describes whose tower it was and when it fell", () => {
  assert.deepEqual(describeRuin({ ownerName: "Ada", wave: 3 }), {
    title: "Ruins of Ada's tower",
    detail: "Destroyed in wave 3"
  });
});

test("looks up the owner name and falls back to the id", () => {
  const players = [{ id: "p1", name: " Ada " }, { id: "p2", name: "" }];
  assert.equal(ownerNameFor(players, "p1"), "Ada");
  assert.equal(ownerNameFor(players, "p2"), "p2");
  assert.equal(ownerNameFor(players, "p9"), "p9");
});
