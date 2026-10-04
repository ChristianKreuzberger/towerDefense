import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  STARTING_POINTS,
  BASE_TOWER_RANGE,
  SPAWN_PROTECTION_TICKS,
  TOWER_RANGE_PER_LEVEL,
  type MatchEvent,
  type CreatureArchetype,
  getTowerRange,
  MAX_TOWER_LEVEL,
  getDamageAgainst,
  DAMAGE_TYPES,
  type DamageType,
  type Tower,
} from "@tower-defense/shared";
import { getTowerSpotsNearSpawn } from "./spawn-order.js";
import { getBuildableCoordinate, getSecondBuildableCoordinate, createSinglePlayerWaveSimulation, tickUntil, advanceToFirstTargetableTick, findTowerCellAtDistance, tryFindTowerCellAtDistance, firstTickTarget, createPrepMatchWithTower } from "./test-helpers.js";

test("records deterministic target assignments on each wave tick", () => {
  const simulation = createSinglePlayerWaveSimulation(25);

  advanceToFirstTargetableTick(simulation);

  const snapshot = simulation.getSnapshot();
  const targetEvents = snapshot.events.filter((event) => event.type === "targets-selected");
  assert.equal(targetEvents.length, SPAWN_PROTECTION_TICKS + 1);
  assert.equal(targetEvents[targetEvents.length - 1]?.tick, SPAWN_PROTECTION_TICKS + 1);
  assert.equal(snapshot.targetAssignments.length, 1);
  assert.equal(snapshot.targetAssignments[0]?.towerId, "tower-p1");
  assert.equal(snapshot.targetAssignments[0]?.mode, "first");
  assert.equal(snapshot.targetAssignments[0]?.targetCreatureId, "wave-1-creature-1");
});

test("first mode prefers highest pathIndex with deterministic tie-break", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 26
  });

  const firstTower = getBuildableCoordinate(26);
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstTower.x, y: firstTower.y });
  // Explosive is neutral against the runner, so it keeps its 3 hp long enough to still be the "first" target.
  simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType: "explosive" });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "first" });

  // Creature 2 spawns on tick 3, so it is first targetable SPAWN_PROTECTION_TICKS + 3 ticks into the wave.
  const assignmentTick = SPAWN_PROTECTION_TICKS + 3;
  for (let tick = 0; tick < assignmentTick; tick += 1) {
    simulation.applyCommand({ type: "advance-wave" });
  }

  const snapshot = simulation.getSnapshot();
  const assignmentEvent = [...snapshot.events]
    .reverse()
    .find(
      (event): event is Extract<MatchEvent, { type: "targets-selected" }> =>
        event.type === "targets-selected" && event.tick === assignmentTick
    );
  assert.ok(assignmentEvent);
  const assignment = assignmentEvent.assignments.find((entry) => entry.towerId === "tower-p1");
  assert.equal(assignment?.targetCreatureId, "wave-1-creature-1");
});

test("last mode prefers lowest pathIndex", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 26
  });

  const firstTower = getBuildableCoordinate(26);
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstTower.x, y: firstTower.y });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "last" });

  // Creature 2 spawns on tick 3, so it is first targetable SPAWN_PROTECTION_TICKS + 3 ticks into the wave.
  const assignmentTick = SPAWN_PROTECTION_TICKS + 3;
  for (let tick = 0; tick < assignmentTick; tick += 1) {
    simulation.applyCommand({ type: "advance-wave" });
  }

  const snapshot = simulation.getSnapshot();
  const assignmentEvent = [...snapshot.events]
    .reverse()
    .find(
      (event): event is Extract<MatchEvent, { type: "targets-selected" }> =>
        event.type === "targets-selected" && event.tick === assignmentTick
    );
  assert.ok(assignmentEvent);
  const assignment = assignmentEvent.assignments.find((entry) => entry.towerId === "tower-p1");
  assert.equal(assignment?.targetCreatureId, "wave-1-creature-2");
});

