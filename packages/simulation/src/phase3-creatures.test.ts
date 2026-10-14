import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  STARTING_POINTS,
  SWARM_KILL_INCOME_CAP_PER_WAVE,
  getCreatureBaseHp,
  getCreatureRewardPoints,
  getWaveCreatureCount,
  type Creature,
  type MatchEvent,
  type Tower,
  type TowerTargetAssignment
} from "@tower-defense/shared";
import { getTowerSpotsNearSpawn } from "./spawn-order.js";
import { tickUntil } from "./test-helpers.js";

type Internals = {
  resolveCombatForCurrentTick: () => void;
  currentWavePath: Array<{ x: number; y: number }>;
  state: {
    wave: number;
    phase: string;
    waveTick: number;
    towers: Tower[];
    creatures: Creature[];
    targetAssignments: TowerTargetAssignment[];
    playerSwarmIncomeCurrentWave: Record<string, number>;
    telemetry: { currentWave: { creaturesSpawned: number; killsByArchetype: Record<string, number> } };
    players: Array<{ id: string; points: number }>;
  };
};

// Starts `wave` for a few players with towers placed. The wave number is set before the last ready.
function createWaveMatch(wave: number, playerCount = 4, seed = 31) {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const sim = createMatch({ players, seed });
  const candidates = getTowerSpotsNearSpawn(seed);
  let next = 0;
  for (const player of players) {
    for (; next < candidates.length; next += 1) {
      const cell = candidates[next]!;
      if (sim.applyCommand({ type: "place-tower", playerId: player.id, x: cell.x, y: cell.y }).accepted) {
        next += 1;
        break;
      }
    }
  }
  const internals = sim as unknown as Internals;
  internals.state.wave = wave;
  for (const player of players) {
    assert.equal(sim.applyCommand({ type: "ready-for-wave", playerId: player.id }).accepted, true);
  }
  assert.equal(internals.state.phase, "wave");
  return { sim, internals };
}

// Puts one creature on the route far from the cave, makes tower-p1 hit it with certainty, and resolves one combat step.
function killCreatureWithTower(internals: Internals, creature: Creature): void {
  const tower = internals.state.towers.find((entry) => entry.id === "tower-p1")!;
  tower.upgrades.accuracy = 5;
  tower.damageType = "physical";
  const cell = internals.currentWavePath[internals.currentWavePath.length - 3]!;
  creature.x = cell.x;
  creature.y = cell.y;
  creature.pathIndex = internals.currentWavePath.length - 3;
  internals.state.creatures.push(creature);
  internals.state.targetAssignments = [{ towerId: tower.id, mode: "first", targetCreatureId: creature.id }];
  internals.resolveCombatForCurrentTick();
}

function makeCreature(id: string, archetype: Creature["archetype"], hp: number): Creature {
  return {
    id,
    archetype,
    hp,
    x: 0,
    y: 0,
    pathIndex: 0,
    pathProgressUnits: 37,
    spawnTick: 3,
    targetTowerId: "tower-p2",
    lane: 1
  };
}

test("a killed splitter leaves two swarm children at its exact path position and pays its reward", () => {
  const { sim, internals } = createWaveMatch(4);
  const pointsBefore = internals.state.players[0]!.points;
  const spawnedBefore = internals.state.telemetry.currentWave.creaturesSpawned;
  const toSpawnBefore = sim.getSnapshot().creaturesToSpawn;
  killCreatureWithTower(internals, makeCreature("wave-4-creature-5", "splitter", 1));

  const children = internals.state.creatures.filter((creature) => creature.id.startsWith("wave-4-creature-5-"));
  assert.deepEqual(children.map((child) => child.id), ["wave-4-creature-5-s1", "wave-4-creature-5-s2"]);
  const parentPathIndex = internals.currentWavePath.length - 3;
  for (const child of children) {
    assert.equal(child.archetype, "swarm");
    assert.equal(child.hp, getCreatureBaseHp("swarm"));
    assert.equal(child.pathIndex, parentPathIndex);
    assert.equal(child.pathProgressUnits, 37);
    assert.equal(child.targetTowerId, "tower-p2");
    assert.equal(child.spawnTick, internals.state.waveTick);
    assert.deepEqual({ x: child.x, y: child.y }, internals.currentWavePath[parentPathIndex]);
  }
  assert.deepEqual(children.map((child) => child.lane), [0, 1]);
  assert.equal(internals.state.creatures.some((creature) => creature.id === "wave-4-creature-5"), false);

  assert.equal(internals.state.players[0]!.points - pointsBefore, getCreatureRewardPoints("splitter"));
  assert.equal(internals.state.telemetry.currentWave.killsByArchetype.splitter, 1);
  assert.equal(internals.state.telemetry.currentWave.creaturesSpawned - spawnedBefore, 2);
  // Children are not part of the wave's spawn schedule.
  assert.equal(sim.getSnapshot().creaturesToSpawn, toSpawnBefore);

  const split = sim.getSnapshot().events.find((event): event is Extract<MatchEvent, { type: "creature-split" }> => event.type === "creature-split");
  assert.deepEqual(split?.childIds, ["wave-4-creature-5-s1", "wave-4-creature-5-s2"]);
  assert.equal(split?.creatureId, "wave-4-creature-5");
});

