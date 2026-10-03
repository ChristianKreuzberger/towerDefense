import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  DEFAULT_TOWER_HEALTH,
  MOVEMENT_PROGRESS_UNITS_PER_CELL,
  MAX_PLAYERS,
  WIN_SCORE,
  STARTING_POINTS,
  BASE_TOWER_RANGE,
  SPAWN_PROTECTION_TICKS,
  TOWER_RANGE_PER_LEVEL,
  type MatchEvent,
  type MatchSnapshot,
  getBetweenWaveTowerRepairAmount,
  getCreatureAttackDamageAt,
  getCreatureAttackRange,
  type Creature,
  type CreatureArchetype,
  isWithinCreatureAttackRange,
  getCreatureMovementSpeedUnits,
  PATH_CELL_MAX_WEAR,
  getTowerRange,
  isInSpawnProtection,
  getWaveCreatureCount,
  getTowerUpgradeCost,
  MAX_TOWER_LEVEL,
  getWaveClearBonus,
  getDamageAgainst,
  DAMAGE_TYPES,
  type DamageType,
  isValidTowerPlacement,
  type GameMap,
  type Tower,
} from "@tower-defense/shared";
import { generateMap } from "./procedural-map.js";
import { getBuildableCellsNearSpawn } from "./spawn-order.js";

// Where the first creature is on the first tick it can be targeted. With range 6 and spawn protection, towers
// sorted by distance to the cave itself would see creatures walk out of range before they become shootable.
function getFirstTargetablePosition(seed: number): { x: number; y: number } {
  const candidates = getBuildableCellsNearSpawn(seed);
  const probe = createMatch({ players: [{ id: "p1", name: "Probe" }], seed });
  // The lane does not depend on the tower, so any placeable cell works for the probe; the farthest one stays out of the way.
  for (const cell of [...candidates].reverse()) {
    if (probe.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted) {
      break;
    }
  }
  probe.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  advanceToFirstTargetableTick(probe);
  const creature = probe.getSnapshot().creatures.find((entry) => entry.id === "wave-1-creature-1");
  assert.ok(creature, "expected the first creature to be alive on its first targetable tick");
  return { x: creature.x, y: creature.y };
}

