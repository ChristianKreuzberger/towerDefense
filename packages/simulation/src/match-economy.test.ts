import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  WIN_SCORE,
  type MatchEvent,
  getWaveClearBonus,
} from "@tower-defense/shared";
import { getBuildableCoordinates, createSinglePlayerWaveSimulation, tickUntil } from "./test-helpers.js";

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
