import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  DEFAULT_TOWER_HEALTH,
  SPAWN_PROTECTION_TICKS,
  type MatchEvent,
  getBetweenWaveTowerRepairAmount,
  getCreatureAttackDamageAt,
  getCreatureAttackRange,
  type Creature,
  type CreatureArchetype,
  isWithinCreatureAttackRange,
  type Tower,
} from "@tower-defense/shared";
import { generateMap } from "./procedural-map.js";
import { getTowerSpotsNearSpawn } from "./spawn-order.js";
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
  const secondTower = [...getTowerSpotsNearSpawn(34)].reverse()[0];
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
    targetTowerId: "tower-missing",
    lane: 0
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
  // A runner (reach 2.5) reaches a tower sqrt(5) = 2.24 away but not one 3 cells away; a tank (3.5) reaches both.
  assert.equal(select({ ...tank, archetype: "runner" }, towers(tower("a", 12, 11)))?.id, "a");
  assert.equal(select({ ...tank, archetype: "runner" }, towers(tower("a", 13, 10))), undefined);
  assert.equal(select(tank, towers(tower("a", 13, 10)))?.id, "a");
  // A sticky target is kept only while in range, and then wins over a closer tower.
  assert.equal(select({ ...tank, targetTowerId: "b" }, towers(tower("a", 10, 10), tower("b", 11, 11)))?.id, "b");
  assert.equal(select({ ...tank, targetTowerId: "b" }, towers(tower("a", 11, 10), tower("b", 14, 14)))?.id, "a");
});

