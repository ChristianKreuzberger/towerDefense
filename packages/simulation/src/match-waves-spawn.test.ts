import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  MOVEMENT_PROGRESS_UNITS_PER_CELL,
  type MatchEvent,
  getCreatureMovementSpeedUnits,
  PATH_CELL_MAX_WEAR,
  getWaveCreatureCount,
} from "@tower-defense/shared";
import { getBuildableCoordinate, getBuildableCoordinates, createSinglePlayerWaveSimulation, tickUntil, LANE_SEEDS, createPrepMatchWithTower } from "./test-helpers.js";

test("records wave-start event when readiness transitions into wave", () => {
  const towerCoordinate = getBuildableCoordinate(20);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 20
  });

  simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: towerCoordinate.x,
    y: towerCoordinate.y
  });

  const ready = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  assert.equal(ready.accepted, true);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.phase, "wave");
  assert.equal(snapshot.wave, 1);
  assert.equal(snapshot.waveTick, 0);
  assert.deepEqual(snapshot.events, [{ type: "wave-start", wave: 1, tick: 0 }]);
});

test("spawns creatures on deterministic wave ticks", () => {
  const simulation = createSinglePlayerWaveSimulation(21);

  for (let tick = 0; tick < 50 && simulation.getSnapshot().phase === "wave"; tick += 1) {
    const result = simulation.applyCommand({ type: "advance-wave" });
    assert.equal(result.accepted, true);
  }

  const snapshot = simulation.getSnapshot();
  const spawnEvents = snapshot.events.filter((event) => event.type === "creature-spawned");
  assert.equal(spawnEvents.length, 3);
  assert.deepEqual(
    spawnEvents.map((event) => event.tick),
    [1, 3, 5]
  );
  assert.deepEqual(
    spawnEvents.map((event) => event.creatureId),
    ["wave-1-creature-1", "wave-1-creature-2", "wave-1-creature-3"]
  );
});

test("moves creatures forward by one path index on each wave tick", () => {
  const simulation = createSinglePlayerWaveSimulation(23);

  simulation.applyCommand({ type: "advance-wave" });
  let snapshot = simulation.getSnapshot();
  const firstCreatureAfterTickOne = snapshot.creatures.find((creature) => creature.id === "wave-1-creature-1");
  const spawnEventTickOne = snapshot.events.find(
    (event) => event.type === "creature-spawned" && event.creatureId === "wave-1-creature-1" && event.tick === 1
  );
  assert.ok(spawnEventTickOne);

  if (!firstCreatureAfterTickOne) {
    const firstCreatureExitTickOne = snapshot.events.find(
      (event) => event.type === "creature-exited" && event.creatureId === "wave-1-creature-1" && event.tick === 1
    );
    assert.ok(firstCreatureExitTickOne);
    return;
  }

  assert.equal(firstCreatureAfterTickOne.spawnTick, 1);
  assert.ok(firstCreatureAfterTickOne.pathIndex >= 0);

  simulation.applyCommand({ type: "advance-wave" });
  snapshot = simulation.getSnapshot();
  const firstCreatureAfterTickTwo = snapshot.creatures.find((creature) => creature.id === "wave-1-creature-1");
  const firstCreatureDefeatedTickTwo = snapshot.events.find(
    (event) => event.type === "creature-defeated" && event.creatureId === "wave-1-creature-1"
  );

  if (firstCreatureAfterTickTwo) {
    assert.equal(firstCreatureAfterTickTwo.pathIndex, 1);
  } else {
    // The tower can kill it before it moves on now that the lane is long enough to cross the map.
    assert.ok(firstCreatureDefeatedTickTwo);
    assert.equal(firstCreatureDefeatedTickTwo.tick, 2);
  }
});

test("applies deterministic movement speed modifiers from path wear", () => {
  assert.equal(getCreatureMovementSpeedUnits(0), 100);
  assert.equal(getCreatureMovementSpeedUnits(1), 90);
  assert.equal(getCreatureMovementSpeedUnits(4), 60);
  assert.equal(getCreatureMovementSpeedUnits(6), 40);
  assert.equal(getCreatureMovementSpeedUnits(8), 40);
  assert.equal(getCreatureMovementSpeedUnits(99), 40);
});