test("strongest mode resolves hp ties deterministically", () => {
  // Seed picked so no tower shot misses before the tie: accuracy is now below 100%, so the rolled misses depend on the seed.
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 30
  });

  const firstTower = getBuildableCoordinate(30);
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstTower.x, y: firstTower.y });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "strongest" });

  // Creature 2 spawns on tick 3, so it is first targetable SPAWN_PROTECTION_TICKS + 3 ticks into the wave.
  const assignmentTick = SPAWN_PROTECTION_TICKS + 3;
  for (let tick = 0; tick < assignmentTick; tick += 1) {
    simulation.applyCommand({ type: "advance-wave" });
  }

  const snapshot = simulation.getSnapshot();
  const assignmentEvent = [...snapshot.events]
    .reverse()
    .find(
      (event): event is Extract<MatchEvent, { type: "targets-selected" }> =>
        event.type === "targets-selected" && event.tick === assignmentTick
    );
  assert.ok(assignmentEvent);
  const assignment = assignmentEvent.assignments.find((entry) => entry.towerId === "tower-p1");
  assert.equal(assignment?.targetCreatureId, "wave-1-creature-2");
});

test("nearest mode uses distance then deterministic fallback", () => {
  const runNearestAssignment = (): string | null => {
    const simulation = createSinglePlayerWaveSimulation(29);
    simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "nearest" });

    for (let tick = 0; tick < 3; tick += 1) {
      simulation.applyCommand({ type: "advance-wave" });
    }

    const snapshot = simulation.getSnapshot();
    return snapshot.targetAssignments.find((entry) => entry.towerId === "tower-p1")?.targetCreatureId ?? null;
  };

  assert.equal(runNearestAssignment(), runNearestAssignment());
});

test("target assignment snapshots and events are reproducible across equal runs", () => {
  const runCommands = (seed: number): { assignmentsByTick: unknown; events: unknown } => {
    const simulation = createSinglePlayerWaveSimulation(seed);

    for (let tick = 0; tick < 3; tick += 1) {
      const result = simulation.applyCommand({ type: "advance-wave" });
      assert.equal(result.accepted, true);
    }

    const snapshot = simulation.getSnapshot();
    const targetEvents = snapshot.events.filter((event) => event.type === "targets-selected");
    return {
      assignmentsByTick: targetEvents.map((event) => event.assignments),
      events: targetEvents
    };
  };

  const firstRun = runCommands(30);
  const secondRun = runCommands(30);
  assert.deepEqual(firstRun, secondRun);
});

test("emits hit events and reduces creature hp deterministically", () => {
  const simulation = createSinglePlayerWaveSimulation(21, "explosive");

  advanceToFirstTargetableTick(simulation);

  const snapshot = simulation.getSnapshot();
  const hitEvents = snapshot.events.filter((event) => event.type === "tower-hit");
  assert.equal(hitEvents.length, 1);
  assert.equal(hitEvents[0]?.towerId, "tower-p1");
  assert.equal(hitEvents[0]?.creatureId, "wave-1-creature-1");
  assert.equal(hitEvents[0]?.damage, 1);
  assert.equal(hitEvents[0]?.remainingHp, 2);

  const creature = snapshot.creatures.find((entry) => entry.id === "wave-1-creature-1");
  assert.ok(creature);
  assert.equal(creature.hp, 2);
});

