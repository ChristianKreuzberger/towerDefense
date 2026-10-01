import test from "node:test";
import assert from "node:assert/strict";

import { createMatch } from "./match-simulation.js";
import {
  CATCH_UP_GAP_FRACTION,
  CATCH_UP_GAP_THRESHOLD,
  CATCH_UP_MAX_BONUS,
  SWARM_KILL_INCOME_CAP_PER_WAVE,
  WIN_SCORE,
  getCatchUpBonus,
  getCreatureRewardPoints,
  getWaveClearBonus,
  type MatchEvent
} from "@tower-defense/shared";
import { getBuildableCellsNearSpawn } from "./spawn-order.js";

type Internals = {
  endWave: () => void;
  awardCreatureKillIncome: (playerId: string, archetype: "swarm" | "runner", creatureId: string) => number;
  state: {
    phase: string;
    players: Array<{ id: string; points: number; eliminated: boolean }>;
    telemetry: { currentWave: { catchUpBonusAwarded: number; swarmIncomeCapped: number; creaturesSpawned: number } };
  };
};

function createWaveMatch(playerCount: number, seed = 31) {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const sim = createMatch({ players, seed });
  // Greedy placement: skip cells that would be rejected (for example because they block the lane).
  const candidates = getBuildableCellsNearSpawn(seed);
  let next = 0;
  for (const player of players) {
    for (; next < candidates.length; next += 1) {
      const cell = candidates[next]!;
      if (sim.applyCommand({ type: "place-tower", playerId: player.id, x: cell.x, y: cell.y }).accepted) {
        next += 1;
        break;
      }
    }
  }
  for (const player of players) {
    assert.equal(sim.applyCommand({ type: "ready-for-wave", playerId: player.id }).accepted, true);
  }
  const internals = sim as unknown as Internals;
  assert.equal(internals.state.phase, "wave");
  return { sim, internals };
}

function setPoints(internals: Internals, points: number[]): void {
  points.forEach((value, i) => {
    internals.state.players[i]!.points = value;
  });
}

function catchUpEvents(sim: ReturnType<typeof createMatch>) {
  return sim
    .getSnapshot()
    .events.filter((e): e is Extract<MatchEvent, { type: "catch-up-bonus" }> => e.type === "catch-up-bonus");
}

test("getCatchUpBonus: threshold, fraction and cap boundaries", () => {
  assert.equal(getCatchUpBonus(CATCH_UP_GAP_THRESHOLD - 1), 0);
  assert.equal(getCatchUpBonus(0), 0);
  assert.equal(getCatchUpBonus(CATCH_UP_GAP_THRESHOLD), Math.floor(CATCH_UP_GAP_THRESHOLD * CATCH_UP_GAP_FRACTION));
  assert.equal(getCatchUpBonus(100), 10);
  assert.equal(getCatchUpBonus(299), 29);
  assert.equal(getCatchUpBonus(300), CATCH_UP_MAX_BONUS);
  assert.equal(getCatchUpBonus(900), CATCH_UP_MAX_BONUS);
});

test("trailing player gets a catch-up bonus at wave end, leader and near players do not", () => {
  const { sim, internals } = createWaveMatch(3);
  setPoints(internals, [300, 200, 50]);
  internals.endWave();

  const events = catchUpEvents(sim);
  assert.deepEqual(
    events.map((e) => [e.playerId, e.bonus, e.gap]),
    [
      ["p2", 10, 100],
      ["p3", 25, 250]
    ]
  );
  assert.deepEqual(
    sim.getSnapshot().players.map((p) => p.points),
    [300, 210, 75]
  );
  const completed = sim.getSnapshot().telemetry.completedWaves[0]!;
  assert.equal(completed.catchUpBonusAwarded, 35);
  assert.equal(internals.state.telemetry.currentWave.catchUpBonusAwarded, 0, "new wave telemetry starts empty");

  const exported = sim.getSnapshot().events.find((e) => e.type === "balance-analysis-export");
  assert.ok(exported && exported.type === "balance-analysis-export");
  const exportPlayers = exported.snapshot.players;
  assert.deepEqual(
    exportPlayers.map((p) => p.catchUpBonusThisWave),
    [0, 10, 25]
  );
  assert.equal(exported.snapshot.totals.catchUpBonusThisWave, 35);
});

test("no catch-up bonus below the gap threshold, for ties, or for eliminated players", () => {
  const below = createWaveMatch(2);
  setPoints(below.internals, [200, 200 - CATCH_UP_GAP_THRESHOLD + 1]);
  below.internals.endWave();
  assert.equal(catchUpEvents(below.sim).length, 0);

  const eliminated = createWaveMatch(3);
  setPoints(eliminated.internals, [400, 0, 0]);
  eliminated.internals.state.players[1]!.eliminated = true;
  eliminated.internals.endWave();
  assert.deepEqual(
    catchUpEvents(eliminated.sim).map((e) => e.playerId),
    ["p3"]
  );
  assert.equal(eliminated.sim.getSnapshot().players[1]!.points, 0);

  const leaderEliminated = createWaveMatch(3);
  setPoints(leaderEliminated.internals, [900, 300, 150]);
  leaderEliminated.internals.state.players[0]!.eliminated = true;
  leaderEliminated.internals.endWave();
  // The eliminated player's score does not define the leader, so p2 leads and only p3 trails by 150.
  assert.deepEqual(
    catchUpEvents(leaderEliminated.sim).map((e) => [e.playerId, e.gap]),
    [["p3", 150]]
  );
});

