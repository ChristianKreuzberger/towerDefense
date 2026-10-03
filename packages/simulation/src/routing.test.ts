import test from "node:test";
import assert from "node:assert/strict";

import type { Tower } from "@tower-defense/shared";

import { createMatch } from "./match-simulation.js";
import { getBuildableCellsNearSpawn } from "./spawn-order.js";

type Cell = { x: number; y: number };
type Match = ReturnType<typeof createMatch>;

function players(count: number): Array<{ id: string; name: string }> {
  return Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` }));
}

function farCell(seed: number): Cell {
  const probe = createMatch({ players: players(1), seed });
  const cell = [...getBuildableCellsNearSpawn(seed)]
    .reverse()
    .find((entry) => probe.applyCommand({ type: "place-tower", playerId: "p1", x: entry.x, y: entry.y }).accepted);
  assert.ok(cell);
  return cell;
}

function creatureCells(match: Match, ticks: number): Cell[] {
  const seen: Cell[] = [];
  for (let tick = 0; tick < ticks && match.applyCommand({ type: "advance-wave" }).accepted; tick += 1) {
    for (const creature of match.getSnapshot().creatures) {
      seen.push({ x: creature.x, y: creature.y });
    }
  }
  return seen;
}

function startMatch(seed: number, towers: Cell[]): Match {
  const match = createMatch({ players: players(towers.length), seed });
  towers.forEach((cell, index) => {
    const result = match.applyCommand({ type: "place-tower", playerId: `p${index + 1}`, x: cell.x, y: cell.y });
    assert.equal(result.accepted, true);
  });
  towers.forEach((_, index) => match.applyCommand({ type: "ready-for-wave", playerId: `p${index + 1}` }));
  return match;
}

// Finds a seed where a second tower can sit on the shortest route (the maze has a loop to detour around it).
function findTowerOnRoute(): { seed: number; first: Cell; second: Cell } {
  for (let seed = 1; seed <= 400; seed += 1) {
    const first = farCell(seed);
    const lane = creatureCells(startMatch(seed, [first]), 150);
    for (const cell of lane) {
      const probe = createMatch({ players: players(2), seed });
      probe.applyCommand({ type: "place-tower", playerId: "p1", x: first.x, y: first.y });
      if (probe.applyCommand({ type: "place-tower", playerId: "p2", x: cell.x, y: cell.y }).accepted) {
        return { seed, first, second: cell };
      }
    }
  }
  assert.fail("expected a seed where a tower can stand on the route");
}

test("the creature route avoids every tower, not only the first one", () => {
  const { seed, first, second } = findTowerOnRoute();
  const match = startMatch(seed, [first, second]);
  match.applyCommand({ type: "advance-wave" });
  // Reads the route directly: towers shoot creatures, so walked cells alone would not prove anything.
  const route = (match as unknown as { currentWavePath: Cell[] }).currentWavePath;
  assert.ok(route.length > 0);
  assert.equal(
    route.some((cell) => cell.x === second.x && cell.y === second.y),
    false,
    "the route runs through the second tower"
  );
});

function placeTowers(match: Match, seed: number, count: number): Cell[] {
  const placed: Cell[] = [];
  for (const cell of [...getBuildableCellsNearSpawn(seed)].reverse()) {
    if (placed.length === count) {
      break;
    }
    if (match.applyCommand({ type: "place-tower", playerId: `p${placed.length + 1}`, x: cell.x, y: cell.y }).accepted) {
      placed.push(cell);
    }
  }
  assert.equal(placed.length, count);
  return placed;
}

test("spawned creatures target the live towers round robin by id", () => {
  const seed = 777;
  const match = createMatch({ players: players(2), seed });
  placeTowers(match, seed, 2);
  for (const id of ["p1", "p2"]) {
    match.applyCommand({ type: "ready-for-wave", playerId: id });
  }
  const targets = new Map<string, string>();
  for (let tick = 0; tick < 200 && targets.size < 3 && match.applyCommand({ type: "advance-wave" }).accepted; tick += 1) {
    for (const creature of match.getSnapshot().creatures) {
      targets.set(creature.id, creature.targetTowerId ?? "");
    }
  }
  // Wave 1 spawns three creatures.
  assert.deepEqual(
    ["wave-1-creature-1", "wave-1-creature-2", "wave-1-creature-3"].map((id) => targets.get(id)),
    ["tower-p1", "tower-p2", "tower-p1"]
  );
});

test("spawning and routing keep working after the first tower is gone", () => {
  const seed = 777;
  const match = createMatch({ players: players(2), seed });
  placeTowers(match, seed, 2);
  match.applyCommand({ type: "ready-for-wave", playerId: "p1" });
  match.applyCommand({ type: "ready-for-wave", playerId: "p2" });
  const internals = match as unknown as { state: { towers: Tower[] } };
  internals.state.towers = internals.state.towers.filter((tower) => tower.playerId !== "p1");
  const targets = new Set<string>();
  let seen = 0;
  for (let tick = 0; tick < 100 && match.applyCommand({ type: "advance-wave" }).accepted; tick += 1) {
    for (const creature of match.getSnapshot().creatures) {
      targets.add(creature.targetTowerId ?? "");
      seen += 1;
    }
  }
  assert.ok(seen > 0, "creatures should still spawn and move");
  assert.deepEqual([...targets], ["tower-p2"]);
});
