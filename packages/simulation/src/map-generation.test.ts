import test from "node:test";
import assert from "node:assert/strict";

import {
  BASE_TOWER_RANGE,
  MAP_SCHEMA_VERSION,
  MIN_TOWER_SITES,
  PATH_WIDTH,
  TOWER_SPOT_COUNT,
  TOWER_SPOT_TOTAL,
  TOWER_SPOT_MAX_LANE_DISTANCE,
  isInSpawnProtection,
  validateGameMap,
  type GameMap
} from "@tower-defense/shared";

import { createMatch } from "./match-simulation.js";
import {
  MAZE_BRANCH_MAX_LENGTH,
  MAZE_MAX_BRANCHES,
  MAZE_PITCH,
  TOWER_SPOT_MIN_ROUTE_COVERAGE,
  generateMap
} from "./procedural-map.js";

function roadOf(map: GameMap): Set<string> {
  return new Set(map.cells.filter((cell) => cell.buildable).map((cell) => `${cell.x},${cell.y}`));
}

function nearestRoadDistance(map: GameMap, road: Set<string>, x: number, y: number): number {
  let best = Infinity;
  for (const key of road) {
    const [rx, ry] = key.split(",").map(Number) as [number, number];
    best = Math.min(best, Math.hypot(rx - x, ry - y));
  }
  return best;
}

const TOWER_SPOT_MIN_COUNT_300_SEEDS = 22;

test("generated maps carry the schema version and a goal on the right edge", () => {
  const map = generateMap(42);
  assert.equal(map.schemaVersion, MAP_SCHEMA_VERSION);
  assert.ok(map.goal);
  assert.equal(map.goal.x, map.width - 1);
  assert.equal(map.cells.find((cell) => cell.x === map.goal?.x && cell.y === map.goal?.y)?.buildable, true);
});

test("every generated map passes validation and has tower spots near the road", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const map = generateMap(seed);
    const road = roadOf(map);
    assert.deepEqual(validateGameMap(map), [], `seed ${seed} is invalid`);
    assert.ok(map.towerSpots.length >= MIN_TOWER_SITES, `seed ${seed} has too few tower spots`);
    // Crowded seeds run out of room at spacing 3; the lowest count over these 300 seeds is 22.
    assert.ok(map.towerSpots.length >= TOWER_SPOT_MIN_COUNT_300_SEEDS, `seed ${seed} has only ${map.towerSpots.length} tower spots`);
    assert.ok(map.towerSpots.length <= TOWER_SPOT_TOTAL, `seed ${seed} has too many tower spots`);
    for (const spot of map.towerSpots) {
      const label = `seed ${seed} spot ${spot.x},${spot.y}`;
      assert.ok(!road.has(`${spot.x},${spot.y}`), `${label} is on the road`);
      assert.ok(!isInSpawnProtection(map, spot.x, spot.y), `${label} is inside the cave area`);
      assert.ok(nearestRoadDistance(map, road, spot.x, spot.y) <= TOWER_SPOT_MAX_LANE_DISTANCE, `${label} is far from the road`);
      const coverage = [...road].filter((key) => {
        const [rx, ry] = key.split(",").map(Number) as [number, number];
        return Math.hypot(rx - spot.x, ry - spot.y) <= BASE_TOWER_RANGE;
      }).length;
      assert.ok(coverage >= TOWER_SPOT_MIN_ROUTE_COVERAGE, `${label} only covers ${coverage} road cells`);
    }
  }
});

test("some tower spots are within creature attack reach of the road, so towers can be hurt", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const map = generateMap(seed);
    const road = roadOf(map);
    const exposed = map.towerSpots.filter((spot) => nearestRoadDistance(map, road, spot.x, spot.y) <= 1.5);
    assert.ok(exposed.length >= 1, `seed ${seed} has no spot beside the road`);
  }
});