test("emits creature-defeated event, removes creature, and awards points", () => {
  const firstTower = getBuildableCoordinate(32);
  const secondTower = getSecondBuildableCoordinate(32, firstTower);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed: 32
  });

  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstTower.x, y: firstTower.y });
  simulation.applyCommand({ type: "place-tower", playerId: "p2", x: secondTower.x, y: secondTower.y });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" });

  advanceToFirstTargetableTick(simulation);
  // Accuracy is below 100%, so the kill lands a few ticks later depending on the rolled misses.
  tickUntil(simulation, () => simulation.getSnapshot().events.some((event) => event.type === "creature-defeated"), 12);

  const snapshot = simulation.getSnapshot();
  const defeatedEvents = snapshot.events.filter((event) => event.type === "creature-defeated");
  assert.equal(defeatedEvents.length, 1);
  assert.equal(defeatedEvents[0]?.creatureId, "wave-1-creature-1");
  assert.equal(defeatedEvents[0]?.rewardPoints, 10);

  const killHitEvent = snapshot.events.find(
    (event) => event.type === "tower-hit" && event.creatureId === "wave-1-creature-1" && event.remainingHp === 0
  );
  assert.ok(killHitEvent);

  const defeatedCreature = snapshot.creatures.find((entry) => entry.id === "wave-1-creature-1");
  assert.equal(defeatedCreature, undefined);
  assert.equal((snapshot.players[0]?.points ?? 0) + (snapshot.players[1]?.points ?? 0), 10 + 2 * STARTING_POINTS);
});

test("resolves same-target multi-tower combat in deterministic towerId order", () => {
  // Seed picked (the first one that works on the route-only maps) so the shots land in the order the assertions describe: hits and misses depend on the seed.
  const runScenario = (): {
    events: {
      hitEvents: Array<{ towerId: string; creatureId: string; remainingHp: number }>;
      defeatedEvents: Array<{ towerId: string; playerId: string; creatureId: string; rewardPoints: number }>;
    };
    players: Array<{ id: string; points: number }>;
  } => {
    const firstTower = getBuildableCoordinate(21);
    const secondTower = getSecondBuildableCoordinate(21, firstTower);
    const simulation = createMatch({
      players: [
        { id: "p2", name: "Beta" },
        { id: "p1", name: "Alpha" }
      ],
      seed: 21
    });

    simulation.applyCommand({
      type: "place-tower",
      playerId: "p2",
      x: firstTower.x,
      y: firstTower.y
    });
    simulation.applyCommand({
      type: "place-tower",
      playerId: "p1",
      x: secondTower.x,
      y: secondTower.y
    });
    // Explosive is neutral against the runner, so the 3 hp runner still needs three hits as the assertions below describe.
    simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType: "explosive" });
    simulation.applyCommand({ type: "set-damage-type", playerId: "p2", towerId: "tower-p2", damageType: "explosive" });
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" });
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

    simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "first" });
    simulation.applyCommand({ type: "set-target-mode", playerId: "p2", towerId: "tower-p2", mode: "first" });

    advanceToFirstTargetableTick(simulation);
  // Accuracy is below 100%, so the kill lands a few ticks later depending on the rolled misses.
  tickUntil(simulation, () => simulation.getSnapshot().events.some((event) => event.type === "creature-defeated"), 12);

    const snapshot = simulation.getSnapshot();
    const hitEvents = snapshot.events.filter((event) => event.type === "tower-hit");
    const defeatedEvents = snapshot.events.filter((event) => event.type === "creature-defeated");
    return {
      events: { hitEvents, defeatedEvents },
      players: snapshot.players.map((player) => ({ id: player.id, points: player.points }))
    };
  };

  const firstRun = runScenario();
  const secondRun = runScenario();
  assert.deepEqual(firstRun, secondRun);

  assert.equal(firstRun.events.hitEvents.length, 3);
  assert.equal(firstRun.events.hitEvents[0]?.towerId, "tower-p1");
  assert.equal(firstRun.events.hitEvents[1]?.towerId, "tower-p2");
  assert.equal(firstRun.events.hitEvents[2]?.towerId, "tower-p1");
  assert.equal(firstRun.events.defeatedEvents.length, 1);
  assert.equal(firstRun.events.defeatedEvents[0]?.towerId, "tower-p1");
  assert.equal(firstRun.events.defeatedEvents[0]?.playerId, "p1");
  assert.equal(firstRun.events.defeatedEvents[0]?.creatureId, "wave-1-creature-1");
  assert.equal(firstRun.events.defeatedEvents[0]?.rewardPoints, 10);
  assert.deepEqual(firstRun.players, [
    { id: "p2", points: STARTING_POINTS },
    { id: "p1", points: STARTING_POINTS + 10 }
  ]);
});

