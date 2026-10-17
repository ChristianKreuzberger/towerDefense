import assert from "node:assert/strict";
import test from "node:test";

import { formatWavePreview } from "./wave-preview.js";

test("preview lists the wave number, each archetype with its count, weakness and resistance", () => {
  assert.equal(
    formatWavePreview(1),
    "Next wave 1: 2x Runner (weak: physical, resists: magic), 1x Swarm (weak: explosive, resists: physical), 1x Armored (weak: magic, resists: physical), 1x Tank (weak: physical, resists: explosive)"
  );
  assert.equal(
    formatWavePreview(3),
    "Next wave 3: 2x Runner (weak: physical, resists: magic), 2x Swarm (weak: explosive, resists: physical), 2x Armored (weak: magic, resists: physical), 2x Tank (weak: physical, resists: explosive)"
  );
});
