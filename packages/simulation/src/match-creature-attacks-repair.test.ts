import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  DEFAULT_TOWER_HEALTH,
  SPAWN_PROTECTION_TICKS,
  type MatchEvent,
  getBetweenWaveTowerRepairAmount,
  getCreatureAttackDamage,
  getCreatureAttackRange,
  type Creature,
  type CreatureArchetype,
  isWithinCreatureAttackRange,
  type Tower,
} from "@tower-defense/shared";
import { generateMap } from "./procedural-map.js";
import { getBuildableCellsNearSpawn } from "./spawn-order.js";
import { getBuildableCoordinate, createSinglePlayerWaveSimulation, tickUntil } from "./test-helpers.js";

// Creatures spawn out of range, so the first target selection event usually has no target at all.
function hasCreatureTargetInRange(simulation: ReturnType<typeof createMatch>): boolean {
  return simulation
    .getSnapshot()
    .events.some(
      (event) =>
        event.type === "creature-targets-selected"
        && event.assignments.some((assignment) => assignment.targetTowerId !== null)
    );
}

test("creature target selection is deterministic by distance then hp then towerId", () => {
  // Creatures only select towers within their short attack range. Two towers beside the lane kill every creature
  // before it gets close, so only the first tower stands beside the lane; the second is far out of anyone's reach.
  const firstTower = getTowerCellBesideLane(34);
  const secondTower = [...getBuildableCellsNearSpawn(34)].reverse()[0];
  assert.ok(secondTower);
  const simulation = createMatch({
    players: [
      { id: "p2", name: "Beta" },
      { id: "p1", name: "Alpha" }
    ],
    seed: 34
  });

  simulation.applyCommand({ type: "place-tower", playerId: "p2", x: firstTower.x, y: firstTower.y });
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: secondTower.x, y: secondTower.y });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

  // Early waves die before reaching the towers, so the first in-range target appears a few waves in.
  tickUntil(simulation, () => hasCreatureTargetInRange(simulation), 1200);

  const snapshot = simulation.getSnapshot();
  const creatureTargetEvent = [...snapshot.events]
    .reverse()
    .find((event): event is Extract<MatchEvent, { type: "creature-targets-selected" }> => event.type === "creature-targets-selected");

  assert.ok(creatureTargetEvent);
  assert.ok(creatureTargetEvent.assignments.length > 0);

  const firstAssignment = creatureTargetEvent.assignments.find((assignment) => assignment.targetTowerId !== null);
  assert.ok(firstAssignment);
  assert.ok(firstAssignment.targetTowerId === "tower-p1" || firstAssignment.targetTowerId === "tower-p2");

  const rerun = createMatch({
    players: [
      { id: "p2", name: "Beta" },
      { id: "p1", name: "Alpha" }
    ],
    seed: 34
  });
  rerun.applyCommand({ type: "place-tower", playerId: "p2", x: firstTower.x, y: firstTower.y });
  rerun.applyCommand({ type: "place-tower", playerId: "p1", x: secondTower.x, y: secondTower.y });
  rerun.applyCommand({ type: "ready-for-wave", playerId: "p2" });
  rerun.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  tickUntil(rerun, () => hasCreatureTargetInRange(rerun), 1200);
  const rerunSnapshot = rerun.getSnapshot();
  const rerunCreatureTargetEvent = [...rerunSnapshot.events]
    .reverse()
    .find((event): event is Extract<MatchEvent, { type: "creature-targets-selected" }> => event.type === "creature-targets-selected");
  assert.ok(rerunCreatureTargetEvent);
  assert.deepEqual(creatureTargetEvent.assignments, rerunCreatureTargetEvent.assignments);
});

