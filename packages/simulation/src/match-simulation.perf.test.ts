import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createMatch } from "./match-simulation.js";
import { generateMap } from "./procedural-map.js";

test("8-player match reports tick runtime over three waves", () => {
  const playerIds = Array.from({ length: 8 }, (_, index) => `p${index + 1}`);
  const simulation = createMatch({
    players: playerIds.map((id) => ({ id, name: `Player ${id.slice(1)}` })),
    seed: 2024
  });
  // Towers have a limited range, so candidates are ordered by distance to the spawn gate (the lane start).
  const spawnProbe = createMatch({ players: [{ id: "p1", name: "Probe" }], seed: 2024 });
  const probeCell = generateMap(2024).cells.find((cell) => cell.buildable);
  assert.ok(probeCell);
  spawnProbe.applyCommand({ type: "place-tower", playerId: "p1", x: probeCell.x, y: probeCell.y });
  spawnProbe.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  spawnProbe.applyCommand({ type: "advance-wave" });
  const spawn = spawnProbe.getSnapshot().creatures[0];
  assert.ok(spawn);
  const candidates = generateMap(2024)
    .cells.filter((cell) => cell.buildable)
    .sort((a, b) => Math.hypot(a.x - spawn.x, a.y - spawn.y) - Math.hypot(b.x - spawn.x, b.y - spawn.y));

  for (const playerId of playerIds) {
    let placed = false;
    for (const cell of candidates) {
      const result = simulation.applyCommand({
        type: "place-tower",
        playerId,
        x: cell.x,
        y: cell.y
      });
      if (result.accepted) {
        placed = true;
        break;
      }
    }
    assert.equal(placed, true, `${playerId} should receive a valid tower placement`);
  }

  for (const playerId of playerIds) {
    assert.equal(
      simulation.applyCommand({ type: "ready-for-wave", playerId }).accepted,
      true,
      `${playerId} should be ready for the wave`
    );
  }

  const durations: number[] = [];
  let completedWaves = 0;
  let safetyTicks = 0;

  while (completedWaves < 3) {
    const before = simulation.getSnapshot();
    assert.notEqual(before.phase, "ended", "8-player match should survive three waves");

    if (before.phase === "placement") {
      for (const playerId of playerIds) {
        assert.equal(
          simulation.applyCommand({ type: "ready-for-wave", playerId }).accepted,
          true,
          `${playerId} should be ready for wave ${before.wave}`
        );
      }
      continue;
    }

    const start = performance.now();
    const result = simulation.applyCommand({ type: "advance-wave" });
    durations.push(performance.now() - start);
    assert.equal(result.accepted, true, "wave tick should be accepted during combat");

    safetyTicks += 1;
    assert.ok(safetyTicks < 500, "performance scenario should complete without stalling");
    const after = simulation.getSnapshot();
    if (before.phase === "wave" && after.phase === "placement") {
      completedWaves += 1;
    }
  }

  const maxTickMs = Math.max(...durations);
  const averageTickMs = durations.reduce((total, duration) => total + duration, 0) / durations.length;
  console.log(
    `8-player performance: ${durations.length} ticks, max=${maxTickMs.toFixed(2)}ms, ` +
    `avg=${averageTickMs.toFixed(2)}ms, target=16ms`
  );

  assert.ok(durations.length > 0, "performance scenario should measure ticks");
  assert.ok(maxTickMs < 100, `single tick should not catastrophically exceed 100ms: ${maxTickMs.toFixed(2)}ms`);
  assert.ok(simulation.getSnapshot().creatures.length < 300, "active creatures should stay below the MVP limit");
});