test("emits creature-attack event and reduces tower hp", () => {
  const simulation = createSinglePlayerWaveSimulationBesideLane(35);

  // Creatures start at the cave, far from the tower, so the first attack happens a few ticks into the wave.
  // Remember each creature's archetype and cell per tick: the attacker may already be gone from the final snapshot,
  // and attacks resolve after movement, so the cell from the snapshot after the attack tick is the one it hit from.
  const archetypeById = new Map<string, CreatureArchetype>();
  const cellById = new Map<string, { x: number; y: number }>();
  tickUntil(
    simulation,
    () => {
      const current = simulation.getSnapshot();
      for (const creature of current.creatures) {
        archetypeById.set(creature.id, creature.archetype);
        cellById.set(creature.id, { x: creature.x, y: creature.y });
      }
      return current.events.some((event) => event.type === "creature-attack");
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

  // Damage is exact per attacker archetype and distance band, not just bounded.
  const attackerArchetype = archetypeById.get(firstAttack.creatureId);
  assert.ok(attackerArchetype, `archetype of ${firstAttack.creatureId} was seen before it attacked`);
  const attackerCell = cellById.get(firstAttack.creatureId);
  assert.ok(attackerCell, `cell of ${firstAttack.creatureId} was seen on the attack tick`);
  const tower = snapshot.towers.find((entry) => entry.id === "tower-p1");
  assert.ok(tower);
  assert.ok(firstAttack.damage > 0);
  assert.equal(firstAttack.damage, getCreatureAttackDamageAt(attackerArchetype, attackerCell, tower));

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
// These tests need a map where a tower spot sits within reach of the first armored creature while it is still alive
// and another diagonal to the runner's walk; with only 16 spots per map that depends on the seed, so the first seed
// that offers every scenario is used (found once, on first use).
let rangeTestSeed: number | undefined;

function getRangeTestSeed(): number {
  if (rangeTestSeed === undefined) {
    for (let seed = 43; seed < 300 && rangeTestSeed === undefined; seed += 1) {
      if (
        tryFindRangeScenario(seed, "wave-1-creature-1", 2.5, 6)
        && tryFindRangeScenario(seed, "wave-1-creature-3", 2.5, 3.5)
        && tryFindRangeScenario(seed, "wave-1-creature-1", 1.5, 2.5)
        && tryFindCellJustOutOfRunnerReach(seed)
      ) {
        rangeTestSeed = seed;
      }
    }
  }
  assert.ok(rangeTestSeed !== undefined, "expected a seed with every range scenario");
  return rangeTestSeed;
}

const RANGE_TICK = SPAWN_PROTECTION_TICKS + 1;

// Position of a creature on a given wave tick. The lane does not depend on where the tower stands, so a probe
// with the farthest placeable tower tells us where the creature will be in the real match.
function probeCreaturePosition(seed: number, creatureId: string, tick: number): { x: number; y: number } {
  const probe = createMatch({ players: [{ id: "p1", name: "Probe" }], seed });
  for (const cell of [...getTowerSpotsNearSpawn(seed)].reverse()) {
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
  const found = tryFindRangeScenario(seed, creatureId, minExclusive, maxInclusive);
  assert.ok(found, `no tick where ${creatureId} can be met at distance (${minExclusive}, ${maxInclusive}]`);
  return found;
}

function tryFindRangeScenario(
  seed: number,
  creatureId: string,
  minExclusive: number,
  maxInclusive: number
): { tick: number; cell: { x: number; y: number } } | null {
  const map = generateMap(seed);
  // Early ticks put the creature inside the protected cave area where no tower can stand.
  for (let tick = RANGE_TICK; tick <= 40; tick += 1) {
    let roughPosition: { x: number; y: number };
    try {
      roughPosition = probeCreaturePosition(seed, creatureId, tick);
    } catch {
      continue;
    }
    const candidates = map.towerSpots.filter(
      (cell) => Math.hypot(cell.x - roughPosition.x, cell.y - roughPosition.y) <= maxInclusive + 4
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
  return null;
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
  assert.equal(getCreatureAttackRange("runner"), 2.5);
  assert.equal(getCreatureAttackRange("swarm"), 2.5);
  assert.equal(getCreatureAttackRange("armored"), 3.5);
  assert.equal(getCreatureAttackRange("tank"), 3.5);
});

test("a creature out of range deals no damage even though its stale target is the tower", () => {
  const { tick, cell } = findRangeScenario(getRangeTestSeed(), "wave-1-creature-1", 2.5, 6);
  const simulation = createMatchWithTowerAt(getRangeTestSeed(), cell);
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

// Exact boundary distances are hard to hit with a live creature, so the inclusive boundary is checked on the shared
// range check directly.
test("creature attack range is Euclidean and inclusive", () => {
  const origin = { x: 10, y: 10 };
  assert.equal(isWithinCreatureAttackRange("runner", origin, { x: 11, y: 10 }), true);
  assert.equal(isWithinCreatureAttackRange("runner", origin, { x: 10, y: 10 }), true);
  assert.equal(isWithinCreatureAttackRange("runner", origin, { x: 12, y: 10 }), true);
  assert.equal(isWithinCreatureAttackRange("runner", origin, { x: 12, y: 12 }), false);
  assert.equal(isWithinCreatureAttackRange("runner", origin, { x: 13, y: 10 }), false);
  assert.equal(isWithinCreatureAttackRange("tank", origin, { x: 13, y: 11 }), true);
  assert.equal(isWithinCreatureAttackRange("tank", origin, { x: 14, y: 10 }), false);
  assert.equal(isWithinCreatureAttackRange("armored", origin, { x: 13, y: 12 }), false);
});

test("a runner cannot hit a tower 3 cells away but an armored creature can", () => {
  // Creature 3 is the first armored creature (reach 3.5, x1 there = 2 damage); creature 1 is a runner (reach 2.5).
  const armored = findRangeScenario(getRangeTestSeed(), "wave-1-creature-3", 2.5, 3.5);
  const armoredSim = createMatchWithTowerAt(getRangeTestSeed(), armored.cell);
  runToTick(armoredSim, armored.tick);
  const armoredAttacks = eventsOnTick(armoredSim, "creature-attack", armored.tick, "wave-1-creature-3");
  assert.equal(armoredAttacks.length, 1);
  assert.equal(armoredAttacks[0]?.damage, 2);

  // A tower this close to the lane shoots a runner dead long before it reaches the diagonal, so the runner is kept
  // out of the tower's sights (spawn protection that never ends). Protected creatures still move and attack.
  const runner = findCellJustOutOfRunnerReach(getRangeTestSeed());
  const runnerSim = createMatchWithTowerAt(getRangeTestSeed(), runner.cell);
  runToTick(runnerSim, 1);
  const internals = runnerSim as unknown as { state: { creatures: Creature[] } };
  for (const creature of internals.state.creatures) {
    creature.spawnTick = Number.MAX_SAFE_INTEGER;
  }
  runToTick(runnerSim, runner.tick - 1);
  const runnerNow = runnerSim.getSnapshot().creatures.find((entry) => entry.id === "wave-1-creature-1");
  assert.ok(runnerNow, "runner is alive on the tick it passes the tower");
  const runnerDistance = Math.hypot(runner.cell.x - runnerNow.x, runner.cell.y - runnerNow.y);
  assert.ok(runnerDistance > 2.5 && runnerDistance <= 3.5, `runner is just out of reach (${runnerDistance})`);
  assert.equal(eventsOnTick(runnerSim, "creature-attack", runner.tick, "wave-1-creature-1").length, 0);
});

// The lane does not depend on a tower that stays off it, so a probe run tells where the runner walks.
function findCellJustOutOfRunnerReach(seed: number): { tick: number; cell: { x: number; y: number } } {
  const found = tryFindCellJustOutOfRunnerReach(seed);
  assert.ok(found, "no tower spot 2.5 to 3.5 cells from the runner's lane");
  return found;
}

function tryFindCellJustOutOfRunnerReach(seed: number): { tick: number; cell: { x: number; y: number } } | null {
  const map = generateMap(seed);
  for (let tick = RANGE_TICK; tick <= 120; tick += 1) {
    let position: { x: number; y: number };
    try {
      position = probeCreaturePosition(seed, "wave-1-creature-1", tick);
    } catch {
      break;
    }
    for (const cell of map.towerSpots) {
      const distance = Math.hypot(cell.x - position.x, cell.y - position.y);
      if (
        distance > 2.5
        && distance <= 3.5
        && createMatch({ players: [{ id: "p1", name: "Alpha" }], seed })
          .applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted
      ) {
        return { tick, cell: { x: cell.x, y: cell.y } };
      }
    }
  }
  return null;
}

test("ranged creature attacks are deterministic for the same seed", () => {
  const { cell } = findRangeScenario(getRangeTestSeed(), "wave-1-creature-3", 0, 1.5);
  const first = createMatchWithTowerAt(getRangeTestSeed(), cell);
  const second = createMatchWithTowerAt(getRangeTestSeed(), cell);
  // The wave may end before tick 30, so step until the simulation stops accepting wave ticks.
  for (const simulation of [first, second]) {
    for (let step = 0; step < 30 && simulation.applyCommand({ type: "advance-wave" }).accepted; step += 1) {
      // advance only
    }
  }
  assert.ok(first.getSnapshot().events.some((event) => event.type === "creature-attack"));
  assert.deepEqual(first.getSnapshot().events, second.getSnapshot().events);
});

// Spawn protection that never ends keeps the tower from shooting the creatures, so they live long enough to walk past
// it. Protected creatures still move and attack normally.
function freezeSpawnProtection(simulation: ReturnType<typeof createMatch>): void {
  const internals = simulation as unknown as { state: { creatures: Creature[] } };
  for (const creature of internals.state.creatures) {
    creature.spawnTick = Number.MAX_SAFE_INTEGER;
  }
}

test("a runner hits a tower 2 cells away for double damage", () => {
  // Creature 1 is a runner: base damage 1, reach 2.5, x2 between 1.5 and 2.5 cells.
  const { tick, cell } = findRangeScenario(getRangeTestSeed(), "wave-1-creature-1", 1.5, 2.5);
  const simulation = createMatchWithTowerAt(getRangeTestSeed(), cell);
  runToTick(simulation, 1);
  freezeSpawnProtection(simulation);
  runToTick(simulation, tick - 1);

  const runner = simulation.getSnapshot().creatures.find((entry) => entry.id === "wave-1-creature-1");
  assert.ok(runner, "runner is alive on the scenario tick");
  const distance = Math.hypot(cell.x - runner.x, cell.y - runner.y);
  assert.ok(distance > 1.5 && distance <= 2.5, `runner is in the x2 band (${distance})`);
  const attacks = eventsOnTick(simulation, "creature-attack", tick, "wave-1-creature-1");
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0]?.damage, 2);
});

// Hand-built state: in a live wave the towers kill creatures before several towers are in reach at once.
test("a creature damages every tower in reach, each with the damage of its own distance band", () => {
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
      { id: "p3", name: "Gamma" }
    ],
    seed: getRangeTestSeed()
  });
  const cells = getTowerCellsBesideLane(getRangeTestSeed(), 3);
  for (const [index, cell] of cells.entries()) {
    const playerId = `p${index + 1}`;
    assert.equal(simulation.applyCommand({ type: "place-tower", playerId, x: cell.x, y: cell.y }).accepted, true);
  }
  for (const playerId of ["p1", "p2", "p3"]) {
    assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId }).accepted, true);
  }
  const internals = simulation as unknown as {
    state: { creatures: Creature[]; towers: Tower[]; waveTick: number; events: MatchEvent[] };
    resolveCreatureAttacksForCurrentTick: () => void;
  };
  const place = (id: string, x: number, y: number): void => {
    const tower = internals.state.towers.find((entry) => entry.id === id);
    assert.ok(tower);
    tower.x = x;
    tower.y = y;
  };
  // Tank at (10,10): tower-p2 at distance 1 (x3 x1.2 = 11), tower-p1 at sqrt(5) = 2.24 (x2 x1.2 = 7), tower-p3 at 4 (out of reach).
  place("tower-p1", 12, 11);
  place("tower-p2", 11, 10);
  place("tower-p3", 14, 10);
  internals.state.creatures = [
    {
      id: "c1",
      archetype: "tank",
      hp: 8,
      x: 10,
      y: 10,
      pathIndex: 0,
      pathProgressUnits: 0,
      lane: 0,
      spawnTick: Number.MAX_SAFE_INTEGER,
      targetTowerId: "tower-p3"
    }
  ];
  const eventCountBefore = internals.state.events.length;
  internals.resolveCreatureAttacksForCurrentTick();
  const newEvents = internals.state.events.slice(eventCountBefore);

  const attacks = newEvents.filter(
    (event): event is Extract<MatchEvent, { type: "creature-attack" }> => event.type === "creature-attack"
  );
  assert.deepEqual(
    attacks.map((event) => ({ creatureId: event.creatureId, targetTowerId: event.targetTowerId, damage: event.damage })),
    [
      { creatureId: "c1", targetTowerId: "tower-p1", damage: 7 },
      { creatureId: "c1", targetTowerId: "tower-p2", damage: 11 }
    ]
  );
  const health = (id: string): number | undefined => internals.state.towers.find((entry) => entry.id === id)?.health;
  assert.equal(health("tower-p1"), DEFAULT_TOWER_HEALTH - 7);
  assert.equal(health("tower-p2"), DEFAULT_TOWER_HEALTH - 11);
  assert.equal(health("tower-p3"), DEFAULT_TOWER_HEALTH);

  // The reported primary target is still the nearest tower in reach.
  const selected = newEvents.find(
    (event): event is Extract<MatchEvent, { type: "creature-targets-selected" }> => event.type === "creature-targets-selected"
  );
  assert.deepEqual(selected?.assignments, [{ creatureId: "c1", targetTowerId: "tower-p2" }]);
});