// Calls the private selector directly: with live waves the sticky spawn target and the towers killing creatures
// early make the distance/hp/id tie-breaks unreachable, so they are pinned on hand-built state instead.
test("creature tower selection among in-range towers breaks ties by distance, then hp, then towerId", () => {
  const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed: 34 });
  const select = (
    simulation as unknown as {
      selectTowerTargetForCreature: (creature: Creature, towers: Map<string, Tower>) => Tower | undefined;
    }
  ).selectTowerTargetForCreature.bind(simulation);

  const tower = (id: string, x: number, y: number, health = 100): Tower => ({
    id,
    playerId: id,
    x,
    y,
    health,
    maxHealth: 100,
    level: 1,
    upgrades: { range: 1, damage: 1, accuracy: 1 },
    targetMode: "first", damageType: "physical"
  });
  const towers = (...entries: Tower[]): Map<string, Tower> => new Map(entries.map((entry) => [entry.id, entry]));
  // "tower-missing" means no sticky target, like after the assigned tower died.
  const tank: Creature = {
    id: "c1",
    archetype: "tank",
    hp: 5,
    x: 10,
    y: 10,
    pathIndex: 0,
    pathProgressUnits: 0,
    spawnTick: 0,
    targetTowerId: "tower-missing"
  };

  // Distance wins over lower hp and lower id.
  assert.equal(select(tank, towers(tower("a", 11, 11, 1), tower("b", 11, 10, 100)))?.id, "b");
  // Equal distance: lower hp wins over lower id.
  assert.equal(select(tank, towers(tower("a", 11, 10, 100), tower("b", 10, 11, 40)))?.id, "b");
  // Equal distance and hp: lowest towerId wins, independent of map insertion order.
  assert.equal(select(tank, towers(tower("b", 11, 10), tower("a", 10, 11)))?.id, "a");
  assert.equal(select(tank, towers(tower("a", 11, 10), tower("b", 10, 11)))?.id, "a");
  // Out-of-range towers never win, even when they would win every tie-break.
  assert.equal(select(tank, towers(tower("a", 14, 10, 1), tower("b", 11, 11)))?.id, "b");
  assert.equal(select(tank, towers(tower("a", 14, 10, 1))), undefined);
  // A runner (range 1) reaches an adjacent cell (exactly at range) but not the diagonal (1.41).
  assert.equal(select({ ...tank, archetype: "runner" }, towers(tower("a", 11, 10)))?.id, "a");
  assert.equal(select({ ...tank, archetype: "runner" }, towers(tower("a", 11, 11))), undefined);
  // A sticky target is kept only while in range, and then wins over a closer tower.
  assert.equal(select({ ...tank, targetTowerId: "b" }, towers(tower("a", 10, 10), tower("b", 11, 11)))?.id, "b");
  assert.equal(select({ ...tank, targetTowerId: "b" }, towers(tower("a", 11, 10), tower("b", 14, 14)))?.id, "a");
});

test("emits creature-attack event and reduces tower hp", () => {
  const simulation = createSinglePlayerWaveSimulationBesideLane(35);

  // Creatures start at the cave, far from the tower, so the first attack happens a few ticks into the wave.
  // Remember each creature's archetype per tick: the attacker may already be gone from the final snapshot.
  const archetypeById = new Map<string, CreatureArchetype>();
  tickUntil(
    simulation,
    () => {
      const current = simulation.getSnapshot();
      if (current.events.some((event) => event.type === "creature-attack")) {
        return true;
      }
      for (const creature of current.creatures) {
        archetypeById.set(creature.id, creature.archetype);
      }
      return false;
    },
    1200
  );

  const snapshot = simulation.getSnapshot();
  const attackEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "creature-attack" }> => event.type === "creature-attack"
  );
  assert.ok(attackEvents.length >= 1);
  const firstAttack = attackEvents[0];
  assert.ok(firstAttack);
  assert.equal(firstAttack.targetTowerId, "tower-p1");

  // Damage is exact per attacker archetype, not just bounded.
  const attackerArchetype = archetypeById.get(firstAttack.creatureId);
  assert.ok(attackerArchetype, `archetype of ${firstAttack.creatureId} was seen before it attacked`);
  assert.equal(firstAttack.damage, getCreatureAttackDamage(attackerArchetype));

  const tower = snapshot.towers.find((entry) => entry.id === "tower-p1");
  assert.ok(tower);
  assert.equal(tower.health, DEFAULT_TOWER_HEALTH - attackEvents.reduce((total, event) => total + event.damage, 0));
  assert.equal(attackEvents[attackEvents.length - 1]?.remainingHp, tower.health);
  assert.equal(firstAttack.remainingHp, DEFAULT_TOWER_HEALTH - firstAttack.damage);
});