test("spots sit within creature reach of the route the simulation really walks", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const match = createMatch({ players: [{ id: "p1", name: "A" }], seed });
    const { map } = match.getSnapshot();
    // Farthest spot keeps the tower out of the way; a spot is never on the route so the route is the plain one.
    const far = [...map.towerSpots].sort((a, b) => b.x + b.y - (a.x + a.y))[0]!;
    match.applyCommand({ type: "place-tower", playerId: "p1", x: far.x, y: far.y });
    match.applyCommand({ type: "ready-for-wave", playerId: "p1" });
    match.applyCommand({ type: "advance-wave" });
    const route = (match as unknown as { currentWavePath: Array<{ x: number; y: number }> }).currentWavePath;
    const exposed = map.towerSpots.filter(
      (spot) => !isInSpawnProtection(map, spot.x, spot.y) && route.some((cell) => Math.hypot(cell.x - spot.x, cell.y - spot.y) <= 1.5)
    );
    for (const spot of map.towerSpots) {
      const covered = route.filter((cell) => Math.hypot(cell.x - spot.x, cell.y - spot.y) <= BASE_TOWER_RANGE).length;
      assert.ok(covered >= TOWER_SPOT_MIN_ROUTE_COVERAGE, `seed ${seed} spot ${spot.x},${spot.y} covers only ${covered} route cells`);
    }
    assert.ok(exposed.length >= 2, `seed ${seed}: only ${exposed.length} spots are within creature reach of the route`);
  }
});

test("tower spots keep their distance from each other on the default map", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const { towerSpots } = generateMap(seed);
    for (const [index, a] of towerSpots.entries()) {
      for (const b of towerSpots.slice(index + 1)) {
        assert.ok(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) >= 3, `seed ${seed} spots too close`);
      }
    }
  }
});

test("the base spots stay first in the list and extras are appended, each group sorted by row then column", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const { towerSpots } = generateMap(seed);
    const sorted = (spots: typeof towerSpots) =>
      spots.every((spot, index) => index === 0 || spots[index - 1]!.y < spot.y || (spots[index - 1]!.y === spot.y && spots[index - 1]!.x < spot.x));
    assert.ok(sorted(towerSpots.slice(0, TOWER_SPOT_COUNT)), `seed ${seed} base spots are not in the original order`);
    assert.ok(sorted(towerSpots.slice(TOWER_SPOT_COUNT)), `seed ${seed} extra spots are not sorted`);
  }
});

test("tower spots are deterministic per seed", () => {
  assert.deepEqual(generateMap(77).towerSpots, generateMap(77).towerSpots);
});

test("the road is two cells wide: every road cell has a road partner across it", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const map = generateMap(seed);
    const road = roadOf(map);
    for (const key of road) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      // Every cell sits in a PATH_WIDTH x PATH_WIDTH block of road, so no 1-wide corridor exists.
      const inBlock = [-1, 0].some((ox) => [-1, 0].some((oy) => {
        const cells = [];
        for (let dx = 0; dx < PATH_WIDTH; dx += 1) {
          for (let dy = 0; dy < PATH_WIDTH; dy += 1) {
            cells.push(`${x + ox + dx},${y + oy + dy}`);
          }
        }
        return cells.every((cell) => road.has(cell));
      }));
      assert.ok(inBlock, `seed ${seed} road cell ${key} is part of a 1-wide strip`);
    }
    assert.ok(road.has(`0,${map.spawn?.y ?? -1}`) && road.has(`0,${(map.spawn?.y ?? -1) + 1}`), `seed ${seed} cave is not 2 wide`);
    assert.ok(road.has(`${map.width - 1},${map.goal?.y ?? -1}`) && road.has(`${map.width - 1},${(map.goal?.y ?? -1) + 1}`), `seed ${seed} goal is not 2 wide`);
  }
});

test("the tower spot guarantee also holds on small maps", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const map = generateMap(seed, 20, 20);
    assert.deepEqual(validateGameMap(map), [], `seed ${seed} is invalid`);
    assert.ok(map.towerSpots.length >= MIN_TOWER_SITES, `seed ${seed} has too few tower spots`);
    const road = roadOf(map);
    for (const spot of map.towerSpots) {
      assert.ok(!road.has(`${spot.x},${spot.y}`), `seed ${seed} spot on the road`);
    }
  }
});

test("generation stays deterministic per seed", () => {
  assert.deepEqual(generateMap(2024), generateMap(2024));
  assert.notDeepEqual(generateMap(2024).towerSpots, generateMap(2025).towerSpots);
});

test("createMatch refuses to start with a malformed map", () => {
  assert.throws(
    () => createMatch({ players: [{ id: "p1", name: "A" }], seed: 1, map: { ...generateMap(1), schemaVersion: 99 } }),
    /unsupported-schema-version/
  );
});