test("children pay the swarm reward and respect the swarm income cap", () => {
  const { internals } = createWaveMatch(4);
  const pointsBefore = internals.state.players[0]!.points;
  killCreatureWithTower(internals, makeCreature("wave-4-creature-5-s1", "swarm", 1));
  assert.equal(internals.state.players[0]!.points - pointsBefore, getCreatureRewardPoints("swarm"));

  internals.state.playerSwarmIncomeCurrentWave["p1"] = SWARM_KILL_INCOME_CAP_PER_WAVE;
  const cappedBefore = internals.state.players[0]!.points;
  killCreatureWithTower(internals, makeCreature("wave-4-creature-5-s2", "swarm", 1));
  assert.equal(internals.state.players[0]!.points, cappedBefore);
});

test("a swarm that dies does not split", () => {
  const { internals } = createWaveMatch(4);
  killCreatureWithTower(internals, makeCreature("wave-4-creature-2", "swarm", 1));
  assert.equal(internals.state.creatures.length, 0);
});

test("wave 4 plays out: splits match defeated splitters, children must die before the wave ends, same seed same events", () => {
  function run(): MatchEvent[] {
    const { sim } = createWaveMatch(4);
    const events: MatchEvent[] = [];
    tickUntil(
      sim,
      () => {
        // Snapshots keep earlier events of the match, so only add the ones not seen yet.
        for (const event of sim.getSnapshot().events.slice(events.length)) {
          events.push(event);
        }
        return sim.getSnapshot().wave !== 4 || sim.getSnapshot().phase !== "wave";
      },
      2000
    );
    return events;
  }
  const first = run();
  const defeatedSplitters = new Set(
    first
      .filter((event): event is Extract<MatchEvent, { type: "creature-defeated" }> => event.type === "creature-defeated")
      .map((event) => event.creatureId)
  );
  const spawnedSplitters = first.filter(
    (event): event is Extract<MatchEvent, { type: "creature-spawned" }> =>
      event.type === "creature-spawned" && event.archetype === "splitter"
  );
  assert.ok(spawnedSplitters.length >= 1, "wave 4 has a splitter");
  const splits = first.filter((event): event is Extract<MatchEvent, { type: "creature-split" }> => event.type === "creature-split");
  for (const split of splits) {
    assert.ok(defeatedSplitters.has(split.creatureId));
  }
  assert.equal(
    splits.length,
    spawnedSplitters.filter((event) => defeatedSplitters.has(event.creatureId)).length
  );
  // The wave only finished after every child was gone: all split children were defeated or exited.
  const gone = new Set(
    first
      .filter((event) => event.type === "creature-defeated" || event.type === "creature-exited")
      .map((event) => (event as { creatureId: string }).creatureId)
  );
  for (const split of splits) {
    for (const childId of split.childIds) {
      assert.ok(gone.has(childId), `${childId} was still alive when the loop ended`);
    }
  }
  assert.deepEqual(run(), first);
});

test("wave 5 ends its spawn schedule with one juggernaut and has one creature more", () => {
  const { sim } = createWaveMatch(5);
  const spawned: Array<Extract<MatchEvent, { type: "creature-spawned" }>> = [];
  tickUntil(
    sim,
    () => {
      for (const event of sim.getSnapshot().events) {
        if (event.type === "creature-spawned" && !spawned.some((entry) => entry.creatureId === event.creatureId)) {
          spawned.push(event);
        }
      }
      return spawned.length >= getWaveCreatureCount(5);
    },
    500
  );
  assert.equal(getWaveCreatureCount(5), 12);
  assert.equal(spawned.length, 12);
  assert.equal(spawned.at(-1)?.archetype, "juggernaut");
  assert.equal(spawned.filter((event) => event.archetype === "juggernaut").length, 1);
  assert.equal(spawned[4]?.archetype, "splitter");
  assert.equal(STARTING_POINTS > 0, true);
});
