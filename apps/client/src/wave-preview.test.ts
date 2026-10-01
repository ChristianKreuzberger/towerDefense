import assert from "node:assert/strict";
import test from "node:test";

import { formatWavePreview } from "./wave-preview.js";

test("preview lists the wave number and each archetype with its count", () => {
  assert.equal(formatWavePreview(1), "Next wave 1: 1x Runner, 1x Swarm, 1x Armored");
  assert.equal(formatWavePreview(3), "Next wave 3: 2x Runner, 1x Swarm, 1x Armored, 1x Tank");
});