test("raises path wear on a lane cell when a creature walks onto it during the wave", () => {
  const simulation = createSinglePlayerWaveSimulation(48);
  let steppedCell: { x: number; y: number } | undefined;

  for (let step = 0; step < 200 && !steppedCell; step += 1) {
    assert.equal(simulation.applyCommand({ type: "advance-wave" }).accepted, true);
    const movement = simulation.getSnapshot().events.find(
      (event): event is Extract<MatchEvent, { type: "movement-resolved" }> =>
        event.type === "movement-resolved" && event.steps.length > 0
    );
    const lastStep = movement?.steps[movement.steps.length - 1];
    if (lastStep) {
      steppedCell = { x: lastStep.toX, y: lastStep.toY };
    }
  }

  assert.ok(steppedCell);
  const cell = simulation.getSnapshot().map.cells.find((entry) => entry.x === steppedCell?.x && entry.y === steppedCell?.y);
  assert.ok(cell);
  assert.ok(cell.pathWear > 0);
  assert.ok(cell.pathWear <= PATH_CELL_MAX_WEAR);
});

test("emits deterministic movement-resolved event payload and ordering", () => {
  const simulation = createSinglePlayerWaveSimulation(48);

  assert.equal(simulation.applyCommand({ type: "advance-wave" }).accepted, true);
  assert.equal(simulation.applyCommand({ type: "advance-wave" }).accepted, true);

  const snapshot = simulation.getSnapshot();
  const movementEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "movement-resolved" }> => event.type === "movement-resolved"
  );
  assert.equal(movementEvents.length, 1);

  const movement = movementEvents[0];
  assert.ok(movement);
  assert.equal(movement.tick, 2);
  assert.equal(movement.creatureId, "wave-1-creature-1");
  assert.equal(movement.fromPathIndex, 0);
  assert.equal(movement.fromProgressUnits, 0);
  assert.equal(movement.speedUnits, getCreatureMovementSpeedUnits(0));
  assert.equal(movement.sourceCellWear, 0);
  assert.ok(movement.toPathIndex >= movement.fromPathIndex);

  if (movement.exited) {
    assert.equal(movement.steps.length, 0);
    assert.equal(movement.toProgressUnits, 0);
  } else {
    assert.equal(movement.steps.length, movement.toPathIndex - movement.fromPathIndex);
    assert.equal(movement.steps[0]?.fromPathIndex, 0);
    assert.equal(movement.steps[0]?.toPathIndex, 1);
    assert.equal(movement.toProgressUnits, 0);
  }

  const movementEventIndex = snapshot.events.findIndex(
    (event) => event.type === "movement-resolved" && event.tick === 2
  );
  const targetEventIndex = snapshot.events.findIndex(
    (event) => event.type === "targets-selected" && event.tick === 2
  );
  const spawnEventIndex = snapshot.events.findIndex(
    (event) => event.type === "creature-spawned" && event.tick === 1
  );
  assert.ok(movementEventIndex >= 0);
  assert.ok(spawnEventIndex >= 0);
  assert.ok(targetEventIndex >= 0);
  assert.ok(spawnEventIndex < movementEventIndex);
  assert.ok(movementEventIndex < targetEventIndex);
});

test("movement-resolution traces are reproducible across equivalent runs", () => {
  const runScenario = (): Array<Extract<MatchEvent, { type: "movement-resolved" }>> => {
    const simulation = createSinglePlayerWaveSimulation(49);

    for (let tick = 0; tick < 4; tick += 1) {
      const result = simulation.applyCommand({ type: "advance-wave" });
      assert.equal(result.accepted, true);
    }

    const snapshot = simulation.getSnapshot();
    return snapshot.events.filter(
      (event): event is Extract<MatchEvent, { type: "movement-resolved" }> => event.type === "movement-resolved"
    );
  };

  const firstRun = runScenario();
  const secondRun = runScenario();
  assert.deepEqual(firstRun, secondRun);

  for (const event of firstRun) {
    assert.ok(event.toProgressUnits >= 0);
    assert.ok(event.toProgressUnits < MOVEMENT_PROGRESS_UNITS_PER_CELL);
  }
});

test("ends wave only after spawn schedule completes and all creatures exit", () => {
  const simulation = createSinglePlayerWaveSimulation(24);

  for (let tick = 0; tick < 200 && simulation.getSnapshot().phase === "wave"; tick += 1) {
    const result = simulation.applyCommand({ type: "advance-wave" });
    assert.equal(result.accepted, true);
  }

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.phase, "placement");
  assert.equal(snapshot.wave, 2);
  assert.equal(snapshot.waveTick, 0);
  assert.equal(snapshot.players[0]?.readyForWave, false);

  const spawnEvents = snapshot.events.filter((event) => event.type === "creature-spawned");
  const exitEvents = snapshot.events.filter((event) => event.type === "creature-exited");
  const defeatedEvents = snapshot.events.filter((event) => event.type === "creature-defeated");
  const waveEndEvent = snapshot.events.find((event) => event.type === "wave-end");

  assert.equal(spawnEvents.length, 3);
  assert.equal(exitEvents.length + defeatedEvents.length, 3);
  assert.ok(waveEndEvent);
  assert.ok(waveEndEvent.tick >= 5);
});

