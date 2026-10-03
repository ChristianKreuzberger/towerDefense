import assert from "node:assert/strict";
import test from "node:test";

import { formatWavePreview } from "./wave-preview.js";

test("preview lists the wave number, each archetype with its count and its weakness", () => {
  assert.equal(
    formatWavePreview(1),
    "Next wave 1: 2x Runner (weak: physical), 1x Swarm (weak: explosive), 1x Armored (weak: magic), 1x Tank (weak: physical)"
  );
  assert.equal(
    formatWavePreview(3),
    "Next wave 3: 2x Runner (weak: physical), 2x Swarm (weak: explosive), 2x Armored (weak: magic), 2x Tank (weak: physical)"
  );
});
