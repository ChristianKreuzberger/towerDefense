import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  STARTING_POINTS,
  getTowerRange,
  isInSpawnProtection,
  getTowerUpgradeCost,
  MAX_TOWER_LEVEL,
  type DamageType,
} from "@tower-defense/shared";
import { getPlaceableCellsNearSpawn, getBuildableCoordinate, getNonBuildableCoordinate, getSecondBuildableCoordinate, getBuildableCoordinates, tickUntil, findTowerCellAtDistance, firstTickTarget, createPrepMatchWithTower } from "./test-helpers.js";

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