test("rejects advance-wave when wave phase is not active", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 22
  });

  const result = simulation.applyCommand({ type: "advance-wave" });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "wave-phase-not-active");
});

test("creatures travel across the map instead of exiting after one cell", () => {
  for (const seed of LANE_SEEDS) {
    // The corridor cells are the only route, so the tower goes on a cell that does not cut it.
    const towerCell = getBuildableCoordinate(seed);
    const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
    simulation.applyCommand({ type: "place-tower", playerId: "p1", x: towerCell.x, y: towerCell.y });
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

    let furthest = 0;
    for (let step = 0; step < 40; step += 1) {
      simulation.applyCommand({ type: "advance-wave" });
      for (const event of simulation.getSnapshot().events) {
        if (event.type === "movement-resolved") {
          furthest = Math.max(furthest, event.toPathIndex);
        }
      }
    }
    assert.ok(furthest > 1, `seed ${seed}: creature path is a single cell (furthest index ${furthest})`);
  }
});

test("survivors can start the next wave after another player is eliminated", () => {
  const seed = 85;
  const cells = getBuildableCoordinates(seed, 2);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed
  });
  cells.forEach((cell, index) => {
    assert.equal(
      simulation.applyCommand({ type: "place-tower", playerId: `p${index + 1}`, x: cell.x, y: cell.y }).accepted,
      true
    );
  });

  // Eliminate p2 directly; the combat path to elimination is covered elsewhere.
  const internals = simulation as unknown as {
    state: { players: Array<{ id: string; eliminated: boolean }>; towers: Array<{ playerId: string }> };
  };
  internals.state.players[1]!.eliminated = true;
  internals.state.towers = internals.state.towers.filter((tower) => tower.playerId !== "p2");

  assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" }).reason, "player-eliminated");
  assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" }).accepted, true);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.phase, "wave");
  assert.equal(snapshot.events.some((event) => event.type === "wave-start"), true);
});

test("allPlayersReadyForWave ignores eliminated players", () => {
  const seed = 85;
  const cells = getBuildableCoordinates(seed, 2);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed
  });
  cells.forEach((cell, index) => {
    simulation.applyCommand({ type: "place-tower", playerId: `p${index + 1}`, x: cell.x, y: cell.y });
  });
  const internals = simulation as unknown as {
    state: { players: Array<{ readyForWave: boolean; eliminated: boolean }> };
  };
  internals.state.players[0]!.readyForWave = true;
  internals.state.players[1]!.eliminated = true;

  assert.equal(simulation.getSnapshot().allPlayersReadyForWave, true);
});

test("creaturesToSpawn counts down during a wave and previews the next wave in prep", () => {
  const simulation = createPrepMatchWithTower(31);
  assert.equal(simulation.getSnapshot().creaturesToSpawn, getWaveCreatureCount(1));

  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  assert.equal(simulation.getSnapshot().creaturesToSpawn, getWaveCreatureCount(1));
  const seen: number[] = [];
  tickUntil(
    simulation,
    () => {
      const snapshot = simulation.getSnapshot();
      if (snapshot.phase === "wave") {
        seen.push(snapshot.creaturesToSpawn);
      }
      return snapshot.phase !== "wave";
    },
    400
  );
  assert.equal(Math.min(...seen), 0);
  assert.ok(seen.every((value, index) => index === 0 || value <= (seen[index - 1] ?? Infinity)), "never goes back up mid-wave");
  assert.ok(seen.includes(getWaveCreatureCount(1) - 1), "passes through partial counts");

  const afterWave = simulation.getSnapshot();
  assert.equal(afterWave.phase, "placement");
  assert.equal(afterWave.wave, 2);
  assert.equal(afterWave.creaturesToSpawn, getWaveCreatureCount(2));
});

