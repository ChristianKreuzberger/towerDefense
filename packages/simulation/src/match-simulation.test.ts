import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  MAX_PLAYERS,
  WIN_SCORE,
  getTowerUpgradeCost,
  getWallCost,
  isValidTowerPlacement,
  isValidWallPlacement,
  type GameMap,
  type Tower,
  type Wall
} from "@tower-defense/shared";
import { generateMap } from "./procedural-map.js";

function getBuildableCoordinate(seed: number): { x: number; y: number } {
  const map = generateMap(seed);
  const cell = map.cells.find((entry) => entry.buildable);
  assert.ok(cell, "expected at least one buildable cell");
  return { x: cell.x, y: cell.y };
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
  const map = generateMap(seed);
  const cell = map.cells.find((entry) => entry.buildable && (entry.x !== first.x || entry.y !== first.y));
  assert.ok(cell, "expected at least one additional buildable cell");
  return { x: cell.x, y: cell.y };
}

function createSinglePlayerWaveSimulation(seed: number): ReturnType<typeof createMatch> {
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

  const ready = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  assert.equal(ready.accepted, true);

  return simulation;
}

test("generates deterministic maps for identical seeds", () => {
  const first = generateMap(42);
  const second = generateMap(42);

  assert.deepEqual(first, second);
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
    width: 3,
    height: 3,
    seed: 0,
    cells: [
      { x: 0, y: 0, buildable: true },
      { x: 1, y: 0, buildable: true },
      { x: 2, y: 0, buildable: true },
      { x: 0, y: 1, buildable: true },
      { x: 1, y: 1, buildable: true },
      { x: 2, y: 1, buildable: true },
      { x: 0, y: 2, buildable: true },
      { x: 1, y: 2, buildable: true },
      { x: 2, y: 2, buildable: true }
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
      targetMode: "first"
    },
    {
      id: "t-2",
      playerId: "p2",
      x: 1,
      y: 2,
      health: 100,
      maxHealth: 100,
      level: 1,
      targetMode: "first"
    }
  ];

  const result = isValidTowerPlacement({ playerId: "p3", x: 1, y: 1 }, existingTowers, map);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "path-blocked");
});

test("allows placements when an alternate path remains", () => {
  const map: GameMap = {
    width: 3,
    height: 3,
    seed: 0,
    cells: [
      { x: 0, y: 0, buildable: true },
      { x: 1, y: 0, buildable: true },
      { x: 2, y: 0, buildable: true },
      { x: 0, y: 1, buildable: true },
      { x: 1, y: 1, buildable: true },
      { x: 2, y: 1, buildable: true },
      { x: 0, y: 2, buildable: true },
      { x: 1, y: 2, buildable: true },
      { x: 2, y: 2, buildable: true }
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
      targetMode: "first"
    }
  ];

  const result = isValidTowerPlacement({ playerId: "p2", x: 1, y: 1 }, existingTowers, map);
  assert.equal(result.valid, true);
});

test("rejects wall placements that block all paths to a live tower", () => {
  const map: GameMap = {
    width: 3,
    height: 3,
    seed: 0,
    cells: [
      { x: 0, y: 0, buildable: true },
      { x: 1, y: 0, buildable: true },
      { x: 2, y: 0, buildable: true },
      { x: 0, y: 1, buildable: true },
      { x: 1, y: 1, buildable: true },
      { x: 2, y: 1, buildable: true },
      { x: 0, y: 2, buildable: true },
      { x: 1, y: 2, buildable: true },
      { x: 2, y: 2, buildable: true }
    ]
  };

  const towers: Tower[] = [
    {
      id: "t-1",
      playerId: "p1",
      x: 1,
      y: 1,
      health: 100,
      maxHealth: 100,
      level: 1,
      targetMode: "first"
    }
  ];

  const walls: Wall[] = [
    { id: "w-1", playerId: "p1", x: 0, y: 1 },
    { id: "w-2", playerId: "p1", x: 1, y: 0 },
    { id: "w-3", playerId: "p1", x: 2, y: 1 }
  ];

  const result = isValidWallPlacement({ playerId: "p1", x: 1, y: 2 }, walls, towers, map);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "path-blocked");
});

