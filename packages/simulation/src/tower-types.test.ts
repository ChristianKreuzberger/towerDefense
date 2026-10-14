import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  MOVEMENT_PROGRESS_UNITS_PER_CELL,
  TOWER_TYPES,
  getCreatureBaseHp,
  getCreatureRewardPoints,
  isInSpawnProtection,
  type Creature,
  type GameMap,
  type MatchEvent,
  type Tower,
  type TowerTargetAssignment,
  type TowerType
} from "@tower-defense/shared";
import { getTowerSpotsNearSpawn } from "./spawn-order.js";
import { getBuildableCoordinates } from "./test-helpers.js";

type Internals = {
  resolveCombatForCurrentTick: () => void;
  moveCreaturesForCurrentTick: () => void;
  currentWavePath: Array<{ x: number; y: number }>;
  state: {
    wave: number;
    phase: string;
    waveTick: number;
    map: GameMap;
    towers: Tower[];
    creatures: Creature[];
    targetAssignments: TowerTargetAssignment[];
    players: Array<{ id: string; points: number }>;
    events: MatchEvent[];
  };
};

function createWaveMatch(towerTypes: TowerType[], seed = 31) {
  const players = towerTypes.map((_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const sim = createMatch({ players, seed });
  const cells = getBuildableCoordinates(seed, players.length);
  players.forEach((player, i) => {
    const cell = cells[i]!;
    const result = sim.applyCommand({ type: "place-tower", playerId: player.id, x: cell.x, y: cell.y, towerType: towerTypes[i]! });
    assert.equal(result.accepted, true);
  });
  for (const player of players) {
    assert.equal(sim.applyCommand({ type: "ready-for-wave", playerId: player.id }).accepted, true);
  }
  return { sim, internals: sim as unknown as Internals };
}

// First route index that is outside the protected cave area, so creatures there can be hit.
function firstOpenIndex(internals: Internals): number {
  const index = internals.currentWavePath.findIndex((cell) => !isInSpawnProtection(internals.state.map, cell.x, cell.y));
  assert.ok(index >= 0);
  return index;
}

function creatureAt(internals: Internals, id: string, archetype: Creature["archetype"], pathIndex: number, hp?: number): Creature {
  const cell = internals.currentWavePath[pathIndex]!;
  const creature: Creature = {
    id,
    archetype,
    hp: hp ?? getCreatureBaseHp(archetype),
    x: cell.x,
    y: cell.y,
    pathIndex,
    pathProgressUnits: 0,
    spawnTick: 1,
    targetTowerId: "tower-p1",
    lane: 0
  };
  internals.state.creatures.push(creature);
  return creature;
}

function shoot(internals: Internals, towerId: string, target: Creature, tick: number): MatchEvent[] {
  const tower = internals.state.towers.find((entry) => entry.id === towerId)!;
  tower.upgrades.accuracy = 5;
  tower.damageType = "physical";
  internals.state.waveTick = tick;
  internals.state.events = [];
  internals.state.targetAssignments = [{ towerId, mode: "first", targetCreatureId: target.id }];
  internals.resolveCombatForCurrentTick();
  return internals.state.events;
}

// Combat works on copies, so read results back from the match state.
const live = (internals: Internals, id: string): Creature | undefined =>
  internals.state.creatures.find((creature) => creature.id === id);

const hits = (events: MatchEvent[]) =>
  events.filter((event): event is Extract<MatchEvent, { type: "tower-hit" }> => event.type === "tower-hit");

test("placement stores the tower type; a missing type is arrow; an unknown type is rejected, not coerced", () => {
  const cells = getBuildableCoordinates(31, 3);
  const sim = createMatch({
    players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }, { id: "p3", name: "C" }],
    seed: 31
  });
  assert.equal(sim.applyCommand({ type: "place-tower", playerId: "p1", x: cells[0]!.x, y: cells[0]!.y, towerType: "cannon" }).accepted, true);
  assert.equal(sim.applyCommand({ type: "place-tower", playerId: "p2", x: cells[1]!.x, y: cells[1]!.y }).accepted, true);
  const bad = sim.applyCommand({ type: "place-tower", playerId: "p3", x: cells[2]!.x, y: cells[2]!.y, towerType: "laser" as TowerType });
  assert.deepEqual(bad, { accepted: false, reason: "invalid-tower-type" });
  const towers = sim.getSnapshot().towers;
  assert.equal(towers.find((tower) => tower.id === "tower-p1")?.towerType, "cannon");
  assert.equal(towers.find((tower) => tower.id === "tower-p2")?.towerType, "arrow");
  // A rejected placement leaves the player free to place again.
  assert.equal(sim.applyCommand({ type: "place-tower", playerId: "p3", x: cells[2]!.x, y: cells[2]!.y, towerType: "frost" }).accepted, true);
});

