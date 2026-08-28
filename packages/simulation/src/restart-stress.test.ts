import assert from "node:assert/strict";
import test from "node:test";

import { createMatch } from "./match-simulation.js";

test("repeated match restarts preserve fresh deterministic state", () => {
  const seeds = [42, 77, 2024, 123, 999];
  const mapsBySeed = new Map<number, string>();

  for (let restart = 0; restart < 1_000; restart += 1) {
    const seed = seeds[restart % seeds.length] ?? 42;
    const snapshot = createMatch({
      players: [{ id: "p1", name: "Player 1" }],
      seed
    }).getSnapshot();
    const mapSignature = JSON.stringify(snapshot.map);

    assert.equal(snapshot.phase, "placement");
    assert.equal(snapshot.wave, 1);
    assert.equal(snapshot.towers.length, 0);
    assert.equal(snapshot.walls.length, 0);
    assert.equal(snapshot.players[0]?.points, 0);

    const previousSignature = mapsBySeed.get(seed);
    if (previousSignature !== undefined) {
      assert.equal(mapSignature, previousSignature, `seed ${seed} should reproduce its map`);
    } else {
      mapsBySeed.set(seed, mapSignature);
    }
  }

  assert.equal(mapsBySeed.size, seeds.length);
});