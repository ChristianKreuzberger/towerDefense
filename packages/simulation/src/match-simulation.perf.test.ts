import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createMatch } from "./match-simulation.js";
import { getTowerSpotsNearSpawn } from "./spawn-order.js";

test("8-player match reports tick runtime over three waves", () => {
  const playerIds = Array.from({ length: 8 }, (_, index) => `p${index + 1}`);
  const simulation = createMatch({
    players: playerIds.map((id) => ({ id, name: `Player ${id.slice(1)}` })),
    seed: 2024
  });
  // The spots right next to the protected cave area get overrun now that creatures cannot be shot inside it, which
  // would eliminate players mid-scenario, so the scenario starts a little farther along the lane.
  const candidates = getTowerSpotsNearSpawn(2024).slice(3);

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

// Phase 3 content: all three tower types, and enough waves to see the splitter (wave 4+) and the juggernaut (wave 5).
test("8-player mixed-tower match reports tick runtime over six waves including splitter and boss", () => {
  const playerIds = Array.from({ length: 8 }, (_, index) => `p${index + 1}`);
  const towerTypes = ["arrow", "cannon", "frost"] as const;
  const simulation = createMatch({
    players: playerIds.map((id) => ({ id, name: `Player ${id.slice(1)}` })),
    seed: 2024
  });
  const candidates = getTowerSpotsNearSpawn(2024).slice(3);

  playerIds.forEach((playerId, index) => {
    const towerType = towerTypes[index % towerTypes.length] ?? "arrow";
    const placed = candidates.some((cell) => simulation.applyCommand({ type: "place-tower", playerId, x: cell.x, y: cell.y, towerType }).accepted);
    assert.equal(placed, true, `${playerId} should receive a valid ${towerType} placement`);
  });

  const durations: number[] = [];
  const seenArchetypes = new Set<string>();
  let maxCreatures = 0;
  let completedWaves = 0;
  let safetyTicks = 0;

  while (completedWaves < 6) {
    const before = simulation.getSnapshot();
    if (before.phase === "ended") {
      break;
    }
    if (before.phase === "placement") {
      for (const player of before.players.filter((entry) => !entry.eliminated)) {
        // Spend points on damage so the towers keep up and the match reaches the boss wave.
        simulation.applyCommand({ type: "upgrade-tower", playerId: player.id, towerId: `tower-${player.id}`, track: "damage" });
        simulation.applyCommand({ type: "ready-for-wave", playerId: player.id });
      }
      safetyTicks += 1;
      assert.ok(safetyTicks < 2000, "performance scenario should complete without stalling");
      continue;
    }

    const start = performance.now();
    const result = simulation.applyCommand({ type: "advance-wave" });
    durations.push(performance.now() - start);
    assert.equal(result.accepted, true, "wave tick should be accepted during combat");

    safetyTicks += 1;
    assert.ok(safetyTicks < 2000, "performance scenario should complete without stalling");
    const after = simulation.getSnapshot();
    for (const creature of after.creatures) {
      seenArchetypes.add(creature.archetype);
    }
    maxCreatures = Math.max(maxCreatures, after.creatures.length);
    if (before.phase === "wave" && after.phase === "placement") {
      completedWaves += 1;
    }
  }

  const maxTickMs = Math.max(...durations);
  const averageTickMs = durations.reduce((total, duration) => total + duration, 0) / durations.length;
  console.log(
    `8-player mixed-tower performance: ${durations.length} ticks over ${completedWaves} waves, max=${maxTickMs.toFixed(2)}ms, ` +
    `avg=${averageTickMs.toFixed(2)}ms, target=16ms, peak creatures=${maxCreatures}, archetypes=${[...seenArchetypes].sort().join("/")}`
  );

  assert.ok(seenArchetypes.has("splitter"), "scenario should include the splitter");
  assert.ok(seenArchetypes.has("juggernaut"), "scenario should include the juggernaut boss");
  assert.ok(maxTickMs < 100, `single tick should not catastrophically exceed 100ms: ${maxTickMs.toFixed(2)}ms`);
  assert.ok(maxCreatures < 300, "active creatures should stay below the MVP limit");
});