// Seed 44 puts the second tower spot beside the lane where it takes steady damage without dying in wave 1.
const AT_RISK_TOWER_SEED = 44;

test("towers beside the lane are genuinely at risk", () => {
  // A lone level-1 tower beside the lane, no upgrades, through wave 6 (or until the match ends). The first pad beside
  // the lane sits by the cave, where creatures are still spawn-protected and the tower cannot shoot back (it falls in
  // wave 2), so this uses the next pad, a typical spot. Observed with the default bands on seed 44: total intake
  // 85 against 77 repaired over waves 1-6; health 100 after wave 1; lowest wave-end health 72.
  const [, cell] = getTowerCellsBesideLane(AT_RISK_TOWER_SEED, 2);
  assert.ok(cell);
  const simulation = createMatchWithTowerAt(AT_RISK_TOWER_SEED, cell);
  tickUntil(
    simulation,
    () => {
      const snapshot = simulation.getSnapshot();
      return snapshot.phase === "ended" || (snapshot.phase === "placement" && snapshot.wave === 7);
    },
    5000
  );

  const events = simulation.getSnapshot().events;
  const attacks = events.filter(
    (event): event is Extract<MatchEvent, { type: "creature-attack" }> => event.type === "creature-attack"
  );
  for (const attack of attacks) {
    assert.ok(attack.damage <= 9, `no single hit exceeds 9 (got ${attack.damage})`);
  }

  const intakeByWave = new Map<number, number>();
  for (const attack of attacks) {
    intakeByWave.set(attack.wave, (intakeByWave.get(attack.wave) ?? 0) + attack.damage);
  }
  const repairs = events.filter(
    (event): event is Extract<MatchEvent, { type: "tower-repaired" }> => event.type === "tower-repaired"
  );
  const totalIntake = [...intakeByWave.entries()].filter(([wave]) => wave <= 6).reduce((sum, [, value]) => sum + value, 0);
  const totalRepair = repairs.filter((event) => event.wave <= 6).reduce((sum, event) => sum + event.repairAmount, 0);

  // Health at the end of each wave, before the repair.
  let health = DEFAULT_TOWER_HEALTH;
  let lowestWaveEndHealth = DEFAULT_TOWER_HEALTH;
  let healthAfterWave1 = DEFAULT_TOWER_HEALTH;
  for (let wave = 1; wave <= 6; wave += 1) {
    health -= intakeByWave.get(wave) ?? 0;
    lowestWaveEndHealth = Math.min(lowestWaveEndHealth, health);
    if (wave === 1) {
      healthAfterWave1 = health;
    }
    health += repairs.filter((event) => event.wave === wave).reduce((sum, event) => sum + event.repairAmount, 0);
  }

  const wave1Destroyed = events.some((event) => event.type === "tower-destroyed" && event.wave === 1);
  assert.equal(wave1Destroyed, false, "the tower survives wave 1");
  assert.ok(healthAfterWave1 >= 70, `the tower survives wave 1 comfortably (health ${healthAfterWave1})`);
  assert.ok(
    totalIntake > totalRepair || lowestWaveEndHealth <= 70,
    `the tower is in real danger (intake ${totalIntake}, repair ${totalRepair}, lowest wave-end health ${lowestWaveEndHealth})`
  );
});

// Creatures only attack what is within a few cells (2.5 to 3.5), so tests that expect creature attacks need tower spots
// beside the lane. Tower spots are never on the lane, so any spot close to a lane cell leaves the lane unchanged.
const ATTACK_REACH = 3.5;

function getLaneCells(seed: number): Array<{ x: number; y: number }> {
  const probe = createMatch({ players: [{ id: "p1", name: "Probe" }], seed });
  for (const cell of [...getTowerSpotsNearSpawn(seed)].reverse()) {
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
  const probe = createMatch({
    players: Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` })),
    seed
  });
  const picked: Array<{ x: number; y: number }> = [];
  // Walk the lane from the cave; the first lane cells are inside the protected area and simply yield rejected spots.
  for (const laneCell of lane) {
    for (const spot of generateMap(seed).towerSpots) {
      if (
        picked.length < count
        && Math.hypot(spot.x - laneCell.x, spot.y - laneCell.y) <= ATTACK_REACH
        && !picked.some((entry) => entry.x === spot.x && entry.y === spot.y)
        && probe.applyCommand({ type: "place-tower", playerId: `p${picked.length + 1}`, x: spot.x, y: spot.y }).accepted
      ) {
        picked.push({ x: spot.x, y: spot.y });
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
