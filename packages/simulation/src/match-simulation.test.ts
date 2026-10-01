import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  DEFAULT_TOWER_HEALTH,
  DEFAULT_WALL_HEALTH,
  MOVEMENT_PROGRESS_UNITS_PER_CELL,
  MAX_PLAYERS,
  WIN_SCORE,
  BASE_TOWER_RANGE,
  TOWER_RANGE_PER_LEVEL,
  type MatchEvent,
  type MatchSnapshot,
  getBetweenWaveTowerRepairAmount,
  getBetweenWaveWallRepairAmount,
  getCreatureMovementSpeedUnits,
  getTowerRange,
  getTowerUpgradeCost,
  getWallCost,
  getWaveClearBonus,
  isValidTowerPlacement,
  isValidWallPlacement,
  type GameMap,
  type Tower,
  type Wall
} from "@tower-defense/shared";
import { generateMap } from "./procedural-map.js";
import { getBuildableCellsNearSpawn } from "./spawn-order.js";

// Greedily places one tower per player so combinations that block the lane are skipped.
function getPlaceableCellsNearSpawn(seed: number, count: number): Array<{ x: number; y: number }> {
  const probe = createMatch({
    players: Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` })),
    seed
  });
  const picked: Array<{ x: number; y: number }> = [];
  for (const cell of getBuildableCellsNearSpawn(seed)) {
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

function getFirstValidWallCoordinate(
  simulation: ReturnType<typeof createMatch>,
  playerId: string
): { x: number; y: number } {
  const snapshot = simulation.getSnapshot();
  for (const cell of snapshot.map.cells) {
    if (!cell.buildable) {
      continue;
    }

    const validation = isValidWallPlacement(
      { playerId, x: cell.x, y: cell.y },
      snapshot.walls,
      snapshot.towers,
      snapshot.map
    );

    if (validation.valid) {
      return { x: cell.x, y: cell.y };
    }
  }

  assert.fail("expected at least one valid wall placement");
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

test("rejects walls that remove the last left-to-right route even when towers stay reachable", () => {
  const map: GameMap = {
    width: 3,
    height: 2,
    seed: 0,
    cells: [
      { x: 0, y: 0, buildable: true, pathWear: 0 },
      { x: 1, y: 0, buildable: true, pathWear: 0 },
      { x: 2, y: 0, buildable: true, pathWear: 0 },
      { x: 0, y: 1, buildable: true, pathWear: 0 },
      { x: 1, y: 1, buildable: false, pathWear: 0 },
      { x: 2, y: 1, buildable: false, pathWear: 0 }
    ]
  };
  const towers: Tower[] = [
    { id: "t-1", playerId: "p1", x: 0, y: 1, health: 100, maxHealth: 100, level: 1, targetMode: "first" }
  ];

  const result = isValidWallPlacement({ playerId: "p1", x: 1, y: 0 }, [], towers, map);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "path-blocked");
});

test("allows placements when an alternate path remains", () => {
  const map: GameMap = {
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
    { id: "w-1", playerId: "p1", x: 0, y: 1, health: DEFAULT_WALL_HEALTH, maxHealth: DEFAULT_WALL_HEALTH },
    { id: "w-2", playerId: "p1", x: 1, y: 0, health: DEFAULT_WALL_HEALTH, maxHealth: DEFAULT_WALL_HEALTH },
    { id: "w-3", playerId: "p1", x: 2, y: 1, health: DEFAULT_WALL_HEALTH, maxHealth: DEFAULT_WALL_HEALTH }
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
  assert.equal(snapshot.walls[0]?.health, DEFAULT_WALL_HEALTH);
  assert.equal(snapshot.walls[0]?.maxHealth, DEFAULT_WALL_HEALTH);
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

  const startingUpgradeCost = getTowerUpgradeCost(1);
  simulation.awardPoints("p1", startingUpgradeCost);

  const upgrade = simulation.applyCommand({
    type: "upgrade-tower",
    playerId: "p1",
    towerId: "tower-p1"
  });
  assert.equal(upgrade.accepted, true);
  assert.equal(simulation.getSnapshot().phase, "placement");

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.towers[0]?.level, 2);
  assert.equal(snapshot.players[0]?.points, 0);
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
  simulation.awardPoints("p1", getTowerUpgradeCost(1));
  simulation.awardPoints("p2", getTowerUpgradeCost(1));
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  assert.equal(simulation.getSnapshot().phase, "placement");

  const late = simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1" });
  assert.equal(late.accepted, false);
  assert.equal(late.reason, "player-already-ready-for-wave");

  // A player who has not readied yet is unaffected by the other player's ready.
  const other = simulation.applyCommand({ type: "upgrade-tower", playerId: "p2", towerId: "tower-p2" });
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
  simulation.awardPoints("p1", getTowerUpgradeCost(1));

  const upgrade = simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1" });
  assert.equal(upgrade.accepted, false);
  assert.equal(upgrade.reason, "upgrade-phase-not-active");
});

test("walls stay wave-only while upgrades are prep-only", () => {
  const towerCoordinate = getBuildableCoordinate(10);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 10
  });
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: towerCoordinate.x, y: towerCoordinate.y });
  simulation.awardPoints("p1", getWallCost(0));
  const wallCell = getFirstValidWallCoordinate(simulation, "p1");

  const wall = simulation.applyCommand({ type: "place-wall", playerId: "p1", x: wallCell.x, y: wallCell.y });
  assert.equal(wall.accepted, false);
  assert.equal(wall.reason, "wall-phase-not-active");
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

  simulation.applyCommand({ type: "advance-wave" });

  const snapshot = simulation.getSnapshot();
  const targetEvents = snapshot.events.filter((event) => event.type === "targets-selected");
  assert.equal(targetEvents.length, 1);
  assert.equal(targetEvents[0]?.tick, 1);
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
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "first" });

  for (let tick = 0; tick < 3; tick += 1) {
    simulation.applyCommand({ type: "advance-wave" });
  }

  const snapshot = simulation.getSnapshot();
  const assignmentEvent = [...snapshot.events]
    .reverse()
    .find(
      (event): event is Extract<MatchEvent, { type: "targets-selected" }> =>
        event.type === "targets-selected" && event.tick === 3
    );
  assert.ok(assignmentEvent);
  const assignment = assignmentEvent.assignments.find((entry) => entry.towerId === "tower-p1");
  assert.equal(assignment?.targetCreatureId, "wave-1-creature-2");
});

test("last mode prefers lowest pathIndex", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 27
  });

  const firstTower = getBuildableCoordinate(27);
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstTower.x, y: firstTower.y });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "last" });

  for (let tick = 0; tick < 3; tick += 1) {
    simulation.applyCommand({ type: "advance-wave" });
  }

  const snapshot = simulation.getSnapshot();
  const assignmentEvent = [...snapshot.events]
    .reverse()
    .find(
      (event): event is Extract<MatchEvent, { type: "targets-selected" }> =>
        event.type === "targets-selected" && event.tick === 3
    );
  assert.ok(assignmentEvent);
  const assignment = assignmentEvent.assignments.find((entry) => entry.towerId === "tower-p1");
  assert.equal(assignment?.targetCreatureId, "wave-1-creature-2");
});

test("strongest mode resolves hp ties deterministically", () => {
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 28
  });

  const firstTower = getBuildableCoordinate(28);
  simulation.applyCommand({ type: "place-tower", playerId: "p1", x: firstTower.x, y: firstTower.y });
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "strongest" });

  for (let tick = 0; tick < 3; tick += 1) {
    simulation.applyCommand({ type: "advance-wave" });
  }

  const snapshot = simulation.getSnapshot();
  const assignmentEvent = [...snapshot.events]
    .reverse()
    .find(
      (event): event is Extract<MatchEvent, { type: "targets-selected" }> =>
        event.type === "targets-selected" && event.tick === 3
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
  const simulation = createSinglePlayerWaveSimulation(31);

  const advance = simulation.applyCommand({ type: "advance-wave" });
  assert.equal(advance.accepted, true);

  const snapshot = simulation.getSnapshot();
  const hitEvents = snapshot.events.filter((event) => event.type === "tower-hit");
  assert.equal(hitEvents.length, 1);
  assert.equal(hitEvents[0]?.towerId, "tower-p1");
  assert.equal(hitEvents[0]?.creatureId, "wave-1-creature-1");
  assert.equal(hitEvents[0]?.damage, 1);
  assert.equal(hitEvents[0]?.remainingHp, 1);

  const creature = snapshot.creatures.find((entry) => entry.id === "wave-1-creature-1");
  assert.ok(creature);
  assert.equal(creature.hp, 1);
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

  const advance = simulation.applyCommand({ type: "advance-wave" });
  assert.equal(advance.accepted, true);

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
  assert.equal((snapshot.players[0]?.points ?? 0) + (snapshot.players[1]?.points ?? 0), 10);
});

test("resolves same-target multi-tower combat in deterministic towerId order", () => {
  const runScenario = (): {
    events: {
      hitEvents: Array<{ towerId: string; creatureId: string; remainingHp: number }>;
      defeatedEvents: Array<{ towerId: string; playerId: string; creatureId: string; rewardPoints: number }>;
    };
    players: Array<{ id: string; points: number }>;
  } => {
    const firstTower = getBuildableCoordinate(33);
    const secondTower = getSecondBuildableCoordinate(33, firstTower);
    const simulation = createMatch({
      players: [
        { id: "p2", name: "Beta" },
        { id: "p1", name: "Alpha" }
      ],
      seed: 33
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
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" });
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });

    simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "first" });
    simulation.applyCommand({ type: "set-target-mode", playerId: "p2", towerId: "tower-p2", mode: "first" });

    const firstAdvance = simulation.applyCommand({ type: "advance-wave" });
    assert.equal(firstAdvance.accepted, true);

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

  assert.equal(firstRun.events.hitEvents.length, 2);
  assert.equal(firstRun.events.hitEvents[0]?.towerId, "tower-p1");
  assert.equal(firstRun.events.hitEvents[1]?.towerId, "tower-p2");
  assert.equal(firstRun.events.defeatedEvents.length, 1);
  assert.equal(firstRun.events.defeatedEvents[0]?.towerId, "tower-p2");
  assert.equal(firstRun.events.defeatedEvents[0]?.playerId, "p2");
  assert.equal(firstRun.events.defeatedEvents[0]?.creatureId, "wave-1-creature-1");
  assert.equal(firstRun.events.defeatedEvents[0]?.rewardPoints, 10);
  assert.deepEqual(firstRun.players, [
    { id: "p2", points: 10 },
    { id: "p1", points: 0 }
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

test("creature target selection is deterministic by distance then hp then towerId", () => {
  const firstTower = getBuildableCoordinate(34);
  const secondTower = getSecondBuildableCoordinate(34, firstTower);
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

  tickUntil(
    simulation,
    () => simulation.getSnapshot().events.some((event) => event.type === "creature-targets-selected"),
    120
  );

  const snapshot = simulation.getSnapshot();
  const creatureTargetEvent = [...snapshot.events]
    .reverse()
    .find((event): event is Extract<MatchEvent, { type: "creature-targets-selected" }> => event.type === "creature-targets-selected");
  assert.ok(creatureTargetEvent);
  assert.ok(creatureTargetEvent.assignments.length > 0);

  const firstAssignment = creatureTargetEvent.assignments[0];
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
  tickUntil(
    rerun,
    () => rerun.getSnapshot().events.some((event) => event.type === "creature-targets-selected"),
    120
  );
  const rerunSnapshot = rerun.getSnapshot();
  const rerunCreatureTargetEvent = [...rerunSnapshot.events]
    .reverse()
    .find((event): event is Extract<MatchEvent, { type: "creature-targets-selected" }> => event.type === "creature-targets-selected");
  assert.ok(rerunCreatureTargetEvent);
  assert.deepEqual(creatureTargetEvent.assignments, rerunCreatureTargetEvent.assignments);
});

test("emits creature-attack event and reduces tower hp", () => {
  const simulation = createSinglePlayerWaveSimulation(35);

  const advance = simulation.applyCommand({ type: "advance-wave" });
  assert.equal(advance.accepted, true);

  const snapshot = simulation.getSnapshot();
  const attackEvents = snapshot.events.filter((event) => event.type === "creature-attack");
  assert.equal(attackEvents.length, 1);
  assert.equal(attackEvents[0]?.targetTowerId, "tower-p1");
  assert.equal(attackEvents[0]?.damage, 1);

  const tower = snapshot.towers.find((entry) => entry.id === "tower-p1");
  assert.ok(tower);
  assert.equal(tower.health, 99);
  assert.equal(attackEvents[0]?.remainingHp, tower.health);
});

test("destroys tower, marks player eliminated, and rejects further player commands", () => {
  const simulation = createSinglePlayerWaveSimulation(36);

  tickUntil(simulation, () => simulation.getSnapshot().phase === "ended", 1200);

  const snapshot = simulation.getSnapshot();
  const destroyedEvents = snapshot.events.filter((event) => event.type === "tower-destroyed");
  assert.ok(destroyedEvents.length > 0);
  assert.equal(snapshot.players[0]?.eliminated, true);

  const placeWallAfterElimination = simulation.applyCommand({
    type: "place-wall",
    playerId: "p1",
    x: 0,
    y: 0
  });
  assert.equal(placeWallAfterElimination.accepted, false);
  assert.equal(placeWallAfterElimination.reason, "match-already-ended");
});

test("ends match with fail-state when all towers are destroyed", () => {
  const simulation = createSinglePlayerWaveSimulation(37);
  tickUntil(simulation, () => simulation.getSnapshot().phase === "ended", 1200);

  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.phase, "ended");
  assert.equal(snapshot.endReason, "all-towers-destroyed");
  assert.equal(snapshot.winnerId, undefined);
  assert.equal(snapshot.towers.length, 0);
  assert.equal(snapshot.players.every((player) => player.eliminated), true);
});

test("emits deterministic tower-repaired events between waves", () => {
  const simulation = createSinglePlayerWaveSimulation(41);

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
  const simulation = createSinglePlayerWaveSimulation(39);

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
  const simulation = createSinglePlayerWaveSimulation(40);

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

test("emits deterministic wall-repaired events between waves", () => {
  const towerCoordinate = getBuildableCoordinate(42);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 42
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

  const wallCoordinate = getFirstValidWallCoordinate(simulation, "p1");

  simulation.awardPoints("p1", getWallCost(0));
  assert.equal(
    simulation.applyCommand({
      type: "place-wall",
      playerId: "p1",
      x: wallCoordinate.x,
      y: wallCoordinate.y
    }).accepted,
    true
  );

  tickUntil(simulation, () => simulation.getSnapshot().phase === "placement" && simulation.getSnapshot().wave === 2, 400);

  const snapshot = simulation.getSnapshot();
  const wallHitEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "wall-hit" }> => event.type === "wall-hit"
  );
  const wallDestroyedEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "wall-destroyed" }> => event.type === "wall-destroyed"
  );
  assert.equal(wallDestroyedEvents.length, 0);

  const wallRepairEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "wall-repaired" }> => event.type === "wall-repaired"
  );
  assert.equal(wallRepairEvents.length, 1);

  const wallRepair = wallRepairEvents[0];
  assert.ok(wallRepair);
  assert.equal(wallRepair.wave, 1);
  assert.equal(wallRepair.wallId, "wall-1");
  assert.equal(wallRepair.playerId, "p1");
  const damageTaken = wallHitEvents.reduce((total, event) => total + event.damage, 0);
  const expectedRepair = Math.min(
    getBetweenWaveWallRepairAmount(DEFAULT_WALL_HEALTH),
    Math.min(DEFAULT_WALL_HEALTH, damageTaken + 1)
  );
  assert.equal(wallRepair.repairAmount, expectedRepair);
  const remainingAfterDamageAndStrain = Math.max(0, DEFAULT_WALL_HEALTH - damageTaken - 1);
  assert.equal(wallRepair.remainingHp, remainingAfterDamageAndStrain + expectedRepair);
});

test("selects deterministic wall targets and emits wall-hit events", () => {
  const towerCoordinate = getBuildableCoordinate(44);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 44
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

  simulation.awardPoints("p1", getWallCost(0));
  const firstWallCoordinate = getFirstValidWallCoordinate(simulation, "p1");
  assert.equal(
    simulation.applyCommand({
      type: "place-wall",
      playerId: "p1",
      x: firstWallCoordinate.x,
      y: firstWallCoordinate.y
    }).accepted,
    true
  );

  const firstTick = simulation.applyCommand({ type: "advance-wave" });
  assert.equal(firstTick.accepted, true);

  const snapshot = simulation.getSnapshot();
  const targetEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "creature-wall-targets-selected" }> =>
      event.type === "creature-wall-targets-selected"
  );
  assert.equal(targetEvents.length, 1);
  assert.equal(targetEvents[0]?.tick, 1);
  assert.equal(targetEvents[0]?.assignments.length, 1);
  assert.equal(targetEvents[0]?.assignments[0]?.creatureId, "wave-1-creature-1");
  assert.equal(targetEvents[0]?.assignments[0]?.targetWallId, "wall-1");

  const wallHitEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "wall-hit" }> => event.type === "wall-hit"
  );
  assert.equal(wallHitEvents.length, 1);
  assert.equal(wallHitEvents[0]?.creatureId, "wave-1-creature-1");
  assert.equal(wallHitEvents[0]?.targetWallId, "wall-1");
  assert.equal(wallHitEvents[0]?.damage, 1);
  assert.equal(wallHitEvents[0]?.remainingHp, DEFAULT_WALL_HEALTH - 1);

  const tickOneWaveEvents = snapshot.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.wave === 1 && event.tick === 1);
  const towerHitIndex = tickOneWaveEvents.find(({ event }) => event.type === "tower-hit")?.index;
  const wallHitIndex = tickOneWaveEvents.find(({ event }) => event.type === "wall-hit")?.index;
  const creatureAttackIndex = tickOneWaveEvents.find(({ event }) => event.type === "creature-attack")?.index;
  assert.ok(typeof towerHitIndex === "number");
  assert.ok(typeof wallHitIndex === "number");
  assert.ok(typeof creatureAttackIndex === "number");
  assert.ok((towerHitIndex ?? -1) < (wallHitIndex ?? -1));
  assert.ok((wallHitIndex ?? -1) < (creatureAttackIndex ?? -1));
});

test("wall destruction removes wall and emits deterministic lifecycle events", () => {
  const towerCoordinate = getBuildableCoordinate(45);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 45
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

  simulation.awardPoints("p1", getWallCost(0));
  const wallCoordinate = getFirstValidWallCoordinate(simulation, "p1");
  assert.equal(
    simulation.applyCommand({
      type: "place-wall",
      playerId: "p1",
      x: wallCoordinate.x,
      y: wallCoordinate.y
    }).accepted,
    true
  );

  tickUntil(
    simulation,
    () => simulation.getSnapshot().events.some((event) => event.type === "wall-destroyed"),
    1200
  );

  const snapshot = simulation.getSnapshot();
  const destroyedEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "wall-destroyed" }> => event.type === "wall-destroyed"
  );
  assert.equal(destroyedEvents.length, 1);
  assert.equal(destroyedEvents[0]?.wallId, "wall-1");
  assert.equal(destroyedEvents[0]?.playerId, "p1");

  const finalWall = snapshot.walls.find((wall) => wall.id === "wall-1");
  assert.equal(finalWall, undefined);

  const wallHitEvents = snapshot.events.filter(
    (event): event is Extract<MatchEvent, { type: "wall-hit" }> => event.type === "wall-hit"
  );
  assert.ok(wallHitEvents.reduce((total, event) => total + event.damage, 0) >= DEFAULT_WALL_HEALTH);
  const lastWallHit = wallHitEvents[wallHitEvents.length - 1];
  assert.ok(lastWallHit);
  assert.equal(lastWallHit.remainingHp, 0);

  const destroyIndex = snapshot.events.findIndex((event) => event.type === "wall-destroyed");
  assert.ok(destroyIndex >= 0);
  const wallHitsAfterDestroy = snapshot.events.slice(destroyIndex + 1).filter((event) => event.type === "wall-hit");
  assert.equal(wallHitsAfterDestroy.length, 0);
});

test("keeps path-related wave consistency after wall destruction", () => {
  const towerCoordinate = getBuildableCoordinate(46);
  const simulation = createMatch({
    players: [{ id: "p1", name: "Alpha" }],
    seed: 46
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

  simulation.awardPoints("p1", getWallCost(0));
  const wallCoordinate = getFirstValidWallCoordinate(simulation, "p1");
  assert.equal(
    simulation.applyCommand({
      type: "place-wall",
      playerId: "p1",
      x: wallCoordinate.x,
      y: wallCoordinate.y
    }).accepted,
    true
  );

  tickUntil(
    simulation,
    () => simulation.getSnapshot().events.some((event) => event.type === "wall-destroyed"),
    1200
  );

  const afterDestruction = simulation.getSnapshot();
  assert.equal(afterDestruction.phase, "wave");
  assert.ok(afterDestruction.creatures.length > 0);

  const ticksAtDestroy = afterDestruction.events.find((event) => event.type === "wall-destroyed")?.tick;
  assert.ok(ticksAtDestroy);

  for (let step = 0; step < 100; step += 1) {
    const snapshot = simulation.getSnapshot();
    if (snapshot.phase !== "wave") {
      break;
    }
    const advance = simulation.applyCommand({ type: "advance-wave" });
    assert.equal(advance.accepted, true);
  }

  const progressedSnapshot = simulation.getSnapshot();
  const destroyedEvents = progressedSnapshot.events.filter((event) => event.type === "wall-destroyed");
  assert.equal(destroyedEvents.length, 1);

  const progressedPastDestroyTick =
    progressedSnapshot.wave > 1 || progressedSnapshot.waveTick > (ticksAtDestroy ?? 0);
  assert.ok(progressedPastDestroyTick || progressedSnapshot.phase === "ended");

  if (progressedSnapshot.phase === "ended") {
    assert.equal(progressedSnapshot.endReason, "all-towers-destroyed");
  }
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

  const wallCoordinate = getFirstValidWallCoordinate(simulation, "p1");

  simulation.awardPoints("p1", getWallCost(0));
  assert.equal(
    simulation.applyCommand({
      type: "place-wall",
      playerId: "p1",
      x: wallCoordinate.x,
      y: wallCoordinate.y
    }).accepted,
    true
  );

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

  simulation.awardPoints("p1", getWallCost(0));
  const wallCoordinate = getFirstValidWallCoordinate(simulation, "p1");
  assert.equal(
    simulation.applyCommand({
      type: "place-wall",
      playerId: "p1",
      x: wallCoordinate.x,
      y: wallCoordinate.y
    }).accepted,
    true
  );

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
  const wallHitEvents = waveOneEvents.filter(
    (event): event is Extract<MatchEvent, { type: "wall-hit" }> => event.type === "wall-hit"
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
  const wallRepairEvents = waveOneEvents.filter(
    (event): event is Extract<MatchEvent, { type: "wall-repaired" }> => event.type === "wall-repaired"
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
  const expectedWallDamageIntake = wallHitEvents.reduce((total, event) => total + event.damage, 0);
  const expectedTowerRepairApplied = towerRepairEvents.reduce((total, event) => total + event.repairAmount, 0);
  const expectedWallRepairApplied = wallRepairEvents.reduce((total, event) => total + event.repairAmount, 0);
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
  assert.equal(waveOneTelemetry.wallDamageIntake, expectedWallDamageIntake);
  assert.equal(waveOneTelemetry.towerRepairApplied, expectedTowerRepairApplied);
  assert.equal(waveOneTelemetry.wallRepairApplied, expectedWallRepairApplied);
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

    simulation.awardPoints("p1", getWallCost(0));
    const wallCoordinate = getFirstValidWallCoordinate(simulation, "p1");
    assert.equal(
      simulation.applyCommand({
        type: "place-wall",
        playerId: "p1",
        x: wallCoordinate.x,
        y: wallCoordinate.y
      }).accepted,
      true
    );

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

  simulation.awardPoints("p1", getWallCost(0) + getTowerUpgradeCost(1));
  simulation.awardPoints("p2", getWallCost(1));

  assert.equal(
    simulation.applyCommand({
      type: "upgrade-tower",
      playerId: "p1",
      towerId: "tower-p1"
    }).accepted,
    true
  );

  assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" }).accepted, true);
  assert.equal(simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" }).accepted, true);

  const wallCellA = getFirstValidWallCoordinate(simulation, "p1");
  assert.ok(wallCellA);

  assert.equal(
    simulation.applyCommand({
      type: "place-wall",
      playerId: "p1",
      x: wallCellA.x,
      y: wallCellA.y
    }).accepted,
    true
  );
  const wallCellB = getFirstValidWallCoordinate(simulation, "p2");
  assert.ok(wallCellB);
  assert.equal(
    simulation.applyCommand({
      type: "place-wall",
      playerId: "p2",
      x: wallCellB.x,
      y: wallCellB.y
    }).accepted,
    true
  );

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

  const expectedP1SpendWalls = getWallCost(0);
  const expectedP2SpendWalls = getWallCost(1);
  const expectedP1SpendUpgrades = getTowerUpgradeCost(1);
  const baselineP1Awarded = getWallCost(0) + getTowerUpgradeCost(1);
  const baselineP2Awarded = getWallCost(1);

  const p1 = exportSnapshot.players.find((player) => player.playerId === "p1");
  const p2 = exportSnapshot.players.find((player) => player.playerId === "p2");
  assert.ok(p1);
  assert.ok(p2);

  assert.equal(p1.awardedPointsTotal, baselineP1Awarded + p1.awardedPointsThisWave);
  assert.equal(p1.spentOnWallsThisWave, expectedP1SpendWalls);
  assert.equal(p1.spentOnUpgradesThisWave, expectedP1SpendUpgrades);
  assert.equal(p1.netPointsDeltaThisWave, p1.awardedPointsThisWave - expectedP1SpendWalls - expectedP1SpendUpgrades);
  assert.equal(p1.netPointsTotal, p1.awardedPointsTotal - p1.spentOnWallsTotal - p1.spentOnUpgradesTotal);
  assert.equal(p1.endingPoints, (snapshot.players.find((player) => player.id === "p1")?.points ?? -1));

  assert.equal(p2.awardedPointsTotal, baselineP2Awarded + p2.awardedPointsThisWave);
  assert.equal(p2.spentOnWallsThisWave, expectedP2SpendWalls);
  assert.equal(p2.spentOnUpgradesThisWave, 0);
  assert.equal(p2.netPointsDeltaThisWave, p2.awardedPointsThisWave - expectedP2SpendWalls);
  assert.equal(p2.netPointsTotal, p2.awardedPointsTotal - p2.spentOnWallsTotal - p2.spentOnUpgradesTotal);
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
    exportSnapshot.totals.spentOnWallsTotal,
    exportSnapshot.players.reduce((total, player) => total + player.spentOnWallsTotal, 0)
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

    simulation.awardPoints("p1", getWallCost(0));
    simulation.awardPoints("p2", getWallCost(1) + getTowerUpgradeCost(1));

    simulation.applyCommand({ type: "upgrade-tower", playerId: "p2", towerId: "tower-p2" });
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
    simulation.applyCommand({ type: "ready-for-wave", playerId: "p2" });

    const wallCellA = getFirstValidWallCoordinate(simulation, "p1");
    const wallCellB = getFirstValidWallCoordinate(simulation, "p2");
    assert.ok(wallCellA);
    assert.ok(wallCellB);

    simulation.applyCommand({ type: "place-wall", playerId: "p1", x: wallCellA.x, y: wallCellA.y });
    simulation.applyCommand({ type: "place-wall", playerId: "p2", x: wallCellB.x, y: wallCellB.y });

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
    const map = generateMap(seed);
    const towerCell = map.cells.find((cell) => cell.buildable && cell.x === 0 && cell.y === 0) ??
      map.cells.find((cell) => cell.buildable);
    assert.ok(towerCell);
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

// Finds a tower cell whose distance to the first spawned creature lies in (minExclusive, maxInclusive].
function findTowerCellAtDistance(
  seed: number,
  minExclusive: number,
  maxInclusive: number
): { x: number; y: number } {
  const probeMap = generateMap(seed);
  for (const cell of probeMap.cells.filter((entry) => entry.buildable)) {
    const probe = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
    if (!probe.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted) {
      continue;
    }
    probe.applyCommand({ type: "ready-for-wave", playerId: "p1" });
    probe.applyCommand({ type: "advance-wave" });
    const creature = probe.getSnapshot().creatures[0];
    if (!creature) {
      continue;
    }
    const distance = Math.hypot(cell.x - creature.x, cell.y - creature.y);
    if (distance > minExclusive && distance <= maxInclusive) {
      return { x: cell.x, y: cell.y };
    }
  }
  assert.fail("no suitable tower cell found");
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
    simulation.awardPoints("p1", getTowerUpgradeCost(level));
    assert.equal(
      simulation.applyCommand({ type: "upgrade-tower", playerId: "p1", towerId: "tower-p1" }).accepted,
      true
    );
  }
  simulation.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  simulation.applyCommand({ type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode });
  simulation.applyCommand({ type: "advance-wave" });
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
  // The halved range of 6 leaves no axis-aligned cell at exactly that distance on seed 40, so use another seed.
  const seed = 41;
  const range = getTowerRange(1);
  // Distances are checked via hypot, so only an axis-aligned cell gives an exact integer distance.
  const exact = findTowerCellAtDistance(seed, range - 1e-9, range);
  assert.equal(firstTickTarget(seed, exact, "first", 0), "wave-1-creature-1");
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
