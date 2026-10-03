import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  MAX_PLAYERS,
  isValidTowerPlacement,
  type GameMap,
  type Tower,
} from "@tower-defense/shared";
import { generateMap } from "./procedural-map.js";
import { getBuildableCoordinate, getNonBuildableCoordinate, LANE_SEEDS } from "./test-helpers.js";

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