test("destroys tower, marks player eliminated, and rejects further player commands", () => {
  const simulation = createExposedFragileTowerSimulation();

  tickUntil(simulation, () => simulation.getSnapshot().phase === "ended", 1200);

  const snapshot = simulation.getSnapshot();
  const destroyedEvents = snapshot.events.filter((event) => event.type === "tower-destroyed");
  assert.ok(destroyedEvents.length > 0);
  assert.equal(snapshot.players[0]?.eliminated, true);

  const placeAfterElimination = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: 0,
    y: 0
  });
  assert.equal(placeAfterElimination.accepted, false);
  assert.equal(placeAfterElimination.reason, "match-already-ended");
});

test("ends match with fail-state when all towers are destroyed", () => {
  const simulation = createExposedFragileTowerSimulation();
  tickUntil(simulation, () => simulation.getSnapshot().phase === "ended", 1200);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.phase, "ended");
  assert.equal(snapshot.endReason, "all-towers-destroyed");
  assert.equal(snapshot.winnerId, undefined);
  assert.equal(snapshot.towers.length, 0);
  assert.equal(snapshot.players.every((player) => player.eliminated), true);
});

test("emits deterministic tower-repaired events between waves", () => {
  const simulation = createSinglePlayerWaveSimulationBesideLane(EXPOSED_TOWER_SEED);

  tickUntil(simulation, () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2, 300);

  const snapshot = simulation.getSnapshot();
  const towerDamageInWave = snapshot.events
    .filter((event): event is Extract<MatchEvent, { type: "creature-attack" }> => event.type === "creature-attack" && event.wave === 1)
    .reduce((total, event) => total + event.damage, 0);
  const repairedEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "tower-repaired" }> => event.type === "tower-repaired"
  );
  const waveEndEventIndex = snapshot.events.findIndex((event) => event.type === "wave-end" && event.wave === 1);
  assert.ok(waveEndEventIndex >= 0);
  assert.equal(repairedEvents.length, 1);

  const repairEventIndex = snapshot.events.findIndex((event) => event.type === "tower-repaired");
  assert.ok(repairEventIndex >= 0);
  assert.ok(repairEventIndex < waveEndEventIndex);

  const repairEvent = repairedEvents[0];
  assert.ok(repairEvent);
  assert.equal(repairEvent.wave, 1);
  assert.equal(repairEvent.towerId, "tower-p1");
  assert.equal(repairEvent.playerId, "p1");
  assert.equal(
    repairEvent.repairAmount,
    Math.min(getBetweenWaveTowerRepairAmount(DEFAULT_TOWER_HEALTH), towerDamageInWave)
  );
});

test("repairs tower hp by deterministic formula with max-health cap", () => {
  const simulation = createSinglePlayerWaveSimulationBesideLane(EXPOSED_TOWER_SEED);

  tickUntil(simulation, () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2, 300);

  const snapshot = simulation.getSnapshot();
  const towerDamageInWave = snapshot.events
    .filter((event): event is Extract<MatchEvent, { type: "creature-attack" }> => event.type === "creature-attack" && event.wave === 1)
    .reduce((total, event) => total + event.damage, 0);
  const repairedTower = snapshot.towers.find((tower) => tower.id === "tower-p1");
  assert.ok(repairedTower);

  const expectedRepair = getBetweenWaveTowerRepairAmount(DEFAULT_TOWER_HEALTH);
  const appliedRepair = Math.min(expectedRepair, towerDamageInWave);
  assert.equal(repairedTower.health, DEFAULT_TOWER_HEALTH - towerDamageInWave + appliedRepair);
  assert.ok(repairedTower.health <= repairedTower.maxHealth);

  const repairEvent = snapshot.events.find(
    (event): event is Extract<MatchEvent, { type: "tower-repaired" }> => event.type === "tower-repaired"
  );
  assert.ok(repairEvent);
  assert.equal(repairEvent.repairAmount, appliedRepair);
  assert.equal(repairEvent.remainingHp, repairedTower.health);
});

