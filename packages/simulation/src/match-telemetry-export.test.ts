import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  MOVEMENT_PROGRESS_UNITS_PER_CELL,
  type MatchEvent,
  type MatchSnapshot,
  getTowerUpgradeCost,
  getWaveClearBonus,
} from "@tower-defense/shared";
import { getBuildableCoordinate, getBuildableCoordinates, tickUntil } from "./test-helpers.js";

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