// Rebuilds the room graph (one node per MAZE_PITCH grid room) from the carved road.
function roomGraph(map: GameMap): Map<string, string[]> {
  const road = roadOf(map);
  const columns = Math.floor((map.width - PATH_WIDTH) / MAZE_PITCH) + 1;
  const rows = Math.floor((map.height - PATH_WIDTH) / MAZE_PITCH) + 1;
  const graph = new Map<string, string[]>();
  for (let c = 0; c < columns; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      if (road.has(`${c * MAZE_PITCH},${r * MAZE_PITCH}`)) {
        graph.set(`${c},${r}`, []);
      }
    }
  }
  for (const key of graph.keys()) {
    const [c, r] = key.split(",").map(Number) as [number, number];
    if (road.has(`${c * MAZE_PITCH + 3},${r * MAZE_PITCH}`) && graph.has(`${c + 1},${r}`)) {
      graph.get(key)?.push(`${c + 1},${r}`);
      graph.get(`${c + 1},${r}`)?.push(key);
    }
    if (road.has(`${c * MAZE_PITCH},${r * MAZE_PITCH + 3}`) && graph.has(`${c},${r + 1}`)) {
      graph.get(key)?.push(`${c},${r + 1}`);
      graph.get(`${c},${r + 1}`)?.push(key);
    }
  }
  return graph;
}

function roomDistances(graph: Map<string, string[]>, from: string): Map<string, number> {
  const distance = new Map<string, number>([[from, 0]]);
  const queue = [from];
  for (let index = 0; index < queue.length; index += 1) {
    const key = queue[index] ?? "";
    for (const next of graph.get(key) ?? []) {
      if (!distance.has(next)) {
        distance.set(next, (distance.get(key) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  return distance;
}

for (const [label, width, height] of [["default", 50, 50], ["small", 20, 20]] as const) {
  test(`${label} maps have few dead ends, no loops and one route between spawn and goal`, () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const map = generateMap(seed, width, height);
      const graph = roomGraph(map);
      const columns = Math.floor((width - PATH_WIDTH) / MAZE_PITCH) + 1;
      const spawn = `0,${Math.floor((map.spawn?.y ?? 0) / MAZE_PITCH)}`;
      const goal = `${columns - 1},${Math.floor((map.goal?.y ?? 0) / MAZE_PITCH)}`;
      const edges = [...graph.values()].reduce((sum, list) => sum + list.length, 0) / 2;
      assert.equal(edges, graph.size - 1, `seed ${seed} road has a loop or a detached room`);
      const fromSpawn = roomDistances(graph, spawn);
      const routeRooms = (fromSpawn.get(goal) ?? -1) + 1;
      assert.ok(routeRooms >= 1, `seed ${seed} goal is not reachable`);
      assert.ok(
        graph.size <= routeRooms + MAZE_MAX_BRANCHES * MAZE_BRANCH_MAX_LENGTH,
        `seed ${seed} carves ${graph.size} rooms for a route of ${routeRooms}`
      );
      const leaves = [...graph.values()].filter((list) => list.length === 1).length;
      assert.ok(leaves <= 2 + MAZE_MAX_BRANCHES, `seed ${seed} has ${leaves} dead ends`);
    }
  });
}

test("spawn and goal rooms are the pair of left and right edge rooms furthest apart in the carved maze", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const map = generateMap(seed);
    const graph = roomGraph(map);
    const columns = Math.floor((map.width - PATH_WIDTH) / MAZE_PITCH) + 1;
    const spawn = `0,${Math.floor((map.spawn?.y ?? 0) / MAZE_PITCH)}`;
    const goal = `${columns - 1},${Math.floor((map.goal?.y ?? 0) / MAZE_PITCH)}`;
    const route = roomDistances(graph, spawn).get(goal) ?? -1;
    assert.ok((route + 1) * MAZE_PITCH >= map.width, `seed ${seed} route is shorter than the map is wide`);
    for (const start of graph.keys()) {
      if (!start.startsWith("0,")) {
        continue;
      }
      for (const [room, steps] of roomDistances(graph, start)) {
        if (room.startsWith(`${columns - 1},`)) {
          assert.ok(steps <= route, `seed ${seed}: ${start} to ${room} is longer than the spawn to goal route`);
        }
      }
    }
  }
});

test("every default map still gets the full set of tower spots", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    assert.equal(generateMap(seed).towerSpots.length, TOWER_SPOT_COUNT, `seed ${seed}`);
  }
});