test("does not emit repair events for towers after they are destroyed", () => {
  const simulation = createExposedFragileTowerSimulation();

  tickUntil(simulation, () => simulation.getSnapshot().phase === "ended", 2000);

  const snapshot = simulation.getSnapshot();
  const destroyedEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "tower-destroyed" }> => event.type === "tower-destroyed"
  );
  assert.ok(destroyedEvents.length > 0);

  for (const destroyedEvent of destroyedEvents) {
    const destroyedIndex = snapshot.events.findIndex(
      (event) =>
        event.type === "tower-destroyed" &&
        event.towerId === destroyedEvent.towerId &&
        event.tick === destroyedEvent.tick &&
        event.wave === destroyedEvent.wave
    );
    assert.ok(destroyedIndex >= 0);

    const repairsAfterDestroyed = snapshot.events.slice(destroyedIndex + 1).filter(
      (event): event is Extract<MatchEvent, { type: "tower-repaired" }> =>
        event.type === "tower-repaired" && event.towerId === destroyedEvent.towerId
    );
    assert.equal(repairsAfterDestroyed.length, 0);
  }
});

test("wave transition keeps readiness flow coherent after repair phase", () => {
  const simulation = createSinglePlayerWaveSimulation(41);

  tickUntil(simulation, () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2, 300);

  const afterWaveOne = simulation.getSnapshot();
  assert.equal(afterWaveOne.phase, "placement");
  assert.equal(afterWaveOne.players[0]?.readyForWave, false);
  assert.equal(afterWaveOne.allPlayersReadyForWave, false);

  const advanceWhilePlacement = simulation.applyCommand({ type: "advance-wave" });
  assert.equal(advanceWhilePlacement.accepted, false);
  assert.equal(advanceWhilePlacement.reason, "wave-phase-not-active");

  const readyForNextWave = simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  assert.equal(readyForNextWave.accepted, true);

  const afterReady = simulation.getSnapshot();
  assert.equal(afterReady.phase, "wave");
  assert.equal(afterReady.wave, 2);
  assert.equal(afterReady.waveTick, 0);
});

test("emits deterministic path-repaired event with stable ordering and values", () => {
  const towerCoordinate = getBuildableCoordinate(43);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 43
  });

  assert.equal(
    simulation.applyCommand({
      type: "place-tower",
      playerId: "p1",
      x: towerCoordinate.x,
      y: towerCoordinate.y
    }).accepted,
    true
  );
  assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" }).accepted, true);


  tickUntil(simulation, () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2, 400);

  const snapshot = simulation.getSnapshot();
  const pathRepairEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "path-repaired" }> => event.type === "path-repaired"
  );
  assert.equal(pathRepairEvents.length, 1);

  const pathRepair = pathRepairEvents[0];
  assert.ok(pathRepair);
  assert.equal(pathRepair.wave, 1);
  assert.ok(pathRepair.repairs.length > 0);

  for (const repair of pathRepair.repairs) {
    assert.ok(repair.wearBefore > repair.wearAfter);
  }

  const sortedRepairs = [...pathRepair.repairs].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  assert.deepEqual(pathRepair.repairs, sortedRepairs);

  const firstRepair = pathRepair.repairs[0];
  assert.ok(firstRepair);
  const repairedCell = snapshot.map.cells.find((cell) => cell.x === firstRepair.x && cell.y === firstRepair.y);
  assert.ok(repairedCell);
  assert.equal(repairedCell.pathWear, firstRepair.wearAfter);
});

// --- Creature attack range ---
// Seed 43 has a corridor corner whose diagonal pad sits within reach of the first armored creature while it is still alive.
// Seed 3 has a lane that leaves the protected cave area while the first creatures are still alive and shootable.
const RANGE_TEST_SEED = 43;

const RANGE_TICK = SPAWN_PROTECTION_TICKS + 1;