test("catch-up bonus never lifts a player to the win score on its own", () => {
  const { sim, internals } = createWaveMatch(2);
  setPoints(internals, [WIN_SCORE + 500, WIN_SCORE - 5]);
  internals.endWave();
  const snapshot = sim.getSnapshot();
  assert.equal(snapshot.players[1]!.points, WIN_SCORE - 1);
  assert.equal(snapshot.phase, "placement");
  assert.equal(catchUpEvents(sim)[0]!.bonus, 4);
});

test("a wave-clear score win still ends the match and skips the catch-up bonus", () => {
  const { sim, internals } = createWaveMatch(2);
  internals.state.telemetry.currentWave.creaturesSpawned = 1; // a cleared wave: spawned, none exited
  setPoints(internals, [WIN_SCORE - getWaveClearBonus(), 0]);
  internals.endWave();
  const snapshot = sim.getSnapshot();
  assert.equal(snapshot.phase, "ended");
  assert.equal(snapshot.endReason, "score-win");
  assert.equal(snapshot.winnerId, "p1");
  assert.equal(catchUpEvents(sim).length, 0);
  assert.equal(snapshot.events.filter((e) => e.type === "wave-end").length, 1);
  assert.equal(snapshot.telemetry.completedWaves[0]!.catchUpBonusAwarded, 0);
});

test("catch-up bonus is deterministic for the same seed and inputs", () => {
  const run = () => {
    const { sim, internals } = createWaveMatch(3, 77);
    setPoints(internals, [500, 120, 10]);
    internals.endWave();
    return JSON.stringify(sim.getSnapshot().events);
  };
  assert.equal(run(), run());
});

test("swarm income cap pays up to the cap, then forfeits points and reports them", () => {
  const { sim, internals } = createWaveMatch(2);
  const reward = getCreatureRewardPoints("swarm");
  const fullKills = Math.floor(SWARM_KILL_INCOME_CAP_PER_WAVE / reward);
  let total = 0;
  for (let i = 0; i < fullKills; i += 1) {
    total += internals.awardCreatureKillIncome("p1", "swarm", `c${i}`);
  }
  assert.equal(total, fullKills * reward);
  assert.equal(
    sim.getSnapshot().events.some((e) => e.type === "swarm-income-capped"),
    false
  );

  // Boundary kill: pays only what is left under the cap (possibly 0), the rest is forfeited.
  const remaining = SWARM_KILL_INCOME_CAP_PER_WAVE - fullKills * reward;
  assert.equal(internals.awardCreatureKillIncome("p1", "swarm", "boundary"), remaining);
  const forfeitedAtBoundary = reward - remaining;
  assert.equal(internals.awardCreatureKillIncome("p1", "swarm", "over"), 0);

  assert.equal(sim.getSnapshot().players.find((p) => p.id === "p1")!.points, SWARM_KILL_INCOME_CAP_PER_WAVE);
  const capped = sim
    .getSnapshot()
    .events.filter((e): e is Extract<MatchEvent, { type: "swarm-income-capped" }> => e.type === "swarm-income-capped");
  assert.equal(capped.at(-1)!.forfeitedPoints, reward);
  assert.equal(
    capped.reduce((sum, e) => sum + e.forfeitedPoints, 0),
    forfeitedAtBoundary + reward
  );
  assert.equal(internals.state.telemetry.currentWave.swarmIncomeCapped, forfeitedAtBoundary + reward);

  // The cap is per player: p2 is untouched, and non-swarm kills are never capped.
  assert.equal(internals.awardCreatureKillIncome("p2", "swarm", "other"), reward);
  assert.equal(internals.awardCreatureKillIncome("p1", "runner", "run"), getCreatureRewardPoints("runner"));
});

test("swarm income cap resets with the next wave and shows up in telemetry", () => {
  const { sim, internals } = createWaveMatch(1);
  for (let i = 0; i < 20; i += 1) {
    internals.awardCreatureKillIncome("p1", "swarm", `c${i}`);
  }
  const forfeited = internals.state.telemetry.currentWave.swarmIncomeCapped;
  assert.ok(forfeited > 0);
  internals.endWave();
  assert.equal(sim.getSnapshot().telemetry.completedWaves[0]!.swarmIncomeCapped, forfeited);

  assert.equal(sim.applyCommand({ type: "ready-for-wave", playerId: "p1" }).accepted, true);
  assert.equal(internals.state.phase, "wave");
  assert.equal(internals.awardCreatureKillIncome("p1", "swarm", "fresh"), getCreatureRewardPoints("swarm"));
});