test("level 1 tower range is 6 cells", () => {
  assert.equal(getTowerRange(1), 6);
});

test("tower range grows linearly with level and clamps below level 1", () => {
  assert.equal(getTowerRange(1), BASE_TOWER_RANGE);
  assert.equal(getTowerRange(3), BASE_TOWER_RANGE + (2 * TOWER_RANGE_PER_LEVEL));
  assert.ok(getTowerRange(2) > getTowerRange(1));
  assert.equal(getTowerRange(0), BASE_TOWER_RANGE);
});

test("tower range scales consistently for fractional levels", () => {
  assert.equal(getTowerRange(1.5), BASE_TOWER_RANGE + (0.5 * TOWER_RANGE_PER_LEVEL));
  assert.equal(getTowerRange(0.5), BASE_TOWER_RANGE);
  assert.ok(getTowerRange(1.5) > getTowerRange(1) && getTowerRange(1.5) < getTowerRange(2));
});

test("towers ignore creatures outside range in every target mode", () => {
  const seed = 40;
  const outOfRange = findTowerCellAtDistance(seed, getTowerRange(1), getTowerRange(2));
  for (const mode of ["first", "last", "strongest", "nearest"] as const) {
    assert.equal(firstTickTarget(seed, outOfRange, mode, 0), null, mode);
  }
});

test("range boundary is inclusive: creature at exactly range distance is targetable", () => {
  const range = getTowerRange(1);
  // Distances are checked via hypot, so only an axis-aligned cell gives an exact integer distance. With the short
  // range and moving creatures such a cell does not exist on every seed, so take the first seed that has one.
  let found: { seed: number; cell: { x: number; y: number } } | null = null;
  for (let seed = 1; seed < 300 && !found; seed += 1) {
    const cell = tryFindTowerCellAtDistance(seed, range - 1e-9, range);
    found = cell ? { seed, cell } : null;
  }
  assert.ok(found, "expected an exact-range cell on some seed");
  assert.equal(firstTickTarget(found.seed, found.cell, "first", 0), "wave-1-creature-1");
});

test("creature just beyond range is not targetable", () => {
  const seed = 54;
  const range = getTowerRange(1);
  const beyond = findTowerCellAtDistance(seed, range + 1e-9, range + 1);
  assert.equal(firstTickTarget(seed, beyond, "first", 0), null);
});

test("towers target creatures inside range in every target mode", () => {
  const seed = 40;
  const inRange = findTowerCellAtDistance(seed, 0, getTowerRange(1));
  for (const mode of ["first", "last", "strongest", "nearest"] as const) {
    assert.equal(firstTickTarget(seed, inRange, mode, 0), "wave-1-creature-1", mode);
  }
});

test("upgrading a tower extends its range to a previously out-of-range creature", () => {
  const seed = 40;
  const cell = findTowerCellAtDistance(seed, getTowerRange(1), getTowerRange(2));
  assert.equal(firstTickTarget(seed, cell, "first", 0), null);
  assert.equal(firstTickTarget(seed, cell, "first", 1), "wave-1-creature-1");
});