// Position of a creature on a given wave tick. The lane does not depend on where the tower stands, so a probe
// with the farthest placeable tower tells us where the creature will be in the real match.
function probeCreaturePosition(seed: number, creatureId: string, tick: number): { x: number; y: number } {
  const probe = createMatch({ players: [{ id: "p1", name: "Probe" }], seed });
  for (const cell of [...getBuildableCellsNearSpawn(seed)].reverse()) {
    if (probe.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted) {
      break;
    }
  }
  probe.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  for (let step = 0; step < tick; step += 1) {
    probe.applyCommand({ type: "advance-wave" });
  }
  const creature = probe.getSnapshot().creatures.find((entry) => entry.id === creatureId);
  assert.ok(creature, `expected ${creatureId} to be alive on tick ${tick}`);
  return { x: creature.x, y: creature.y };
}

// The lane ends at the tower, so where a creature walks depends on where the tower stands. The probe only gives
// a rough lane position to narrow down candidate cells; every candidate is then verified in a real match.
function findRangeScenario(
  seed: number,
  creatureId: string,
  minExclusive: number,
  maxInclusive: number
): { tick: number; cell: { x: number; y: number } } {
  const map = generateMap(seed);
  // Early ticks put the creature inside the protected cave area where no tower can stand.
  for (let tick = RANGE_TICK; tick <= 40; tick += 1) {
    let roughPosition: { x: number; y: number };
    try {
      roughPosition = probeCreaturePosition(seed, creatureId, tick);
    } catch {
      continue;
    }
    const candidates = map.cells.filter(
      (cell) => cell.buildable && Math.hypot(cell.x - roughPosition.x, cell.y - roughPosition.y) <= maxInclusive + 4
    );
    for (const cell of candidates) {
      const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
      if (!simulation.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted) {
        continue;
      }
      simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
      // The wave may end or the creature die before this tick; then this candidate is unusable.
      const reached = Array.from({ length: tick }).every(
        () => simulation.applyCommand({ type: "advance-wave" }).accepted
      );
      const creature = reached ? simulation.getSnapshot().creatures.find((entry) => entry.id === creatureId) : undefined;
      if (!creature) {
        continue;
      }
      const distance = Math.hypot(cell.x - creature.x, cell.y - creature.y);
      if (distance > minExclusive && distance <= maxInclusive) {
        return { tick, cell: { x: cell.x, y: cell.y } };
      }
    }
  }
  assert.fail(`no tick where ${creatureId} can be met at distance (${minExclusive}, ${maxInclusive}]`);
}

function createMatchWithTowerAt(seed: number, cell: { x: number; y: number }): ReturnType<typeof createMatch> {
  const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
  assert.equal(simulation.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted, true);
  assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" }).accepted, true);
  return simulation;
}

function runToTick(simulation: ReturnType<typeof createMatch>, tick: number): void {
  for (let step = 0; step < tick; step += 1) {
    assert.equal(simulation.applyCommand({ type: "advance-wave" }).accepted, true);
  }
}

function eventsOnTick<T extends MatchEvent["type"]>(
  simulation: ReturnType<typeof createMatch>,
  type: T,
  tick: number,
  creatureId: string
): Array<Extract<MatchEvent, { type: T }>> {
  return simulation
    .getSnapshot()
    .events.filter(
      (event): event is Extract<MatchEvent, { type: T }> =>
        event.type === type
        && event.wave === 1
        && event.tick === tick
        && (event as { creatureId?: string }).creatureId === creatureId
    );
}

test("creature attack ranges are defined per archetype", () => {
  assert.equal(getCreatureAttackRange("runner"), 1);
  assert.equal(getCreatureAttackRange("swarm"), 1);
  assert.equal(getCreatureAttackRange("armored"), 1.5);
  assert.equal(getCreatureAttackRange("tank"), 1.5);
});

test("a creature out of range deals no damage even though its stale target is the tower", () => {
  const { tick, cell } = findRangeScenario(RANGE_TEST_SEED, "wave-1-creature-1", 1.5, 4);
  const simulation = createMatchWithTowerAt(RANGE_TEST_SEED, cell);
  runToTick(simulation, tick);

  assert.equal(eventsOnTick(simulation, "creature-attack", tick, "wave-1-creature-1").length, 0);
  const assignment = simulation
    .getSnapshot()
    .events.flatMap((event) =>
      event.type === "creature-targets-selected" && event.tick === tick ? event.assignments : []
    )
    .find((entry) => entry.creatureId === "wave-1-creature-1");
  assert.equal(assignment?.targetTowerId, null);
});