// Greedily places one tower per player so combinations that block the lane are skipped.
function getPlaceableCellsNearSpawn(seed: number, count: number): Array<{ x: number; y: number }> {
  const lanePoint = getFirstTargetablePosition(seed);
  const cellsNearLane = [...getBuildableCellsNearSpawn(seed)].sort(
    (a, b) =>
      Math.hypot(a.x - lanePoint.x, a.y - lanePoint.y) - Math.hypot(b.x - lanePoint.x, b.y - lanePoint.y)
      || a.y - b.y || a.x - b.x
  );
  const probe = createMatch({
    players: Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` })),
    seed
  });
  const picked: Array<{ x: number; y: number }> = [];
  for (const cell of cellsNearLane) {
    if (picked.length === count) {
      break;
    }
    const result = probe.applyCommand({ type: "place-tower", playerId: `p${picked.length + 1}`, x: cell.x, y: cell.y });
    if (result.accepted) {
      picked.push(cell);
    }
  }
  assert.equal(picked.length, count, `expected at least ${count} placeable cells`);
  return picked;
}

function getBuildableCoordinate(seed: number): { x: number; y: number } {
  const [cell] = getPlaceableCellsNearSpawn(seed, 1);
  assert.ok(cell, "expected at least one buildable cell");
  return cell;
}

function getNonBuildableCoordinate(seed: number): { x: number; y: number } {
  const map = generateMap(seed);
  const cell = map.cells.find((entry) => !entry.buildable);
  assert.ok(cell, "expected at least one non-buildable cell");
  return { x: cell.x, y: cell.y };
}

function getSecondBuildableCoordinate(
  seed: number,
  first: { x: number; y: number }
): { x: number; y: number } {
  const cell = getPlaceableCellsNearSpawn(seed, 2).find((entry) => entry.x !== first.x || entry.y !== first.y);
  assert.ok(cell, "expected at least one additional buildable cell");
  return cell;
}

function getBuildableCoordinates(seed: number, count: number): Array<{ x: number; y: number }> {
  return getPlaceableCellsNearSpawn(seed, count);
}

// `damageType` is set before readying; tests that assert exact per-hit damage use a type that is neutral (x1) against the first runner.
function createSinglePlayerWaveSimulation(seed: number, damageType?: DamageType): ReturnType<typeof createMatch> {
  const towerCoordinate = getBuildableCoordinate(seed);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed
  });

  const placeTower = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: towerCoordinate.x,
    y: towerCoordinate.y
  });
  assert.equal(placeTower.accepted, true);

  if (damageType) {
    assert.equal(simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType }).accepted, true);
  }

  const ready = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  assert.equal(ready.accepted, true);

  return simulation;
}

function tickUntil(
  simulation: ReturnType<typeof createMatch>,
  condition: () => boolean,
  maxSteps: number
): void {
  for (let step = 0; step < maxSteps && !condition(); step += 1) {
    const snapshot = simulation.getSnapshot();
    if (snapshot.phase === "wave") {
      const result = simulation.applyCommand({ type: "advance-wave" });
      assert.equal(result.accepted, true);
      continue;
    }

    if (snapshot.phase === "placement") {
      for (const player of snapshot.players) {
        if (player.eliminated || !player.hasPlacedTower || player.readyForWave) {
          continue;
        }

        const ready = simulation.applyCommand({
          type: "ready-for-wave",
          playerId: player.id
        });
        assert.equal(ready.accepted, true);
      }
    }
  }
}

test("generates deterministic maps for identical seeds", () => {
  const first = generateMap(42);
  const second = generateMap(42);

  assert.deepEqual(first, second);
});

function shortestRouteLength(map: ReturnType<typeof generateMap>): number {
  const open = new Set(map.cells.filter((cell) => cell.buildable).map((cell) => `${cell.x},${cell.y}`));
  const spawn = map.spawn;
  assert.ok(spawn);
  const distance = new Map<string, number>([[`${spawn.x},${spawn.y}`, 1]]);
  const queue = [spawn];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    assert.ok(current);
    const steps = distance.get(`${current.x},${current.y}`) ?? 0;
    if (current.x === map.width - 1) {
      return steps;
    }
    for (const next of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 }
    ]) {
      const key = `${next.x},${next.y}`;
      if (open.has(key) && !distance.has(key)) {
        distance.set(key, steps + 1);
        queue.push(next);
      }
    }
  }
  return Number.POSITIVE_INFINITY;
}

test("the creature route winds through the map like a maze", () => {
  for (const seed of [1, 42, 99, 2024, 777]) {
    const map = generateMap(seed);
    const length = shortestRouteLength(map);
    assert.ok(length >= map.width * 3, `seed ${seed}: route of ${length} cells is too direct`);
    assert.ok(length < Number.POSITIVE_INFINITY, `seed ${seed}: no route to the right edge`);
  }
});

test("every map has a monster cave on the left edge, on a walkable cell", () => {
  for (const seed of [1, 42, 99, 2024, 777]) {
    const map = generateMap(seed);
    assert.ok(map.spawn, `seed ${seed} should have a spawn`);
    assert.equal(map.spawn.x, 0);
    const cell = map.cells.find((entry) => entry.x === map.spawn?.x && entry.y === map.spawn?.y);
    assert.equal(cell?.buildable, true);
  }
});

test("creatures spawn in the cave", () => {
  const seed = 42;
  const spawn = generateMap(seed).spawn;
  assert.ok(spawn);
  const cell = getBuildableCoordinate(seed);
  const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
  assert.equal(simulation.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted, true);
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  simulation.applyCommand({ type: "advance-wave" });
  const creature = simulation.getSnapshot().creatures[0];
  assert.deepEqual({ x: creature?.x, y: creature?.y }, spawn);
});

test("towers cannot be placed in the cave's protected area", () => {
  const seed = 42;
  const spawn = generateMap(seed).spawn;
  assert.ok(spawn);
  const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
  assert.deepEqual(simulation.applyCommand({ type: "place-tower", playerId: "p1", x: spawn.x, y: spawn.y }), {
    accepted: false,
    reason: "spawn-protected"
  });
});

test("different seeds produce different map layouts", () => {
  const first = generateMap(42);
  const second = generateMap(43);

  const differentCells = first.cells.filter((cell, index) => {
    const other = second.cells[index];
    return other ? cell.buildable !== other.buildable : false;
  }).length;
  assert.ok(differentCells > 0);
});

test("rejects setup with less than 1 player", () => {
  assert.throws(
    () =>
      createMatch({
        players: [],
        seed: 1
      }),
    /player count must be between/
  );
});

test("rejects setup with more than 8 players", () => {
  assert.throws(
    () =>
      createMatch({
        players: Array.from({ length: MAX_PLAYERS + 1 }, (_, index) => ({
          id: `p-${index}`,
          name: `Player ${index}`
        })),
        seed: 1
      }),
    /player count must be between/
  );
});

test("enforces one tower placement per player", () => {
  const buildable = getBuildableCoordinate(1);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 1
  });

  const first = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: buildable.x,
    y: buildable.y
  });
  assert.equal(first.accepted, true);

  const second = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: 6,
    y: 3
  });
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "tower-already-placed");
});

test("rejects placement on non-buildable cells", () => {
  const nonBuildable = getNonBuildableCoordinate(2);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 2
  });

  const result = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: nonBuildable.x,
    y: nonBuildable.y
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "cell-not-buildable");
  assert.equal(simulation.getSnapshot().phase, "placement");
});

test("rejects overlapping tower placements", () => {
  const buildable = getBuildableCoordinate(3);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed: 3
  });

  const first = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: buildable.x,
    y: buildable.y
  });
  assert.equal(first.accepted, true);

  const second = simulation.applyCommand({
    type: "place-tower",
    playerId: "p2",
    x: buildable.x,
    y: buildable.y
  });
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "tower-overlap");
  assert.equal(simulation.getSnapshot().phase, "placement");
});

test("rejects placements that newly block left-to-right path connectivity", () => {
  const map: GameMap = {
    schemaVersion: 1,
    width: 3,
    height: 3,
    seed: 0,
    cells: [
      { x: 0, y: 0, buildable: true, pathWear: 0 },
      { x: 1, y: 0, buildable: true, pathWear: 0 },
      { x: 2, y: 0, buildable: true, pathWear: 0 },
      { x: 0, y: 1, buildable: true, pathWear: 0 },
      { x: 1, y: 1, buildable: true, pathWear: 0 },
      { x: 2, y: 1, buildable: true, pathWear: 0 },
      { x: 0, y: 2, buildable: true, pathWear: 0 },
      { x: 1, y: 2, buildable: true, pathWear: 0 },
      { x: 2, y: 2, buildable: true, pathWear: 0 }
    ]
  };

  const existingTowers: Tower[] = [
    {
      id: "t-1",
      playerId: "p1",
      x: 1,
      y: 0,
      health: 100,
      maxHealth: 100,
      level: 1,
      upgrades: { range: 1, damage: 1, accuracy: 1 },
      targetMode: "first", damageType: "physical"
    },
    {
      id: "t-2",
      playerId: "p2",
      x: 1,
      y: 2,
      health: 100,
      maxHealth: 100,
      level: 1,
      upgrades: { range: 1, damage: 1, accuracy: 1 },
      targetMode: "first", damageType: "physical"
    }
  ];

  const result = isValidTowerPlacement({ playerId: "p3", x: 1, y: 1 }, existingTowers, map);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "path-blocked");
});

test("allows placements when an alternate path remains", () => {
  const map: GameMap = {
    schemaVersion: 1,
    width: 3,
    height: 3,
    seed: 0,
    cells: [
      { x: 0, y: 0, buildable: true, pathWear: 0 },
      { x: 1, y: 0, buildable: true, pathWear: 0 },
      { x: 2, y: 0, buildable: true, pathWear: 0 },
      { x: 0, y: 1, buildable: true, pathWear: 0 },
      { x: 1, y: 1, buildable: true, pathWear: 0 },
      { x: 2, y: 1, buildable: true, pathWear: 0 },
      { x: 0, y: 2, buildable: true, pathWear: 0 },
      { x: 1, y: 2, buildable: true, pathWear: 0 },
      { x: 2, y: 2, buildable: true, pathWear: 0 }
    ]
  };

  const existingTowers: Tower[] = [
    {
      id: "t-1",
      playerId: "p1",
      x: 1,
      y: 0,
      health: 100,
      maxHealth: 100,
      level: 1,
      upgrades: { range: 1, damage: 1, accuracy: 1 },
      targetMode: "first", damageType: "physical"
    }
  ];

  const result = isValidTowerPlacement({ playerId: "p2", x: 1, y: 1 }, existingTowers, map);
  assert.equal(result.valid, true);
});

test("upgrades tower in prep phase before ready and deducts deterministic cost", () => {
  const towerCoordinate = getBuildableCoordinate(10);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 10
  });

  const placeTower = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: towerCoordinate.x,
    y: towerCoordinate.y
  });
  assert.equal(placeTower.accepted, true);

  const startingUpgradeCost = getTowerUpgradeCost("damage", 1);
  simulation.awardPoints("p1", startingUpgradeCost);

  const upgrade = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p1",
    towerId: "tower-p1", track: "damage"
  });
  assert.equal(upgrade.accepted, true);
  assert.equal(simulation.getSnapshot().phase, "placement");

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.towers[0]?.level, 2);
  assert.equal(snapshot.players[0]?.points, STARTING_POINTS);
});

test("every player starts with starting points and can spend them on an upgrade right after placing", () => {
  const [firstTower, secondTower] = getBuildableCoordinates(10, 2);
  assert.ok(firstTower);
  assert.ok(secondTower);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed: 10
  });
  assert.deepEqual(simulation.getSnapshot().players.map((player) => player.points), [STARTING_POINTS, STARTING_POINTS]);

  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstTower.x, y: firstTower.y });
  simulation.applyCommand({ type: "place-tower", playerId: "p2", x: secondTower.x, y: secondTower.y });
  // The late placer can use the points to make up for a worse spot, e.g. with more range.
  const upgrade = simulation.applyCommand({ type: "upgrade-tower", playerId: "p2", towerId: "tower-p2", track: "range" });
  assert.equal(upgrade.accepted, true);
  assert.equal(
    simulation.getSnapshot().players.find((player) => player.id === "p2")?.points,
    STARTING_POINTS - getTowerUpgradeCost("range", 1)
  );
});

test("rejects tower upgrade after the player readied while the phase is still placement", () => {
  const [firstTower, secondTower] = getBuildableCoordinates(10, 2);
  assert.ok(firstTower);
  assert.ok(secondTower);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed: 10
  });
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstTower.x, y: firstTower.y });
  simulation.applyCommand({ type: "place-tower", playerId: "p2", x: secondTower.x, y: secondTower.y });
  simulation.awardPoints("p1", getTowerUpgradeCost("damage", 1));
  simulation.awardPoints("p2", getTowerUpgradeCost("damage", 1));
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  assert.equal(simulation.getSnapshot().phase, "placement");

  const late = simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "damage" });
  assert.equal(late.accepted, false);
  assert.equal(late.reason, "player-already-ready-for-wave");

  // A player who has not readied yet is unaffected by the other player's ready.
  const other = simulation.applyCommand({ type: "upgrade-tower", playerId: "p2", towerId: "tower-p2", track: "damage" });
  assert.equal(other.accepted, true);
});

test("rejects tower upgrade during the wave phase", () => {
  const towerCoordinate = getBuildableCoordinate(10);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 10
  });
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: towerCoordinate.x, y: towerCoordinate.y });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  assert.equal(simulation.getSnapshot().phase, "wave");
  simulation.awardPoints("p1", getTowerUpgradeCost("damage", 1));

  const upgrade = simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "damage" });
  assert.equal(upgrade.accepted, false);
  assert.equal(upgrade.reason, "upgrade-phase-not-active");
});

test("rejects tower upgrade when player has insufficient points", () => {
  const towerCoordinate = getBuildableCoordinate(11);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 11
  });

  const placeTower = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: towerCoordinate.x,
    y: towerCoordinate.y
  });
  assert.equal(placeTower.accepted, true);

  // The starting points cover one damage upgrade (96) but not a second (153).
  const first = simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "damage" });
  assert.equal(first.accepted, true);
  const upgrade = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p1",
    towerId: "tower-p1", track: "damage"
  });
  assert.equal(upgrade.accepted, false);
  assert.equal(upgrade.reason, "insufficient-points");
});

test("rejects tower upgrade for invalid target ownership", () => {
  const firstTower = getBuildableCoordinate(12);
  const secondTower = getSecondBuildableCoordinate(12, firstTower);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed: 12
  });

  simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: firstTower.x,
    y: firstTower.y
  });
  simulation.applyCommand({
    type: "place-tower",
    playerId: "p2",
    x: secondTower.x,
    y: secondTower.y
  });
  simulation.awardPoints("p2", getTowerUpgradeCost("damage", 1));
  const invalidOwnership = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p2",
    towerId: "tower-p1", track: "damage"
  });
  assert.equal(invalidOwnership.accepted, false);
  assert.equal(invalidOwnership.reason, "invalid-upgrade-target");

  const unknownTower = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p2",
    towerId: "tower-missing", track: "damage"
  });
  assert.equal(unknownTower.accepted, false);
  assert.equal(unknownTower.reason, "invalid-upgrade-target");
});

test("updates tower target mode in wave phase", () => {
  const towerCoordinate = getBuildableCoordinate(13);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 13
  });

  const placeTower = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: towerCoordinate.x,
    y: towerCoordinate.y
  });
  assert.equal(placeTower.accepted, true);

  const ready = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  assert.equal(ready.accepted, true);

  const result = simulation.applyCommand({
    type: "set-target-mode",
    playerId: "p1",
    towerId: "tower-p1",
    mode: "strongest"
  });
  assert.equal(result.accepted, true);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.towers[0]?.targetMode, "strongest");
});

test("marks player ready for wave during placement phase", () => {
  const towerCoordinate = getBuildableCoordinate(16);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 16
  });

  const placeTower = simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: towerCoordinate.x,
    y: towerCoordinate.y
  });
  assert.equal(placeTower.accepted, true);
  assert.equal(simulation.getSnapshot().phase, "placement");

  const ready = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });

  assert.equal(ready.accepted, true);
  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.players[0]?.readyForWave, true);
  assert.equal(snapshot.allPlayersReadyForWave, true);
  assert.equal(snapshot.phase, "wave");
});

test("rejects ready-for-wave for unknown player and duplicate readiness", () => {
  const firstTower = getBuildableCoordinate(17);
  const secondTower = getSecondBuildableCoordinate(17, firstTower);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed: 17
  });

  simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: firstTower.x,
    y: firstTower.y
  });
  simulation.applyCommand({
    type: "place-tower",
    playerId: "p2",
    x: secondTower.x,
    y: secondTower.y
  });

  const unknownPlayer = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "missing"
  });
  assert.equal(unknownPlayer.accepted, false);
  assert.equal(unknownPlayer.reason, "unknown-player");

  const firstReady = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  assert.equal(firstReady.accepted, true);

  const duplicateReady = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  assert.equal(duplicateReady.accepted, false);
  assert.equal(duplicateReady.reason, "player-already-ready-for-wave");
});

test("rejects ready-for-wave when readiness phase is not active", () => {
  const towerCoordinate = getBuildableCoordinate(19);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 19
  });

  simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: towerCoordinate.x,
    y: towerCoordinate.y
  });

  simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });

  const result = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "ready-phase-not-active");
});

test("rejects ready-for-wave before player has placed a tower", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 18
  });

  const result = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "tower-not-placed");
});

test("rejects target mode updates for invalid target ownership", () => {
  const firstTower = getBuildableCoordinate(14);
  const secondTower = getSecondBuildableCoordinate(14, firstTower);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed: 14
  });

  simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: firstTower.x,
    y: firstTower.y
  });
  simulation.applyCommand({
    type: "place-tower",
    playerId: "p2",
    x: secondTower.x,
    y: secondTower.y
  });
  simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p2"
  });

  const invalidOwnership = simulation.applyCommand({
    type: "set-target-mode",
    playerId: "p2",
    towerId: "tower-p1",
    mode: "nearest"
  });
  assert.equal(invalidOwnership.accepted, false);
  assert.equal(invalidOwnership.reason, "invalid-target-mode-target");

  const unknownTower = simulation.applyCommand({
    type: "set-target-mode",
    playerId: "p2",
    towerId: "tower-missing",
    mode: "nearest"
  });
  assert.equal(unknownTower.accepted, false);
  assert.equal(unknownTower.reason, "invalid-target-mode-target");
});

test("rejects unsupported tower target mode", () => {
  const towerCoordinate = getBuildableCoordinate(15);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 15
  });

  simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: towerCoordinate.x,
    y: towerCoordinate.y
  });
  simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });

  const invalidMode = simulation.applyCommand({
    type: "set-target-mode",
    playerId: "p1",
    towerId: "tower-p1",
    mode: "furthest" as unknown as "first"
  });
  assert.equal(invalidMode.accepted, false);
  assert.equal(invalidMode.reason, "invalid-target-mode");
});

test("keeps placement phase until every player has placed and readied for wave", () => {
  const [firstCell, secondCell] = getBuildableCoordinates(1, 2);
  assert.ok(firstCell && secondCell, "expected two defined buildable cells");

  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed: 1
  });

  simulation.applyCommand({
    type: "place-tower",
    playerId: "p1",
    x: firstCell.x,
    y: firstCell.y
  });
  assert.equal(simulation.getSnapshot().phase, "placement");

  simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  assert.equal(simulation.getSnapshot().allPlayersReadyForWave, false);
  assert.equal(simulation.getSnapshot().phase, "placement");

  simulation.applyCommand({
    type: "place-tower",
    playerId: "p2",
    x: secondCell.x,
    y: secondCell.y
  });
  assert.equal(simulation.getSnapshot().phase, "placement");

  simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p2"
  });
  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.allPlayersReadyForWave, true);
  assert.equal(snapshot.phase, "wave");
  assert.equal(snapshot.towers.length, 2);
});

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
  const simulation = createSinglePlayerWaveSimulation(31, "explosive");

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
  // Seed picked so the shots land in the order the assertions describe: hits and misses depend on the seed.
  const runScenario = (): {
    events: {
      hitEvents: Array<{ towerId: string; creatureId: string; remainingHp: number }>;
      defeatedEvents: Array<{ towerId: string; playerId: string; creatureId: string; rewardPoints: number }>;
    };
    players: Array<{ id: string; points: number }>;
  } => {
    const firstTower = getBuildableCoordinate(29);
    const secondTower = getSecondBuildableCoordinate(29, firstTower);
    const simulation = createMatch({
      players: [
        { id: "p2", name: "Beta" },
        { id: "p1", name: "Alpha" }
      ],
      seed: 29
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

test("rejects advance-wave when wave phase is not active", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 22
  });

  const result = simulation.applyCommand({ type: "advance-wave" });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "wave-phase-not-active");
});

test("ends match when a player reaches 1000 points", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 1
  });

  simulation.awardPoints("p1", WIN_SCORE);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.phase, "ended");
  assert.equal(snapshot.winnerId, "p1");
  assert.equal(snapshot.endReason, "score-win");
});

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

test("aggregates deterministic telemetry snapshot from movement, combat, and repair contributions", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 50
  });

  const towerCoordinate = getBuildableCoordinate(50);
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

  tickUntil(simulation, () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2, 500);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.telemetry.completedWaves.length, 1);
  const waveOneTelemetry = snapshot.telemetry.completedWaves[0];
  assert.ok(waveOneTelemetry);
  assert.equal(waveOneTelemetry.wave, 1);

  const waveOneEvents = snapshot.events.filter((event) => event.wave === 1);
  const movementEvents = waveOneEvents.filter(
    (event): event is Extract<MatchEvent, { type: "movement-resolved" }> => event.type === "movement-resolved"
  );
  const towerHitEvents = waveOneEvents.filter(
    (event): event is Extract<MatchEvent, { type: "tower-hit" }> => event.type === "tower-hit"
  );
  const creatureAttackEvents = waveOneEvents.filter(
    (event): event is Extract<MatchEvent, { type: "creature-attack" }> => event.type === "creature-attack"
  );
  const spawnEvents = waveOneEvents.filter(
    (event): event is Extract<MatchEvent, { type: "creature-spawned" }> => event.type === "creature-spawned"
  );
  const exitEvents = waveOneEvents.filter(
    (event): event is Extract<MatchEvent, { type: "creature-exited" }> => event.type === "creature-exited"
  );
  const defeatedEvents = waveOneEvents.filter(
    (event): event is Extract<MatchEvent, { type: "creature-defeated" }> => event.type === "creature-defeated"
  );
  const towerRepairEvents = waveOneEvents.filter(
    (event): event is Extract<MatchEvent, { type: "tower-repaired" }> => event.type === "tower-repaired"
  );

  const expectedMovementProgressUnits = movementEvents.reduce((total, event) => {
    if (event.exited) {
      return total + Math.max(0, (event.steps.length * MOVEMENT_PROGRESS_UNITS_PER_CELL) - event.fromProgressUnits);
    }

    return total + (((event.toPathIndex - event.fromPathIndex) * MOVEMENT_PROGRESS_UNITS_PER_CELL) + (event.toProgressUnits - event.fromProgressUnits));
  }, 0);
  const expectedMovementSteps = movementEvents.reduce((total, event) => total + event.steps.length, 0);
  const expectedTowerDamageDealt = towerHitEvents.reduce((total, event) => total + event.damage, 0);
  const expectedTowerDamageIntake = creatureAttackEvents.reduce((total, event) => total + event.damage, 0);
  const expectedTowerRepairApplied = towerRepairEvents.reduce((total, event) => total + event.repairAmount, 0);
  const expectedKillsByArchetype = defeatedEvents.reduce(
    (totals, event) => {
      const spawned = spawnEvents.find((spawn) => spawn.creatureId === event.creatureId);
      assert.ok(spawned);
      totals[spawned.archetype] += 1;
      return totals;
    },
    { runner: 0, swarm: 0, armored: 0, tank: 0 }
  );

  assert.equal(waveOneTelemetry.movementProgressUnits, expectedMovementProgressUnits);
  assert.equal(waveOneTelemetry.movementSteps, expectedMovementSteps);
  assert.equal(waveOneTelemetry.creaturesSpawned, spawnEvents.length);
  assert.equal(waveOneTelemetry.creaturesDefeated, defeatedEvents.length);
  assert.equal(waveOneTelemetry.creaturesExited, exitEvents.length);
  assert.equal(waveOneTelemetry.towerDamageDealt, expectedTowerDamageDealt);
  assert.equal(waveOneTelemetry.towerDamageIntake, expectedTowerDamageIntake);
  assert.equal(waveOneTelemetry.towerRepairApplied, expectedTowerRepairApplied);
  assert.deepEqual(waveOneTelemetry.killsByArchetype, expectedKillsByArchetype);
  assert.equal(waveOneTelemetry.creaturesDefeated + waveOneTelemetry.creaturesExited, waveOneTelemetry.creaturesSpawned);

  const telemetryEvent = snapshot.events.find(
    (event): event is Extract<MatchEvent, { type: "telemetry-snapshot" }> =>
      event.type === "telemetry-snapshot" && event.wave === 1
  );
  assert.ok(telemetryEvent);
  assert.deepEqual(telemetryEvent.snapshot, waveOneTelemetry);
});

test("telemetry snapshot and completed-wave aggregates are deterministic across equivalent runs", () => {
  const runScenario = (): {
    telemetry: MatchSnapshot["telemetry"];
    telemetryEvents: Array<Extract<MatchEvent, { type: "telemetry-snapshot" }>>;
  } => {
    const simulation = createMatch({
      players: [{ id: "p1", name: "Alpha" }],
      seed: 51
    });
    const towerCoordinate = getBuildableCoordinate(51);
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

    tickUntil(
      simulation,
      () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2,
      500
    );

    const snapshot = simulation.getSnapshot();
    return {
      telemetry: snapshot.telemetry,
      telemetryEvents: snapshot.events.filter(
        (event): event is Extract<MatchEvent, { type: "telemetry-snapshot" }> => event.type === "telemetry-snapshot"
      )
    };
  };

  const firstRun = runScenario();
  const secondRun = runScenario();
  assert.deepEqual(firstRun, secondRun);
});

test("exports deterministic balance-analysis snapshot with expected wave and economy fields", () => {
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    seed: 52
  });

  const [firstTower, secondTower] = getBuildableCoordinates(52, 2);
  assert.ok(firstTower);
  assert.ok(secondTower);

  assert.equal(
    simulation.applyCommand({
      type: "place-tower",
      playerId: "p1",
      x: firstTower.x,
      y: firstTower.y
    }).accepted,
    true
  );
  assert.equal(
    simulation.applyCommand({
      type: "place-tower",
      playerId: "p2",
      x: secondTower.x,
      y: secondTower.y
    }).accepted,
    true
  );

  simulation.awardPoints("p1", getTowerUpgradeCost("damage", 1));

  assert.equal(
    simulation.applyCommand({
      type: "upgrade-tower",
      playerId: "p1",
      towerId: "tower-p1", track: "damage"
    }).accepted,
    true
  );

  assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" }).accepted, true);
  assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" }).accepted, true);

  tickUntil(
    simulation,
    () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2,
    600
  );

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.balanceAnalysisExports.length, 1);
  const exportSnapshot = snapshot.balanceAnalysisExports[0];
  assert.ok(exportSnapshot);
  assert.equal(exportSnapshot.schemaVersion, 1);
  assert.equal(exportSnapshot.matchSeed, 52);
  assert.equal(exportSnapshot.exportOrdinal, 1);
  assert.equal(exportSnapshot.wave, 1);
  assert.equal(exportSnapshot.tick, exportSnapshot.waveTelemetry.tick);

  assert.deepEqual(exportSnapshot.waveTelemetry, snapshot.telemetry.completedWaves[0]);
  assert.equal(exportSnapshot.cumulativeTelemetry.completedWaveCount, 1);
  assert.deepEqual(exportSnapshot.cumulativeTelemetry.killsByArchetype, exportSnapshot.waveTelemetry.killsByArchetype);
  assert.equal(exportSnapshot.cumulativeTelemetry.creaturesSpawned, exportSnapshot.waveTelemetry.creaturesSpawned);
  assert.equal(exportSnapshot.cumulativeTelemetry.creaturesDefeated, exportSnapshot.waveTelemetry.creaturesDefeated);
  assert.equal(exportSnapshot.cumulativeTelemetry.creaturesExited, exportSnapshot.waveTelemetry.creaturesExited);

  const expectedP1SpendUpgrades = getTowerUpgradeCost("damage", 1);
  const baselineP1Awarded = getTowerUpgradeCost("damage", 1);
  const baselineP2Awarded = 0;

  const p1 = exportSnapshot.players.find((player) => player.playerId === "p1");
  const p2 = exportSnapshot.players.find((player) => player.playerId === "p2");
  assert.ok(p1);
  assert.ok(p2);

  assert.equal(p1.awardedPointsTotal, baselineP1Awarded + p1.awardedPointsThisWave);
  assert.equal(p1.spentOnUpgradesThisWave, expectedP1SpendUpgrades);
  assert.equal(p1.netPointsDeltaThisWave, p1.awardedPointsThisWave - expectedP1SpendUpgrades);
  assert.equal(p1.netPointsTotal, p1.awardedPointsTotal - p1.spentOnUpgradesTotal);
  assert.equal(p1.endingPoints, (snapshot.players.find((player) => player.id === "p1")?.points ?? -1));

  assert.equal(p2.awardedPointsTotal, baselineP2Awarded + p2.awardedPointsThisWave);
  assert.equal(p2.spentOnUpgradesThisWave, 0);
  assert.equal(p2.netPointsDeltaThisWave, p2.awardedPointsThisWave);
  assert.equal(p2.netPointsTotal, p2.awardedPointsTotal - p2.spentOnUpgradesTotal);
  assert.equal(p2.endingPoints, (snapshot.players.find((player) => player.id === "p2")?.points ?? -1));

  assert.equal(
    exportSnapshot.totals.endingPoints,
    exportSnapshot.players.reduce((total, player) => total + player.endingPoints, 0)
  );
  assert.equal(
    exportSnapshot.totals.netPointsDeltaThisWave,
    exportSnapshot.players.reduce((total, player) => total + player.netPointsDeltaThisWave, 0)
  );
  assert.equal(
    exportSnapshot.totals.awardedPointsTotal,
    exportSnapshot.players.reduce((total, player) => total + player.awardedPointsTotal, 0)
  );
  assert.equal(
    exportSnapshot.totals.spentOnUpgradesTotal,
    exportSnapshot.players.reduce((total, player) => total + player.spentOnUpgradesTotal, 0)
  );

  const exportEvent = snapshot.events.find(
    (event): event is Extract<MatchEvent, { type: "balance-analysis-export" }> =>
      event.type === "balance-analysis-export" && event.wave === 1
  );
  assert.ok(exportEvent);
  assert.deepEqual(exportEvent.snapshot, exportSnapshot);
});

test("balance-analysis export snapshots are deterministic across equivalent runs", () => {
  const runScenario = () => {
    const simulation = createMatch({
      players: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" }
      ],
      seed: 53
    });

    const [firstTower, secondTower] = getBuildableCoordinates(53, 2);
    assert.ok(firstTower);
    assert.ok(secondTower);

    simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstTower.x, y: firstTower.y });
    simulation.applyCommand({ type: "place-tower", playerId: "p2", x: secondTower.x, y: secondTower.y });

    simulation.awardPoints("p2", getTowerUpgradeCost("damage", 1));

    simulation.applyCommand({ type: "upgrade-tower", playerId: "p2", towerId: "tower-p2", track: "damage" });
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" });

    tickUntil(
      simulation,
      () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2,
      600
    );

    const snapshot = simulation.getSnapshot();
    return {
      exports: snapshot.balanceAnalysisExports,
      exportEvents: snapshot.events.filter(
        (event): event is Extract<MatchEvent, { type: "balance-analysis-export" }> =>
          event.type === "balance-analysis-export"
      )
    };
  };

  const firstRun = runScenario();
  const secondRun = runScenario();
  assert.deepEqual(firstRun, secondRun);
});

test("awards wave-clear bonus to every surviving player after a full clear", () => {
  const seed = 85;
  const towerCells = getBuildableCoordinates(seed, 3);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
      { id: "p3", name: "Gamma" }
    ],
    seed
  });

  towerCells.forEach((cell, index) => {
    assert.equal(
      simulation.applyCommand({
        type: "place-tower",
        playerId: `p${index + 1}`,
        x: cell.x,
        y: cell.y
      }).accepted,
      true
    );
  });

  for (let index = 1; index <= 3; index += 1) {
    assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId: `p${index}` }).accepted, true);
  }

  tickUntil(
    simulation,
    () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2,
    300
  );

  const snapshot = simulation.getSnapshot();
  const waveOneTelemetry = snapshot.telemetry.completedWaves[0];
  assert.ok(waveOneTelemetry);
  assert.equal(waveOneTelemetry.creaturesSpawned, waveOneTelemetry.creaturesDefeated);
  assert.equal(waveOneTelemetry.creaturesExited, 0);

  const bonusEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "wave-clear-bonus" }> =>
      event.type === "wave-clear-bonus" && event.wave === 1
  );
  assert.equal(bonusEvents.length, 3);
  for (const event of bonusEvents) {
    assert.equal(event.cleared, true);
    assert.equal(event.bonus, getWaveClearBonus());
  }

  for (const playerId of ["p1", "p2", "p3"]) {
    const player = snapshot.players.find((entry) => entry.id === playerId);
    assert.ok(player);
    assert.ok(player.points >= getWaveClearBonus(), "expected clear bonus points in player total");
  }

  assert.equal(waveOneTelemetry.waveClearBonusAwarded, getWaveClearBonus() * 3);
});

test("does not award wave-clear bonus when creatures leak", () => {
  const simulation = createSinglePlayerWaveSimulation(36);
  // Towers now kill every creature long before it crosses the map, so force a leak by cutting the lane short.
  const internals = simulation as unknown as { currentWavePath: Array<{ x: number; y: number }> };
  internals.currentWavePath.length = 1;
  tickUntil(
    simulation,
    () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2,
    300
  );

  const snapshot = simulation.getSnapshot();
  const waveOneTelemetry = snapshot.telemetry.completedWaves[0];
  assert.ok(waveOneTelemetry);
  assert.ok(waveOneTelemetry.creaturesExited > 0);

  const bonusEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "wave-clear-bonus" }> =>
      event.type === "wave-clear-bonus" && event.wave === 1
  );
  assert.equal(bonusEvents.length, 0);
  assert.equal(waveOneTelemetry.waveClearBonusAwarded, 0);
});

test("records wave-clear bonus in telemetry and balance-analysis exports", () => {
  const seed = 85;
  const towerCells = getBuildableCoordinates(seed, 3);
  const simulation = createMatch({
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
      { id: "p3", name: "Gamma" }
    ],
    seed
  });

  towerCells.forEach((cell, index) => {
    simulation.applyCommand({
      type: "place-tower",
      playerId: `p${index + 1}`,
      x: cell.x,
      y: cell.y
    });
  });

  for (let index = 1; index <= 3; index += 1) {
    simulation.applyCommand({ type: "ready-for-wave", playerId: `p${index}` });
  }

  tickUntil(
    simulation,
    () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2,
    300
  );

  const snapshot = simulation.getSnapshot();
  const exportSnapshot = snapshot.balanceAnalysisExports[0];
  assert.ok(exportSnapshot);
  const expectedTotalBonus = getWaveClearBonus() * 3;

  assert.equal(exportSnapshot.waveTelemetry.waveClearBonusAwarded, expectedTotalBonus);
  assert.equal(exportSnapshot.cumulativeTelemetry.waveClearBonusAwarded, expectedTotalBonus);
  assert.equal(exportSnapshot.totals.waveClearBonusThisWave, expectedTotalBonus);
  assert.equal(exportSnapshot.totals.waveClearBonusTotal, expectedTotalBonus);

  for (const player of exportSnapshot.players) {
    assert.equal(player.waveClearBonusThisWave, getWaveClearBonus());
    assert.equal(player.waveClearBonusTotal, getWaveClearBonus());
    assert.ok(player.awardedPointsThisWave >= getWaveClearBonus());
  }
});

const LANE_SEEDS = [1, 19, 42, 777, 2024, 31337, 99999];

test("generated maps always contain a connected buildable lane from the left to the right edge", () => {
  for (const seed of LANE_SEEDS) {
    const map = generateMap(seed);
    const open = new Set(map.cells.filter((cell) => cell.buildable).map((cell) => `${cell.x},${cell.y}`));
    const queue: string[] = [];
    const seen = new Set<string>();
    for (let y = 0; y < map.height; y += 1) {
      if (open.has(`0,${y}`)) {
        queue.push(`0,${y}`);
        seen.add(`0,${y}`);
      }
    }
    let reachedRightEdge = false;
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y] = (queue[index] as string).split(",").map(Number) as [number, number];
      reachedRightEdge ||= x === map.width - 1;
      for (const key of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
        if (open.has(key) && !seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
      }
    }
    assert.ok(reachedRightEdge, `seed ${seed}: no connected lane to the right edge`);
  }
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

type TargetMode = "first" | "last" | "strongest" | "nearest";

// Creatures cannot be targeted for their first SPAWN_PROTECTION_TICKS ticks, so the first creature is
// shootable on the tick after the protected ones. Wave ticks start at 1 and creature 1 spawns on tick 1.
function advanceToFirstTargetableTick(simulation: ReturnType<typeof createMatch>): void {
  for (let tick = 0; tick <= SPAWN_PROTECTION_TICKS; tick += 1) {
    simulation.applyCommand({ type: "advance-wave" });
  }
}

// Finds a tower cell whose distance to the first spawned creature lies in (minExclusive, maxInclusive].
function findTowerCellAtDistance(
  seed: number,
  minExclusive: number,
  maxInclusive: number
): { x: number; y: number } {
  const cell = tryFindTowerCellAtDistance(seed, minExclusive, maxInclusive);
  assert.ok(cell, "no suitable tower cell found");
  return cell;
}

function tryFindTowerCellAtDistance(
  seed: number,
  minExclusive: number,
  maxInclusive: number
): { x: number; y: number } | null {
  const probeMap = generateMap(seed);
  for (const cell of probeMap.cells.filter((entry) => entry.buildable)) {
    const probe = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
    if (!probe.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted) {
      continue;
    }
    probe.applyCommand({ type: "ready-for-wave", playerId: "p1" });
    advanceToFirstTargetableTick(probe);
    const creature = probe.getSnapshot().creatures.find((entry) => entry.id === "wave-1-creature-1");
    if (!creature) {
      continue;
    }
    const distance = Math.hypot(cell.x - creature.x, cell.y - creature.y);
    if (distance > minExclusive && distance <= maxInclusive) {
      return { x: cell.x, y: cell.y };
    }
  }
  return null;
}

function firstTickTarget(
  seed: number,
  cell: { x: number; y: number },
  mode: TargetMode,
  upgrades: number
): string | null {
  const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y });
  for (let level = 1; level <= upgrades; level += 1) {
    simulation.awardPoints("p1", getTowerUpgradeCost("range", level));
    assert.equal(
      simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "range" }).accepted,
      true
    );
  }
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode });
  advanceToFirstTargetableTick(simulation);
  return simulation.getSnapshot().targetAssignments[0]?.targetCreatureId ?? null;
}

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
  for (let seed = 40; seed < 80 && !found; seed += 1) {
    const cell = tryFindTowerCellAtDistance(seed, range - 1e-9, range);
    found = cell ? { seed, cell } : null;
  }
  assert.ok(found, "expected an exact-range cell on some seed");
  assert.equal(firstTickTarget(found.seed, found.cell, "first", 0), "wave-1-creature-1");
});

test("creature just beyond range is not targetable", () => {
  const seed = 40;
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
  const probeCells = [...getBuildableCellsNearSpawn(seed)].reverse();
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
  const cell = getBuildableCellsNearSpawn(seed).find(
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

type WaveEndInternals = {
  endWave: () => void;
  isWaveComplete: () => boolean;
  state: { players: Array<{ points: number }> };
};

// Runs wave 1 until every creature is gone but defers the teardown, so a test can set up scores first.
function runWaveOneUntilTeardownPending(simulation: ReturnType<typeof createMatch>): WaveEndInternals {
  const internals = simulation as unknown as WaveEndInternals;
  const realEndWave = internals.endWave.bind(simulation);
  internals.endWave = () => undefined;
  for (let step = 0; step < 300 && !internals.isWaveComplete(); step += 1) {
    assert.equal(simulation.applyCommand({ type: "advance-wave" }).accepted, true);
  }
  assert.equal(internals.isWaveComplete(), true);
  internals.endWave = realEndWave;
  return internals;
}

test("score-win during wave-clear bonus still runs full wave teardown bookkeeping", () => {
  const simulation = createSinglePlayerWaveSimulation(24);
  const internals = runWaveOneUntilTeardownPending(simulation);
  internals.state.players[0]!.points = WIN_SCORE - getWaveClearBonus();

  internals.endWave();

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.phase, "ended");
  assert.equal(snapshot.endReason, "score-win");
  assert.equal(snapshot.winnerId, "p1");
  assert.equal(snapshot.events.filter((event) => event.type === "wave-end").length, 1);
  assert.equal(snapshot.events.filter((event) => event.type === "telemetry-snapshot").length >= 1, true);
  assert.equal(snapshot.events.filter((event) => event.type === "balance-analysis-export").length, 1);
  assert.equal(snapshot.telemetry.completedWaves.length, 1);
  assert.equal(snapshot.telemetry.completedWaves[0]?.waveClearBonusAwarded, getWaveClearBonus());
});

test("wave-clear bonus is only paid when the wave was cleared", () => {
  const cleared = createSinglePlayerWaveSimulation(24);
  const clearedInternals = runWaveOneUntilTeardownPending(cleared);
  clearedInternals.state.players[0]!.points = 0;
  clearedInternals.endWave();
  assert.equal(cleared.getSnapshot().players[0]?.points, getWaveClearBonus());

  const leaked = createSinglePlayerWaveSimulation(24);
  const leakedInternals = runWaveOneUntilTeardownPending(leaked);
  leakedInternals.state.players[0]!.points = WIN_SCORE - getWaveClearBonus();
  // A leaked creature forfeits the bonus, so the same score must not tip into a win.
  (leaked as unknown as { state: { telemetry: { currentWave: { creaturesExited: number } } } }).state.telemetry.currentWave.creaturesExited = 1;
  leakedInternals.endWave();
  const snapshot = leaked.getSnapshot();
  assert.equal(snapshot.players[0]?.points, WIN_SCORE - getWaveClearBonus());
  assert.equal(snapshot.phase, "placement");
  assert.equal(snapshot.events.some((event) => event.type === "wave-clear-bonus"), false);
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
  assert.equal(getCreatureAttackRange("runner"), 2.5);
  assert.equal(getCreatureAttackRange("swarm"), 2.5);
  assert.equal(getCreatureAttackRange("armored"), 3.5);
  assert.equal(getCreatureAttackRange("tank"), 3.5);
});

test("a creature out of range deals no damage even though its stale target is the tower", () => {
  const { tick, cell } = findRangeScenario(RANGE_TEST_SEED, "wave-1-creature-1", 2.5, 6);
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
  const armored = findRangeScenario(RANGE_TEST_SEED, "wave-1-creature-3", 2.5, 3.5);
  const armoredSim = createMatchWithTowerAt(RANGE_TEST_SEED, armored.cell);
  runToTick(armoredSim, armored.tick);
  const armoredAttacks = eventsOnTick(armoredSim, "creature-attack", armored.tick, "wave-1-creature-3");
  assert.equal(armoredAttacks.length, 1);
  assert.equal(armoredAttacks[0]?.damage, 2);

  // A tower this close to the lane shoots a runner dead long before it reaches the diagonal, so the runner is kept
  // out of the tower's sights (spawn protection that never ends). Protected creatures still move and attack.
  const runner = findCellJustOutOfRunnerReach(RANGE_TEST_SEED);
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
  assert.ok(runnerDistance > 2.5 && runnerDistance <= 3.5, `runner is just out of reach (${runnerDistance})`);
  assert.equal(eventsOnTick(runnerSim, "creature-attack", runner.tick, "wave-1-creature-1").length, 0);
});

// The lane does not depend on a tower that stays off it, so a probe run tells where the runner walks.
function findCellJustOutOfRunnerReach(seed: number): { tick: number; cell: { x: number; y: number } } {
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
        && distance > 2.5
        && distance <= 3.5
        && createMatch({ players: [{ id: "p1", name: "Alpha" }], seed })
          .applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted
      ) {
        return { tick, cell: { x: cell.x, y: cell.y } };
      }
    }
  }
  assert.fail("no cell 2.5 to 3.5 cells from the runner's lane");
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
  const { tick, cell } = findRangeScenario(RANGE_TEST_SEED, "wave-1-creature-1", 1.5, 2.5);
  const simulation = createMatchWithTowerAt(RANGE_TEST_SEED, cell);
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
    seed: RANGE_TEST_SEED
  });
  const cells = getTowerCellsBesideLane(RANGE_TEST_SEED, 3);
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
  // Tank at (10,10): tower-p2 at distance 1 (x3 = 9), tower-p1 at sqrt(5) = 2.24 (x2 = 6), tower-p3 at 4 (out of reach).
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
      { creatureId: "c1", targetTowerId: "tower-p1", damage: 6 },
      { creatureId: "c1", targetTowerId: "tower-p2", damage: 9 }
    ]
  );
  const health = (id: string): number | undefined => internals.state.towers.find((entry) => entry.id === id)?.health;
  assert.equal(health("tower-p1"), DEFAULT_TOWER_HEALTH - 6);
  assert.equal(health("tower-p2"), DEFAULT_TOWER_HEALTH - 9);
  assert.equal(health("tower-p3"), DEFAULT_TOWER_HEALTH);

  // The reported primary target is still the nearest tower in reach.
  const selected = newEvents.find(
    (event): event is Extract<MatchEvent, { type: "creature-targets-selected" }> => event.type === "creature-targets-selected"
  );
  assert.deepEqual(selected?.assignments, [{ creatureId: "c1", targetTowerId: "tower-p2" }]);
});

test("towers beside the lane are genuinely at risk", () => {
  // A lone level-1 tower beside the lane, no upgrades, through wave 6 (or until the match ends). The first pad beside
  // the lane sits by the cave, where creatures are still spawn-protected and the tower cannot shoot back (it falls in
  // wave 2), so this uses the next pad, a typical spot. Observed with the default bands: intake 12, 0, 0, 31,
  // 0, 18 for waves 1-6 against 50 repaired; health 88 after wave 1; the tower falls in wave 8.
  const [, cell] = getTowerCellsBesideLane(EXPOSED_TOWER_SEED, 2);
  assert.ok(cell);
  const simulation = createMatchWithTowerAt(EXPOSED_TOWER_SEED, cell);
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

function createPrepMatchWithTower(seed: number): ReturnType<typeof createMatch> {
  const cell = getBuildableCoordinate(seed);
  const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
  assert.equal(simulation.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted, true);
  return simulation;
}

test("accepts set-target-mode during the prep phase and changes the tower mode", () => {
  const simulation = createPrepMatchWithTower(15);
  assert.equal(simulation.getSnapshot().phase, "placement");

  const result = simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "nearest" });

  assert.deepEqual(result, { accepted: true });
  assert.equal(simulation.getSnapshot().towers[0]?.targetMode, "nearest");
});

test("accepts set-target-mode in prep after the player is ready, and keeps it when the wave starts", () => {
  const simulation = createPrepMatchWithTower(15);
  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "last" });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

  const afterWaveStart = simulation.getSnapshot();
  assert.equal(afterWaveStart.phase, "wave");
  assert.equal(afterWaveStart.towers[0]?.targetMode, "last");
  assert.equal(
    simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "strongest" }).accepted,
    true
  );
});

test("rejects set-target-mode with match-already-ended", () => {
  const simulation = createPrepMatchWithTower(15);
  simulation.awardPoints("p1", 1000);
  assert.equal(simulation.getSnapshot().phase, "ended");

  const result = simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "last" });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "match-already-ended");
});

test("keeps upgrades prep-only after the target-mode change", () => {
  const simulation = createPrepMatchWithTower(15);
  simulation.awardPoints("p1", 200);
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  const upgrade = simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "damage" });
  assert.equal(upgrade.reason, "upgrade-phase-not-active");
});

test("upgrades up to MAX_TOWER_LEVEL, then rejects with tower-max-level and charges nothing", () => {
  const simulation = createPrepMatchWithTower(15);
  // 80 + 128 + 204 + 327: the full cost of going from level 1 to the cap.
  let total = 0;
  for (let level = 1; level < MAX_TOWER_LEVEL; level += 1) {
    total += getTowerUpgradeCost("damage", level);
  }
  simulation.awardPoints("p1", total);

  for (let level = 1; level < MAX_TOWER_LEVEL; level += 1) {
    assert.equal(
      simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "damage" }).accepted,
      true,
      `upgrade from level ${level} should be accepted`
    );
  }
  assert.equal(simulation.getSnapshot().towers[0]?.level, MAX_TOWER_LEVEL);
  assert.equal(simulation.getSnapshot().players[0]?.points, STARTING_POINTS);

  simulation.awardPoints("p1", 500);
  const pointsBefore = simulation.getSnapshot().players[0]?.points;
  const rejected = simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "damage" });

  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "tower-max-level");
  assert.equal(simulation.getSnapshot().towers[0]?.level, MAX_TOWER_LEVEL);
  assert.equal(simulation.getSnapshot().players[0]?.points, pointsBefore);
});

test("each upgrade track is bought and priced on its own and leaves the others alone", () => {
  const simulation = createPrepMatchWithTower(15);
  simulation.awardPoints("p1", 400);

  for (const track of ["range", "damage", "accuracy"] as const) {
    const before = simulation.getSnapshot().players[0]?.points ?? 0;
    const result = simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track });
    assert.equal(result.accepted, true, track);
    assert.equal(simulation.getSnapshot().players[0]?.points, before - getTowerUpgradeCost(track, 1), track);
  }

  const tower = simulation.getSnapshot().towers[0];
  assert.deepEqual(tower?.upgrades, { range: 2, damage: 2, accuracy: 2 });
  assert.equal(tower?.level, 4);

  simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "accuracy" });
  assert.deepEqual(simulation.getSnapshot().towers[0]?.upgrades, { range: 2, damage: 2, accuracy: 3 });
});

test("a track at max level is rejected while the other tracks can still be upgraded", () => {
  const simulation = createPrepMatchWithTower(15);
  let total = 0;
  for (let level = 1; level < MAX_TOWER_LEVEL; level += 1) {
    total += getTowerUpgradeCost("accuracy", level);
  }
  simulation.awardPoints("p1", total + 500);
  for (let level = 1; level < MAX_TOWER_LEVEL; level += 1) {
    assert.equal(
      simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "accuracy" }).accepted,
      true
    );
  }

  const pointsBefore = simulation.getSnapshot().players[0]?.points;
  const rejected = simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "accuracy" });
  assert.deepEqual(rejected, { accepted: false, reason: "tower-max-level" });
  assert.equal(simulation.getSnapshot().players[0]?.points, pointsBefore);

  assert.equal(
    simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "range" }).accepted,
    true
  );
});

test("an unknown upgrade track is rejected and costs nothing", () => {
  const simulation = createPrepMatchWithTower(15);
  simulation.awardPoints("p1", 200);
  const result = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p1",
    towerId: "tower-p1",
    track: "speed" as unknown as "range"
  });
  assert.deepEqual(result, { accepted: false, reason: "invalid-upgrade-track" });
  assert.equal(simulation.getSnapshot().players[0]?.points, STARTING_POINTS + 200);
});

test("range upgrades extend reach and damage upgrades raise damage per shot, independently", () => {
  const seed = 40;
  const outOfRange = findTowerCellAtDistance(seed, getTowerRange(1), getTowerRange(2));
  assert.equal(firstTickTarget(seed, outOfRange, "first", 0), null);
  assert.ok(firstTickTarget(seed, outOfRange, "first", 1));

  const simulation = createPrepMatchWithTower(31);
  // The first target is a runner; explosive is neutral against it, so damage level 3 shows as exactly 3.
  simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType: "explosive" });
  simulation.awardPoints("p1", getTowerUpgradeCost("damage", 1) + getTowerUpgradeCost("damage", 2));
  simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "damage" });
  simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "damage" });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  tickUntil(simulation, () => simulation.getSnapshot().events.some((event) => event.type === "tower-hit"), 60);
  const hit = simulation.getSnapshot().events.find((event) => event.type === "tower-hit");
  assert.equal(hit?.type === "tower-hit" ? hit.damage : 0, 3);
});

test("shots can miss at base accuracy, deterministically, and never at max accuracy", () => {
  const run = (accuracyLevel: number): { hits: number; misses: number; firstMiss: string } => {
    const simulation = createPrepMatchWithTower(31);
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
  const simulation = createPrepMatchWithTower(31);
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  tickUntil(simulation, () => simulation.getSnapshot().events.some((event) => event.type === "tower-miss"), 400);
  const events = simulation.getSnapshot().events;
  const miss = events.find((event) => event.type === "tower-miss");
  assert.ok(miss && miss.type === "tower-miss");
  assert.equal(typeof miss.x, "number");
  assert.equal(events.some((event) => event.type === "tower-hit" && event.tick === miss.tick && event.towerId === miss.towerId), false);
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

// The move unlocks after 5 completed rounds; tests jump straight to the prep of wave 6 instead of playing 5 waves.
function jumpToWave(simulation: ReturnType<typeof createMatch>, wave: number): void {
  (simulation as unknown as { state: { wave: number } }).state.wave = wave;
}

function freeCellAwayFrom(seed: number, taken: { x: number; y: number }): { x: number; y: number } {
  const cell = getPlaceableCellsNearSpawn(seed, 3).find((entry) => entry.x !== taken.x || entry.y !== taken.y);
  assert.ok(cell);
  return cell;
}

test("moving a tower is locked until 5 rounds are done, and a rejected move keeps the token", () => {
  const simulation = createPrepMatchWithTower(31);
  const tower = simulation.getSnapshot().towers[0];
  assert.ok(tower);
  const target = freeCellAwayFrom(31, tower);

  assert.equal(simulation.getSnapshot().players[0]?.towerMoveAvailable, false);
  for (const wave of [1, 5]) {
    jumpToWave(simulation, wave);
    const result = simulation.applyCommand({ type: "move-tower", playerId: "p1", towerId: "tower-p1", x: target.x, y: target.y });
    assert.deepEqual(result, { accepted: false, reason: "tower-move-locked" }, `wave ${wave}`);
  }

  jumpToWave(simulation, 6);
  assert.equal(simulation.getSnapshot().players[0]?.towerMoveAvailable, true);
  const bad = simulation.applyCommand({ type: "move-tower", playerId: "p1", towerId: "tower-p1", x: tower.x, y: tower.y });
  assert.deepEqual(bad, { accepted: false, reason: "tower-overlap" });
  assert.equal(simulation.getSnapshot().players[0]?.towerMoveAvailable, true);
});

test("the free move relocates the tower, keeps its progress, emits an event and is used up", () => {
  const simulation = createPrepMatchWithTower(31);
  simulation.awardPoints("p1", 200);
  simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "range" });
  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "strongest" });
  const before = simulation.getSnapshot().towers[0];
  assert.ok(before);
  const target = freeCellAwayFrom(31, before);

  jumpToWave(simulation, 6);
  const result = simulation.applyCommand({ type: "move-tower", playerId: "p1", towerId: "tower-p1", x: target.x, y: target.y });
  assert.deepEqual(result, { accepted: true });

  const after = simulation.getSnapshot();
  const moved = after.towers[0];
  assert.deepEqual({ x: moved?.x, y: moved?.y }, target);
  assert.deepEqual(moved?.upgrades, before.upgrades);
  assert.equal(moved?.level, before.level);
  assert.equal(moved?.targetMode, "strongest");
  assert.equal(moved?.health, before.health);
  assert.deepEqual(after.players[0]?.tower, { playerId: "p1", x: target.x, y: target.y });
  assert.equal(after.players[0]?.towerMoveAvailable, false);
  assert.ok(after.events.some((event) => event.type === "tower-moved" && event.fromX === before.x && event.x === target.x && event.towerId === "tower-p1"));

  const second = simulation.applyCommand({ type: "move-tower", playerId: "p1", towerId: "tower-p1", x: before.x, y: before.y });
  assert.deepEqual(second, { accepted: false, reason: "tower-move-used" });
});

test("a move follows the placement rules and needs prep, before ready, and the player's own tower", () => {
  const [firstCell, secondCell] = getBuildableCoordinates(10, 2);
  assert.ok(firstCell && secondCell);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }],
    seed: 10
  });
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstCell.x, y: firstCell.y });
  simulation.applyCommand({ type: "place-tower", playerId: "p2", x: secondCell.x, y: secondCell.y });
  jumpToWave(simulation, 6);
  const move = (x: number, y: number, playerId = "p1", towerId = "tower-p1") =>
    simulation.applyCommand({ type: "move-tower", playerId, towerId, x, y });

  assert.equal(move(-1, 0).reason, "out-of-bounds");
  assert.equal(move(getNonBuildableCoordinate(10).x, getNonBuildableCoordinate(10).y).reason, "cell-not-buildable");
  const map = simulation.getSnapshot().map;
  const protectedCell = map.cells.find((cell) => cell.buildable && isInSpawnProtection(map, cell.x, cell.y));
  assert.ok(protectedCell, "expected a buildable cell inside the cave's protected area");
  assert.equal(move(protectedCell.x, protectedCell.y).reason, "spawn-protected");
  assert.equal(move(secondCell.x, secondCell.y).reason, "tower-overlap");
  assert.equal(move(5, 5, "p1", "tower-p2").reason, "invalid-move-target");
  assert.equal(move(5, 5, "p1", "tower-missing").reason, "invalid-move-target");

  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  assert.equal(move(firstCell.x, firstCell.y + 1).reason, "player-already-ready-for-wave");
  // The flag means "usable right now", so it drops once the player is ready.
  assert.equal(simulation.getSnapshot().players[0]?.towerMoveAvailable, false);
  assert.equal(simulation.getSnapshot().players[1]?.towerMoveAvailable, true);
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" });
  assert.equal(simulation.getSnapshot().phase, "wave");
  assert.equal(move(firstCell.x, firstCell.y + 1).reason, "move-phase-not-active");
});

// Damage types (#16)

function archetypeOfCreature(events: MatchEvent[], creatureId: string): CreatureArchetype {
  const spawned = events.find((event) => event.type === "creature-spawned" && event.creatureId === creatureId);
  assert.ok(spawned && spawned.type === "creature-spawned");
  return spawned.archetype;
}

function runWaveWithDamageType(damageType: DamageType, damageLevel = 1): ReturnType<typeof createMatch> {
  const simulation = createPrepMatchWithTower(31);
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType }),
    { accepted: true }
  );
  const tower = (simulation as unknown as { state: { towers: Tower[] } }).state.towers[0];
  assert.ok(tower);
  tower.upgrades.damage = damageLevel;
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  tickUntil(simulation, () => simulation.getSnapshot().phase !== "wave", 400);
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

test("set-damage-type is accepted in prep before ready, and the type persists into the wave", () => {
  const simulation = createPrepMatchWithTower(15);
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType: "explosive" }),
    { accepted: true }
  );
  assert.equal(simulation.getSnapshot().towers[0]?.damageType, "explosive");
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  assert.equal(simulation.getSnapshot().towers[0]?.damageType, "explosive");
});

test("set-damage-type is rejected during the wave and for bad input, each with its own reason", () => {
  const simulation = createPrepMatchWithTower(15);
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p9", towerId: "tower-p1", damageType: "magic" }),
    { accepted: false, reason: "unknown-player" }
  );
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "nope", damageType: "magic" }),
    { accepted: false, reason: "invalid-damage-type-target" }
  );
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType: "fire" as unknown as DamageType }),
    { accepted: false, reason: "invalid-damage-type" }
  );
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  assert.equal(simulation.getSnapshot().phase, "wave");
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType: "magic" }),
    { accepted: false, reason: "damage-type-phase-not-active" }
  );
  assert.equal(simulation.getSnapshot().towers[0]?.damageType, "physical");
});

test("set-damage-type is rejected once the player is ready while others still prepare, and for another player's tower", () => {
  const seed = 31;
  const [a, b] = getBuildableCoordinates(seed, 2);
  assert.ok(a && b);
  const simulation = createMatch({ players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }], seed });
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: a.x, y: a.y });
  simulation.applyCommand({ type: "place-tower", playerId: "p2", x: b.x, y: b.y });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  assert.equal(simulation.getSnapshot().phase, "placement");
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType: "magic" }),
    { accepted: false, reason: "player-already-ready-for-wave" }
  );
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p2", towerId: "tower-p1", damageType: "magic" }),
    { accepted: false, reason: "invalid-damage-type-target" }
  );
  assert.deepEqual(
    simulation.applyCommand({ type: "set-damage-type", playerId: "p2", towerId: "tower-p2", damageType: "magic" }),
    { accepted: true }
  );
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

test("move-tower and set-damage-type reject eliminated players", () => {
  const eliminated = createPrepMatchWithTower(31);
  jumpToWave(eliminated, 6);
  (eliminated as unknown as { state: { players: Array<{ eliminated: boolean }> } }).state.players[0]!.eliminated = true;
  assert.equal(
    eliminated.applyCommand({ type: "move-tower", playerId: "p1", towerId: "tower-p1", x: 5, y: 5 }).reason,
    "player-eliminated"
  );
  assert.equal(
    eliminated.applyCommand({ type: "set-damage-type", playerId: "p1", towerId: "tower-p1", damageType: "magic" }).reason,
    "player-eliminated"
  );
});