test("a freshly spawned creature is untargetable and undamaged until spawn protection ends", () => {
  const seed = 49;
  // The lane is independent of the tower, so record where creature 1 is on every tick 1..SPAWN_PROTECTION_TICKS + 1
  // and pick a cell that covers all of those positions: the creature is in range the whole time.
  const laneProbe = createMatch({ players: [{ id: "p1", name: "Probe" }], seed });
  const probeCells = [...getTowerSpotsNearSpawn(seed)].reverse();
  const probeCell = probeCells.find(
    (entry) => laneProbe.applyCommand({ type: "place-tower", playerId: "p1", x: entry.x, y: entry.y }).accepted
  );
  assert.ok(probeCell);
  laneProbe.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  const lane: Array<{ x: number; y: number }> = [];
  for (let tick = 1; tick <= SPAWN_PROTECTION_TICKS + 1; tick += 1) {
    laneProbe.applyCommand({ type: "advance-wave" });
    const probeCreature = laneProbe.getSnapshot().creatures.find((entry) => entry.id === "wave-1-creature-1");
    assert.ok(probeCreature);
    lane.push({ x: probeCreature.x, y: probeCreature.y });
  }
  const cell = getTowerSpotsNearSpawn(seed).find(
    (entry) =>
      lane.every((point) => Math.hypot(entry.x - point.x, entry.y - point.y) <= getTowerRange(1))
      && createMatch({ players: [{ id: "p1", name: "Alpha" }], seed })
        .applyCommand({ type: "place-tower", playerId: "p1", x: entry.x, y: entry.y }).accepted
  );
  assert.ok(cell, "expected a cell that covers the first creature during and right after spawn protection");
  const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
  assert.equal(simulation.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted, true);
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

  let baseHp: number | undefined;
  for (let tick = 1; tick <= SPAWN_PROTECTION_TICKS; tick += 1) {
    simulation.applyCommand({ type: "advance-wave" });
    const snapshot = simulation.getSnapshot();
    const creature = snapshot.creatures.find((entry) => entry.id === "wave-1-creature-1");
    assert.ok(creature, `creature exists on tick ${tick}`);
    // Without this the test could pass just because the creature is out of range.
    assert.ok(Math.hypot(cell.x - creature.x, cell.y - creature.y) <= getTowerRange(1), `in range on tick ${tick}`);
    baseHp ??= creature.hp;
    assert.equal(creature.hp, baseHp, `hp unchanged on tick ${tick}`);
    assert.equal(snapshot.targetAssignments[0]?.targetCreatureId ?? null, null, `no target on tick ${tick}`);
    assert.equal(snapshot.events.some((event) => event.type === "tower-hit"), false, `no hit on tick ${tick}`);
  }

  simulation.applyCommand({ type: "advance-wave" });
  assert.equal(
    simulation.getSnapshot().targetAssignments[0]?.targetCreatureId,
    "wave-1-creature-1",
    "targeted on the first tick after protection"
  );
});

// Strong towers can kill a creature before any snapshot shows it, so the client needs the cell from the event.
test("tower-hit and creature-defeated events carry the cell of the creature", () => {
  const simulation = createSinglePlayerWaveSimulation(777);
  tickUntil(simulation, () => simulation.getSnapshot().events.some((event) => event.type === "creature-defeated"), 500);
  const events = simulation.getSnapshot().events;
  const hit = events.find((event) => event.type === "tower-hit");
  const defeated = events.find((event) => event.type === "creature-defeated");
  assert.ok(hit && hit.type === "tower-hit");
  assert.ok(defeated && defeated.type === "creature-defeated");
  assert.equal(typeof hit.x, "number");
  assert.equal(typeof hit.y, "number");
  assert.equal(typeof defeated.x, "number");
  assert.equal(typeof defeated.y, "number");
});

test("shots can miss at base accuracy, deterministically, and never at max accuracy", () => {
  const run = (accuracyLevel: number): { hits: number; misses: number; firstMiss: string } => {
    const simulation = createPrepMatchWithTower(21);
    const tower = (simulation as unknown as { state: { towers: Tower[] } }).state.towers[0];
    assert.ok(tower);
    tower.upgrades.accuracy = accuracyLevel;
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
    tickUntil(simulation, () => simulation.getSnapshot().phase !== "wave", 400);
    const events = simulation.getSnapshot().events;
    const misses = events.filter((event) => event.type === "tower-miss");
    return {
      hits: events.filter((event) => event.type === "tower-hit").length,
      misses: misses.length,
      firstMiss: JSON.stringify(misses[0] ?? null)
    };
  };

  const base = run(1);
  assert.ok(base.hits > 0);
  assert.ok(base.misses > 0, "a 70% tower should miss at least once in a whole wave");
  assert.deepEqual(run(1), base);

  const max = run(MAX_TOWER_LEVEL);
  assert.equal(max.misses, 0);
  assert.ok(max.hits > 0);
});