// A live creature at exactly 1 cell from a tower is not reachable: a tower kills a runner long before it walks up
// to it, so the inclusive boundary is checked on the shared range check directly.
test("creature attack range is Euclidean and inclusive", () => {
  const origin = { x: 10, y: 10 };
  assert.equal(isWithinCreatureAttackRange("runner", origin, { x: 11, y: 10 }), true);
  assert.equal(isWithinCreatureAttackRange("runner", origin, { x: 10, y: 10 }), true);
  assert.equal(isWithinCreatureAttackRange("runner", origin, { x: 11, y: 11 }), false);
  assert.equal(isWithinCreatureAttackRange("runner", origin, { x: 12, y: 10 }), false);
  assert.equal(isWithinCreatureAttackRange("tank", origin, { x: 11, y: 11 }), true);
  assert.equal(isWithinCreatureAttackRange("tank", origin, { x: 12, y: 10 }), false);
  assert.equal(isWithinCreatureAttackRange("armored", origin, { x: 12, y: 11 }), false);
});

test("a runner cannot hit a tower at diagonal distance 1.41 but an armored creature can", () => {
  // Creature 3 is the first armored creature (range 1.5); creature 1 is a runner (range 1).
  const armored = findRangeScenario(RANGE_TEST_SEED, "wave-1-creature-3", 1, 1.5);
  const armoredSim = createMatchWithTowerAt(RANGE_TEST_SEED, armored.cell);
  runToTick(armoredSim, armored.tick);
  assert.equal(eventsOnTick(armoredSim, "creature-attack", armored.tick, "wave-1-creature-3").length, 1);

  // A tower this close to the lane shoots a runner dead long before it reaches the diagonal, so the runner is kept
  // out of the tower's sights (spawn protection that never ends). Protected creatures still move and attack.
  const runner = findDiagonalCellForRunner(RANGE_TEST_SEED);
  const runnerSim = createMatchWithTowerAt(RANGE_TEST_SEED, runner.cell);
  runToTick(runnerSim, 1);
  const internals = runnerSim as unknown as { state: { creatures: Creature[] } };
  for (const creature of internals.state.creatures) {
    creature.spawnTick = Number.MAX_SAFE_INTEGER;
  }
  runToTick(runnerSim, runner.tick - 1);
  const runnerNow = runnerSim.getSnapshot().creatures.find((entry) => entry.id === "wave-1-creature-1");
  assert.ok(runnerNow, "runner is alive on the tick it passes the tower");
  const runnerDistance = Math.hypot(runner.cell.x - runnerNow.x, runner.cell.y - runnerNow.y);
  assert.ok(runnerDistance > 1 && runnerDistance <= 1.5, `runner is diagonal to the tower (${runnerDistance})`);
  assert.equal(eventsOnTick(runnerSim, "creature-attack", runner.tick, "wave-1-creature-1").length, 0);
});

// The lane does not depend on a tower that stays off it, so a probe run tells where the runner walks.
function findDiagonalCellForRunner(seed: number): { tick: number; cell: { x: number; y: number } } {
  const map = generateMap(seed);
  for (let tick = RANGE_TICK; tick <= 120; tick += 1) {
    let position: { x: number; y: number };
    try {
      position = probeCreaturePosition(seed, "wave-1-creature-1", tick);
    } catch {
      break;
    }
    for (const cell of map.cells) {
      const distance = Math.hypot(cell.x - position.x, cell.y - position.y);
      if (
        cell.buildable
        && distance > 1
        && distance <= 1.5
        && createMatch({ players: [{ id: "p1", name: "Alpha" }], seed })
          .applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted
      ) {
        return { tick, cell: { x: cell.x, y: cell.y } };
      }
    }
  }
  assert.fail("no cell diagonal to the runner's lane");
}

