import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  MAX_PLAYERS,
  WIN_SCORE,
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
  assert.equal(second.reason, "placement-phase-not-active");
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
      level: 1
    },
    {
      id: "t-2",
      playerId: "p2",
      x: 1,
      y: 2,
      health: 100,
      maxHealth: 100,
      level: 1
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
      level: 1
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
      level: 1
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

  const placeWall = simulation.applyCommand({
    type: "place-wall",
    playerId: "p1",
    x: wallCoordinate.x,
    y: wallCoordinate.y
  });
  assert.equal(placeWall.accepted, false);
  assert.equal(placeWall.reason, "insufficient-points");
});

test("keeps placement phase until every player has placed a tower", () => {
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
    type: "place-tower",
    playerId: "p2",
    x: secondCell.x,
    y: secondCell.y
  });
  const snapshot = simulation.getSnapshot();
  assert.equal(snapshot.phase, "wave");
  assert.equal(snapshot.towers.length, 2);
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
