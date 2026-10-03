import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  SPAWN_PROTECTION_TICKS,
  getTowerUpgradeCost,
  type DamageType,
} from "@tower-defense/shared";
import { generateMap } from "./procedural-map.js";
import { getBuildableCellsNearSpawn } from "./spawn-order.js";

// Where the first creature is on the first tick it can be targeted. With range 6 and spawn protection, towers
// sorted by distance to the cave itself would see creatures walk out of range before they become shootable.
export function getFirstTargetablePosition(seed: number): { x: number; y: number } {
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
export function getPlaceableCellsNearSpawn(seed: number, count: number): Array<{ x: number; y: number }> {
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

export function getBuildableCoordinate(seed: number): { x: number; y: number } {
  const [cell] = getPlaceableCellsNearSpawn(seed, 1);
  assert.ok(cell, "expected at least one buildable cell");
  return cell;
}

export function getNonBuildableCoordinate(seed: number): { x: number; y: number } {
  const map = generateMap(seed);
  const cell = map.cells.find((entry) => !entry.buildable);
  assert.ok(cell, "expected at least one non-buildable cell");
  return { x: cell.x, y: cell.y };
}

export function getSecondBuildableCoordinate(
  seed: number,
  first: { x: number; y: number }
): { x: number; y: number } {
  const cell = getPlaceableCellsNearSpawn(seed, 2).find((entry) => entry.x !== first.x || entry.y !== first.y);
  assert.ok(cell, "expected at least one additional buildable cell");
  return cell;
}

export function getBuildableCoordinates(seed: number, count: number): Array<{ x: number; y: number }> {
  return getPlaceableCellsNearSpawn(seed, count);
}

// `damageType` is set before readying; tests that assert exact per-hit damage use a type that is neutral (x1) against the first runner.
export function createSinglePlayerWaveSimulation(seed: number, damageType?: DamageType): ReturnType<typeof createMatch> {
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

export function tickUntil(
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

export const LANE_SEEDS = [1, 19, 42, 777, 2024, 31337, 99999];

export type TargetMode = "first" | "last" | "strongest" | "nearest";

// Creatures cannot be targeted for their first SPAWN_PROTECTION_TICKS ticks, so the first creature is
// shootable on the tick after the protected ones. Wave ticks start at 1 and creature 1 spawns on tick 1.
export function advanceToFirstTargetableTick(simulation: ReturnType<typeof createMatch>): void {
  for (let tick = 0; tick <= SPAWN_PROTECTION_TICKS; tick += 1) {
    simulation.applyCommand({ type: "advance-wave" });
  }
}

// Finds a tower cell whose distance to the first spawned creature lies in (minExclusive, maxInclusive].
export function findTowerCellAtDistance(
  seed: number,
  minExclusive: number,
  maxInclusive: number
): { x: number; y: number } {
  const cell = tryFindTowerCellAtDistance(seed, minExclusive, maxInclusive);
  assert.ok(cell, "no suitable tower cell found");
  return cell;
}

export function tryFindTowerCellAtDistance(
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

export function firstTickTarget(
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

export function createPrepMatchWithTower(seed: number): ReturnType<typeof createMatch> {
  const cell = getBuildableCoordinate(seed);
  const simulation = createMatch({ players: [{ id: "p1", name: "Alpha" }], seed });
  assert.equal(simulation.applyCommand({ type: "place-tower", playerId: "p1", x: cell.x, y: cell.y }).accepted, true);
  return simulation;
}