test("ranged creature attacks are deterministic for the same seed", () => {
  const { cell } = findRangeScenario(RANGE_TEST_SEED, "wave-1-creature-3", 0, 1.5);
  const first = createMatchWithTowerAt(RANGE_TEST_SEED, cell);
  const second = createMatchWithTowerAt(RANGE_TEST_SEED, cell);
  // The wave may end before tick 30, so step until the simulation stops accepting wave ticks.
  for (const simulation of [first, second]) {
    for (let step = 0; step < 30 && simulation.applyCommand({ type: "advance-wave" }).accepted; step += 1) {
      // advance only
    }
  }
  assert.ok(first.getSnapshot().events.some((event) => event.type === "creature-attack"));
  assert.deepEqual(first.getSnapshot().events, second.getSnapshot().events);
});

// Creatures only attack what is within about one cell, so tests that expect creature attacks need towers right beside
// the lane. The lane runs from the cave to the east edge and only detours around a tower
// that stands on it, so a cell next to the probe lane that is not on it keeps the lane unchanged.
// The maze keeps its tower pads out of the corridors' 4-neighbourhood, so the only pads beside the lane sit on a
// corridor corner's diagonal (1.41 cells away). Those are within reach of tanks and armored creatures (1.5).
const BESIDE_LANE_OFFSETS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

function getLaneCells(seed: number): Array<{ x: number; y: number }> {
  const probe = createMatch({ players: [{ id: "p1", name: "Probe" }], seed });
  for (const cell of [...getBuildableCellsNearSpawn(seed)].reverse()) {
    if (probe.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted) {
      break;
    }
  }
  probe.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  const lane: Array<{ x: number; y: number }> = [];
  for (let tick = 1; tick <= 120 && probe.applyCommand({ type: "advance-wave" }).accepted; tick += 1) {
    const creature = probe.getSnapshot().creatures.find((entry) => entry.id === "wave-1-creature-1");
    if (creature && !lane.some((cell) => cell.x === creature.x && cell.y === creature.y)) {
      lane.push({ x: creature.x, y: creature.y });
    }
  }
  return lane;
}

function getTowerCellsBesideLane(seed: number, count: number): Array<{ x: number; y: number }> {
  const lane = getLaneCells(seed);
  const onLane = (cell: { x: number; y: number }): boolean => lane.some((entry) => entry.x === cell.x && entry.y === cell.y);
  const probe = createMatch({
    players: Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` })),
    seed
  });
  const picked: Array<{ x: number; y: number }> = [];
  // Skip the first lane cells: they are inside the protected cave area where towers cannot be placed anyway.
  for (const laneCell of lane) {
    for (const [dx, dy] of BESIDE_LANE_OFFSETS) {
      const cell = { x: laneCell.x + dx, y: laneCell.y + dy };
      if (picked.length === count || onLane(cell) || picked.some((entry) => entry.x === cell.x && entry.y === cell.y)) {
        continue;
      }
      if (probe.applyCommand({ type: "place-tower", playerId: `p${picked.length + 1}`, x: cell.x, y: cell.y }).accepted) {
        picked.push(cell);
      }
    }
  }
  assert.equal(picked.length, count, `expected ${count} tower cells beside the lane`);
  return picked;
}

function getTowerCellBesideLane(seed: number): { x: number; y: number } {
  const [cell] = getTowerCellsBesideLane(seed, 1);
  assert.ok(cell);
  return cell;
}

// In the maze a lone tower out-shoots every wave, so it never dies naturally before the 1000-point win. Tests of the
// destruction path therefore start the tower with 1 hp: the first creature attack still destroys it through the
// normal simulation flow. This seed is one where creatures do reach a tower beside the lane during wave 1.
const EXPOSED_TOWER_SEED = 43;

function createExposedFragileTowerSimulation(): ReturnType<typeof createMatch> {
  const simulation = createSinglePlayerWaveSimulationBesideLane(EXPOSED_TOWER_SEED);
  const internals = simulation as unknown as { state: { towers: Tower[] } };
  for (const tower of internals.state.towers) {
    tower.health = 1;
  }
  return simulation;
}

function createSinglePlayerWaveSimulationBesideLane(seed: number): ReturnType<typeof createMatch> {
  return createMatchWithTowerAt(seed, getTowerCellBesideLane(seed));
}