test("move-tower keeps the tower type", () => {
  const seed = 31;
  const spots = getTowerSpotsNearSpawn(seed);
  const sim = createMatch({ players: [{ id: "p1", name: "A" }], seed });
  const first = getBuildableCoordinates(seed, 1)[0]!;
  assert.equal(sim.applyCommand({ type: "place-tower", playerId: "p1", x: first.x, y: first.y, towerType: "frost" }).accepted, true);
  (sim as unknown as Internals).state.wave = 6;
  const target = spots.find((spot) => (spot.x !== first.x || spot.y !== first.y) && sim.applyCommand({ type: "move-tower", playerId: "p1", towerId: "tower-p1", x: spot.x, y: spot.y }).accepted);
  assert.ok(target, "a move was accepted");
  const tower = sim.getSnapshot().towers[0]!;
  assert.equal(tower.towerType, "frost");
  assert.deepEqual({ x: tower.x, y: tower.y }, target);
});

test("a cannon fires only on even wave ticks and makes no roll or event on odd ticks", () => {
  const { internals } = createWaveMatch(["cannon"]);
  const target = creatureAt(internals, "t", "tank", firstOpenIndex(internals) + 1);
  const odd = shoot(internals, "tower-p1", target, 3);
  assert.equal(odd.filter((event) => event.type === "tower-hit" || event.type === "tower-miss").length, 0);
  const even = shoot(internals, "tower-p1", target, 4);
  assert.equal(hits(even).length, 1);
  // 2 x damage level 1 = 2, physical against a tank is x1.5 = 3.
  assert.equal(hits(even)[0]!.damage, 3);
});

test("an arrow tower fires on every tick", () => {
  const { internals } = createWaveMatch(["arrow"]);
  const target = creatureAt(internals, "t", "tank", firstOpenIndex(internals) + 1);
  assert.equal(hits(shoot(internals, "tower-p1", target, 3)).length, 1);
  assert.equal(hits(shoot(internals, "tower-p1", target, 4)).length, 1);
});

test("cannon splash hits creatures within 1.5 cells at half damage, not farther ones", () => {
  const { sim, internals } = createWaveMatch(["cannon"]);
  const base = firstOpenIndex(internals) + 2;
  const target = creatureAt(internals, "a-target", "tank", base);
  const near = creatureAt(internals, "b-near", "tank", base + 1);
  const far = creatureAt(internals, "c-far", "tank", base + 6);
  const nearDistance = Math.hypot(near.x - target.x, near.y - target.y);
  assert.ok(nearDistance <= 1.5, "route neighbours are within splash radius");
  const farDistance = Math.hypot(far.x - target.x, far.y - target.y);
  assert.ok(farDistance > 1.5, "the far creature is outside the splash radius");

  const events = shoot(internals, "tower-p1", target, 4);
  const byId = Object.fromEntries(hits(events).map((hit) => [hit.creatureId, hit]));
  assert.equal(byId["a-target"]!.damage, 3);
  assert.equal(byId["a-target"]!.splash, undefined);
  // max(1, round(3 x 0.5)) = 2, then physical x1.5 against a tank = 3.
  assert.equal(byId["b-near"]!.damage, 3);
  assert.equal(byId["b-near"]!.splash, true);
  assert.equal(byId["c-far"], undefined);
  assert.equal(live(internals, "c-far")?.hp, getCreatureBaseHp("tank"));
  assert.equal(sim.getSnapshot().towers.length, 1);
});