test("rejects wall placement during tower placement phase", () => {
  const buildable = getBuildableCoordinate(7);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 7
  });

  const result = simulation.applyCommand({
    type: "place-wall",
    playerId: "p1",
    x: buildable.x,
    y: buildable.y
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "wall-phase-not-active");
});

test("places wall in wave phase and deducts wall cost", () => {
  const towerCoordinate = getBuildableCoordinate(8);
  const wallCoordinate = getSecondBuildableCoordinate(8, towerCoordinate);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 8
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

  const awardedPoints = 40;
  simulation.awardPoints("p1", awardedPoints);

  const placeWall = simulation.applyCommand({
    type: "place-wall",
    playerId: "p1",
    x: wallCoordinate.x,
    y: wallCoordinate.y
  });
  assert.equal(placeWall.accepted, true);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.walls.length, 1);
  assert.equal(snapshot.players[0]?.points, awardedPoints - getWallCost(0));
});

test("rejects wall placement when player has insufficient points", () => {
  const towerCoordinate = getBuildableCoordinate(9);
  const wallCoordinate = getSecondBuildableCoordinate(9, towerCoordinate);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 9
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

  const placeWall = simulation.applyCommand({
    type: "place-wall",
    playerId: "p1",
    x: wallCoordinate.x,
    y: wallCoordinate.y
  });
  assert.equal(placeWall.accepted, false);
  assert.equal(placeWall.reason, "insufficient-points");
});

test("upgrades tower in wave phase and deducts deterministic cost", () => {
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

  const ready = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  assert.equal(ready.accepted, true);

  const startingUpgradeCost = getTowerUpgradeCost(1);
  simulation.awardPoints("p1", startingUpgradeCost);

  const upgrade = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p1",
    towerId: "tower-p1"
  });
  assert.equal(upgrade.accepted, true);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.towers[0]?.level, 2);
  assert.equal(snapshot.players[0]?.points, 0);
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

  const ready = simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  assert.equal(ready.accepted, true);

  const upgrade = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p1",
    towerId: "tower-p1"
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
  simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p1"
  });
  simulation.applyCommand({
    type: "ready-for-wave",
    playerId: "p2"
  });

  simulation.awardPoints("p2", getTowerUpgradeCost(1));
  const invalidOwnership = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p2",
    towerId: "tower-p1"
  });
  assert.equal(invalidOwnership.accepted, false);
  assert.equal(invalidOwnership.reason, "invalid-upgrade-target");

  const unknownTower = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p2",
    towerId: "tower-missing"
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
  const map = generateMap(1);
  const buildableCells = map.cells.filter((cell) => cell.buildable);
  assert.ok(buildableCells.length >= 2, "expected at least two buildable cells for the test");
  const firstCell = buildableCells[0];
  const secondCell = buildableCells[1];
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
  const firstCreatureExitTickTwo = snapshot.events.find(
    (event) => event.type === "creature-exited" && event.creatureId === "wave-1-creature-1"
  );

  if (firstCreatureAfterTickTwo) {
    assert.equal(firstCreatureAfterTickTwo.pathIndex, 1);
  } else {
    assert.ok(firstCreatureExitTickTwo);
    assert.equal(firstCreatureExitTickTwo.tick, 2);
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
  const waveEndEvent = snapshot.events.find((event) => event.type === "wave-end");

  assert.equal(spawnEvents.length, 3);
  assert.equal(exitEvents.length, 3);
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

test("ends match when a player reaches 1000 points", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 1
  });

  simulation.awardPoints("p1", WIN_SCORE);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.phase, "ended");
  assert.equal(snapshot.winnerId, "p1");
});