test("a miss deals no damage and carries the creature cell", () => {
  const simulation = createPrepMatchWithTower(21);
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  tickUntil(simulation, () => simulation.getSnapshot().events.some((event) => event.type === "tower-miss"), 400);
  const events = simulation.getSnapshot().events;
  const miss = events.find((event) => event.type === "tower-miss");
  assert.ok(miss && miss.type === "tower-miss");
  assert.equal(typeof miss.x, "number");
  assert.equal(events.some((event) => event.type === "tower-hit" && event.tick === miss.tick && event.towerId === miss.towerId), false);
});

// Damage types (#16)

function archetypeOfCreature(events: MatchEvent[], creatureId: string): CreatureArchetype {
  const spawned = events.find((event) => event.type === "creature-spawned" && event.creatureId === creatureId);
  assert.ok(spawned && spawned.type === "creature-spawned");
  return spawned.archetype;
}

function runWaveWithDamageType(damageType: DamageType, damageLevel = 1): ReturnType<typeof createMatch> {
  const simulation = createPrepMatchWithTower(21);
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType }),
    { accepted: true }
  );
  const tower = (simulation as unknown as { state: { towers: Tower[] } }).state.towers[0];
  assert.ok(tower);
  tower.upgrades.damage = damageLevel;
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  tickUntil(simulation, () => simulation.getSnapshot().phase !== "wave", 800);
  return simulation;
}

test("a new tower is physical and the snapshot carries its damage type", () => {
  const simulation = createPrepMatchWithTower(15);
  assert.equal(simulation.getSnapshot().towers[0]?.damageType, "physical");
});

test("each damage type against each archetype: tower-hit damage matches the multiplier table, minimum 1", () => {
  const seen = new Set<string>();
  for (const damageType of DAMAGE_TYPES) {
    for (const damageLevel of [1, 3]) {
      const events = runWaveWithDamageType(damageType, damageLevel).getSnapshot().events;
      const hits = events.filter((event): event is Extract<MatchEvent, { type: "tower-hit" }> => event.type === "tower-hit");
      assert.ok(hits.length > 0);
      for (const hit of hits) {
        const archetype = archetypeOfCreature(events, hit.creatureId);
        seen.add(`${damageType}:${archetype}`);
        assert.equal(hit.damage, getDamageAgainst(damageLevel, damageType, archetype), `${damageType} L${damageLevel} vs ${archetype}`);
        assert.equal(hit.damageType, damageType);
        assert.ok(hit.damage >= 1);
      }
    }
  }
  assert.ok(seen.size >= 9, `expected hits for several type/archetype pairs, saw ${[...seen].join(",")}`);
});

test("telemetry towerDamageDealt equals the damage of the tower-hit events for every type", () => {
  for (const damageType of DAMAGE_TYPES) {
    const snapshot = runWaveWithDamageType(damageType, 2).getSnapshot();
    const fromEvents = snapshot.events.reduce((total, event) => total + (event.type === "tower-hit" ? event.damage : 0), 0);
    assert.ok(fromEvents > 0);
    assert.equal(snapshot.telemetry.completedWaves[0]?.towerDamageDealt, fromEvents);
  }
});

test("the same seed and damage type replay identically", () => {
  const first = JSON.stringify(runWaveWithDamageType("magic", 2).getSnapshot().events);
  const second = JSON.stringify(runWaveWithDamageType("magic", 2).getSnapshot().events);
  assert.equal(first, second);
});

test("a snapshot is a copy: later upgrades do not change an earlier snapshot's tower", () => {
  const simulation = createPrepMatchWithTower(15);
  simulation.awardPoints("p1", 200);
  const before = simulation.getSnapshot();
  simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "damage" });
  assert.deepEqual(before.towers[0]?.upgrades, { range: 1, damage: 1, accuracy: 1 });
  assert.equal(before.towers[0]?.level, 1);
  assert.deepEqual(simulation.getSnapshot().towers[0]?.upgrades, { range: 1, damage: 2, accuracy: 1 });
});