test("splash kills pay the cannon's owner and never touch spawn-protected creatures", () => {
  const { internals } = createWaveMatch(["cannon", "arrow"]);
  const open = firstOpenIndex(internals);
  assert.ok(open > 0, "the route starts inside the protected area");
  const target = creatureAt(internals, "a-target", "tank", open);
  const protectedNeighbour = creatureAt(internals, "b-protected", "swarm", open - 1);
  creatureAt(internals, "c-victim", "swarm", open + 1, 1);
  const before = internals.state.players[0]!.points;
  const protectedDistance = Math.hypot(protectedNeighbour.x - target.x, protectedNeighbour.y - target.y);
  assert.ok(protectedDistance <= 1.5);

  const events = shoot(internals, "tower-p1", target, 4);
  assert.equal(live(internals, "b-protected")?.hp, getCreatureBaseHp("swarm"));
  assert.ok(!hits(events).some((hit) => hit.creatureId === "b-protected"));
  const defeated = events.filter((event): event is Extract<MatchEvent, { type: "creature-defeated" }> => event.type === "creature-defeated");
  assert.deepEqual(defeated.map((event) => [event.creatureId, event.playerId]), [["c-victim", "p1"]]);
  assert.equal(internals.state.players[0]!.points - before, getCreatureRewardPoints("swarm"));
  assert.equal(live(internals, "c-victim"), undefined);
});

test("a splash kill of a splitter still splits it", () => {
  const { internals } = createWaveMatch(["cannon"]);
  const open = firstOpenIndex(internals);
  const target = creatureAt(internals, "a-target", "tank", open + 1);
  creatureAt(internals, "wave-4-creature-5", "splitter", open + 2, 1);
  const events = shoot(internals, "tower-p1", target, 4);
  assert.ok(events.some((event) => event.type === "creature-split"));
});

test("frost hits slow for 2 + damage level ticks, refresh instead of stacking, and slow movement", () => {
  const { internals } = createWaveMatch(["frost"]);
  const open = firstOpenIndex(internals);
  const target = creatureAt(internals, "t", "tank", open + 1);
  const [hit] = hits(shoot(internals, "tower-p1", target, 6));
  // Damage level 1: max(1, round(0.5)) = 1, physical x1.5 against a tank rounds to 2.
  assert.equal(hit!.damage, 2);
  assert.equal(live(internals, "t")?.slowedUntilTick, 6 + 2 + 1);
  shoot(internals, "tower-p1", target, 8);
  assert.equal(live(internals, "t")?.slowedUntilTick, 8 + 2 + 1, "a new hit refreshes from the current tick");

  // Same start, one slowed, one normal: after a tick the slowed one has made less progress.
  const slowed = creatureAt(internals, "s", "runner", open + 1);
  const normal = creatureAt(internals, "n", "runner", open + 1);
  slowed.slowedUntilTick = 20;
  internals.state.creatures = [slowed, normal];
  internals.state.waveTick = 10;
  internals.moveCreaturesForCurrentTick();
  const progress = (id: string) => {
    const creature = internals.state.creatures.find((entry) => entry.id === id)!;
    return creature.pathIndex * MOVEMENT_PROGRESS_UNITS_PER_CELL + creature.pathProgressUnits;
  };
  const start = (open + 1) * MOVEMENT_PROGRESS_UNITS_PER_CELL;
  assert.ok(progress("s") - start > 0);
  assert.ok(progress("s") - start < progress("n") - start);
  // After the slow expired the creature moves at normal speed again.
  internals.state.creatures = [{ ...slowed, pathIndex: open + 1, pathProgressUnits: 0, slowedUntilTick: 5 }, { ...normal, pathIndex: open + 1, pathProgressUnits: 0 }];
  internals.state.waveTick = 10;
  internals.moveCreaturesForCurrentTick();
  assert.equal(progress("s"), progress("n"));
});

test("same seed and tower mix give identical events (determinism)", () => {
  function run(): MatchEvent[] {
    const { sim } = createWaveMatch(["arrow", "cannon", "frost"]);
    for (let i = 0; i < 120 && sim.getSnapshot().phase === "wave"; i += 1) {
      sim.applyCommand({ type: "advance-wave" });
    }
    return sim.getSnapshot().events;
  }
  const first = run();
  assert.ok(first.some((event) => event.type === "tower-hit" || event.type === "tower-miss"));
  assert.deepEqual(run(), first);
});

test("tower types are part of the snapshot and TOWER_TYPES lists all three", () => {
  assert.deepEqual([...TOWER_TYPES], ["arrow", "cannon", "frost"]);
  const { sim } = createWaveMatch(["arrow", "cannon", "frost"]);
  assert.deepEqual(sim.getSnapshot().towers.map((tower) => tower.towerType), ["arrow", "cannon", "frost"]);
});