test("when the route is recomputed mid-wave, live creatures stay on their own cell", () => {
  const simulation = createSinglePlayerWaveSimulation(31);
  tickUntil(simulation, () => simulation.getSnapshot().creatures.length > 0 && simulation.getSnapshot().waveTick > 12, 60);
  const internals = simulation as unknown as {
    state: { creatures: Array<{ x: number; y: number; pathIndex: number }> };
    currentWavePath: Array<{ x: number; y: number }>;
    refreshCreatureRoute(): void;
  };
  const creature = internals.state.creatures[0];
  assert.ok(creature && creature.pathIndex > 0);
  const cell = { x: creature.x, y: creature.y };
  // A stale index (as after a route change) must be re-anchored to the creature's own position on the new route.
  creature.pathIndex = 0;
  internals.refreshCreatureRoute();
  const anchored = internals.currentWavePath[creature.pathIndex];
  assert.deepEqual({ x: anchored?.x, y: anchored?.y }, cell);
});

test("a creature cut off from its route cell is re-anchored by walking distance and moved onto the new route", () => {
  const simulation = createSinglePlayerWaveSimulation(31);
  tickUntil(simulation, () => simulation.getSnapshot().creatures.length > 0 && simulation.getSnapshot().waveTick > 12, 60);
  const internals = simulation as unknown as {
    state: {
      creatures: Array<{ x: number; y: number; pathIndex: number; pathProgressUnits: number }>;
      towers: Array<{ id: string; x: number; y: number }>;
    };
    currentWavePath: Array<{ x: number; y: number }>;
    refreshCreatureRoute(): void;
  };
  const snapshot = simulation.getSnapshot();
  const walkable = new Set(snapshot.map.cells.filter((cell) => cell.buildable).map((cell) => `${cell.x},${cell.y}`));
  const towers = new Set(snapshot.towers.map((tower) => `${tower.x},${tower.y}`));
  const walkingDistance = (from: { x: number; y: number }, to: { x: number; y: number }, blocker: { x: number; y: number }): number => {
    const seen = new Map<string, number>([[`${from.x},${from.y}`, 0]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i += 1) {
      const cell = queue[i]!;
      const dist = seen.get(`${cell.x},${cell.y}`)!;
      if (cell.x === to.x && cell.y === to.y) {
        return dist;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = { x: cell.x + dx, y: cell.y + dy };
        const key = `${next.x},${next.y}`;
        if (walkable.has(key) && !towers.has(key) && key !== `${blocker.x},${blocker.y}` && !seen.has(key)) {
          seen.set(key, dist + 1);
          queue.push(next);
        }
      }
    }
    return Number.POSITIVE_INFINITY;
  };

  const creature = internals.state.creatures[0]!;
  const original = [...internals.currentWavePath];
  const placedTowers = internals.state.towers;
  const withBlockerAt = (cell: { x: number; y: number }) => [...placedTowers, { id: "tower-test", x: cell.x, y: cell.y }];
  let reanchored = 0;
  // Block each route cell in turn; where the maze offers a detour, the cells it bypasses leave the route.
  for (let blockIndex = 2; blockIndex < original.length - 2; blockIndex += 1) {
    const blocked = original[blockIndex]!;
    internals.state.towers = withBlockerAt(blocked);
    internals.refreshCreatureRoute();
    const detour = new Set(internals.currentWavePath.map((cell) => `${cell.x},${cell.y}`));
    const bypassed = original.slice(blockIndex + 1).find((cell) => !detour.has(`${cell.x},${cell.y}`));
    if (!bypassed) {
      continue;
    }
    // Put the creature on a cell the detour no longer uses, then recompute the route as a destroyed tower would.
    internals.state.towers = placedTowers;
    internals.refreshCreatureRoute();
    internals.state.towers = withBlockerAt(blocked);
    Object.assign(creature, { x: bypassed.x, y: bypassed.y, pathProgressUnits: 500 });
    internals.refreshCreatureRoute();
    const anchor = internals.currentWavePath[creature.pathIndex]!;
    assert.deepEqual({ x: creature.x, y: creature.y }, { x: anchor.x, y: anchor.y }, "x/y follow the new anchor");
    assert.equal(creature.pathProgressUnits, 0, "progress resets when the creature moves to another cell");
    const nearestByWalking = Math.min(
      ...internals.currentWavePath.map((cell) => walkingDistance(bypassed, cell, blocked))
    );
    assert.equal(walkingDistance(bypassed, anchor, blocked), nearestByWalking, "anchor is the closest route cell by walking distance");
    reanchored += 1;
    internals.state.towers = placedTowers;
    internals.refreshCreatureRoute();
  }
  assert.ok(reanchored > 0, "expected the maze to offer at least one detour");
});
