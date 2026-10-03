import test from "node:test";
import assert from "node:assert/strict";

import { AI_DIFFICULTIES, TOWER_MOVE_AFTER_WAVES, type AiDifficulty, type SimulationCommand } from "@tower-defense/shared";
import { areBotsPending, planAiCommands, stepAiPlayers } from "./ai-player.js";
import { createMatch, type MatchSimulation } from "./match-simulation.js";

function botMatch(seed: number, difficulties: AiDifficulty[]): MatchSimulation {
  return createMatch({
    seed,
    players: difficulties.map((ai, index) => ({ id: `p${index + 1}`, name: `Bot ${index + 1}`, ai }))
  });
}

function runPrep(simulation: MatchSimulation): SimulationCommand[] {
  const commands: SimulationCommand[] = [];
  for (let guard = 0; guard < 200; guard += 1) {
    const step = stepAiPlayers(simulation);
    if (step.action) {
      assert.equal(step.action.accepted, true, `bot command rejected: ${JSON.stringify(step.action.command)}`);
      commands.push(step.action.command);
    }
    if (!step.pending) {
      return commands;
    }
  }
  throw new Error("bots never finished prep");
}

function playToEnd(simulation: MatchSimulation, maxWaves = 60): { wave: number; winnerId: string | undefined; points: number[] } {
  for (let wave = 0; wave < maxWaves && simulation.getSnapshot().phase !== "ended"; wave += 1) {
    runPrep(simulation);
    while (simulation.applyCommand({ type: "advance-wave" }).accepted) {
      // The wave runs until it ends the phase; the command is rejected once the phase is no longer "wave".
    }
  }
  const snapshot = simulation.getSnapshot();
  return { wave: snapshot.wave, winnerId: snapshot.winnerId, points: snapshot.players.map((player) => player.points) };
}

test("every difficulty plays only commands the rules accept and ends prep with a started wave", () => {
  for (const difficulty of AI_DIFFICULTIES) {
    const simulation = botMatch(7, [difficulty]);
    const commands = runPrep(simulation);
    assert.equal(commands[0]?.type, "place-tower", `${difficulty} places first`);
    assert.equal(commands.at(-1)?.type, "ready-for-wave", `${difficulty} commits last`);
    const snapshot = simulation.getSnapshot();
    assert.equal(snapshot.phase, "wave", `${difficulty} bot started the wave`);
    assert.ok((snapshot.players[0]?.points ?? -1) >= 0, "never spends more than it has");
  }
});

test("the same seed gives the same bot decisions and a different seed changes easy bots", () => {
  const first = runPrep(botMatch(11, ["easy", "medium", "hard"]));
  const again = runPrep(botMatch(11, ["easy", "medium", "hard"]));
  assert.deepEqual(first, again);

  const placements = new Set<string>();
  for (let seed = 1; seed <= 6; seed += 1) {
    const place = runPrep(botMatch(seed, ["easy"])).find((command) => command.type === "place-tower");
    placements.add(JSON.stringify(place));
  }
  assert.ok(placements.size > 1, "easy placement depends on the seed");
});

test("hard matches the damage type to the whole next wave, easy never changes it", () => {
  // Wave 1 is runner, swarm, armored: explosive scores highest by points per damage.
  const hard = botMatch(5, ["hard"]);
  const hardCommands = runPrep(hard);
  const damageType = hardCommands.find((command) => command.type === "set-damage-type");
  assert.equal(damageType?.type === "set-damage-type" ? damageType.damageType : null, "explosive");

  const easyCommands = runPrep(botMatch(5, ["easy"]));
  assert.equal(easyCommands.some((command) => command.type === "set-damage-type" || command.type === "set-target-mode"), false);
});

test("bots wait for every human to place, then act in player order", () => {
  const simulation = createMatch({
    seed: 3,
    players: [
      { id: "p1", name: "Human" },
      { id: "p2", name: "Bot 1", ai: "medium" },
      { id: "p3", name: "Bot 2", ai: "easy" }
    ]
  });
  assert.deepEqual(stepAiPlayers(simulation), { action: null, pending: false });
  assert.equal(areBotsPending(simulation.getSnapshot()), false);

  const spot = simulation.getSnapshot().map.towerSpots[0];
  assert.ok(spot);
  assert.equal(simulation.applyCommand({ type: "place-tower", playerId: "p1", x: spot.x, y: spot.y }).accepted, true);
  const commands = runPrep(simulation);
  const ready = commands.filter((command) => command.type === "ready-for-wave");
  assert.equal(ready.length, 2);
  assert.deepEqual(commands.filter((command) => command.type === "place-tower").map((command) => command.type === "place-tower" ? command.playerId : ""), ["p2", "p3"]);
  // The human has not readied, so the wave has not started.
  assert.equal(simulation.getSnapshot().phase, "placement");
  assert.equal(stepAiPlayers(simulation).action, null);
});

test("a ready bot and an unknown player plan nothing", () => {
  const simulation = botMatch(9, ["medium"]);
  runPrep(simulation);
  const snapshot = simulation.getSnapshot();
  assert.deepEqual(planAiCommands(snapshot, "p1", "medium"), []);
  assert.deepEqual(planAiCommands({ ...snapshot, phase: "placement" }, "nobody", "hard"), []);
});

test("a hard bot with a poor spot uses its free tower move once it unlocks", () => {
  const simulation = botMatch(5, ["hard"]);
  const opening = simulation.getSnapshot();
  const ranked = planAiCommands(opening, "p1", "hard");
  const worst = ranked.at(-1);
  assert.equal(worst?.type, "place-tower");
  assert.equal(simulation.applyCommand(worst as SimulationCommand).accepted, true);

  for (let guard = 0; guard < 40 && simulation.getSnapshot().wave <= TOWER_MOVE_AFTER_WAVES; guard += 1) {
    if (simulation.getSnapshot().phase === "placement") {
      runPrep(simulation);
    }
    while (simulation.applyCommand({ type: "advance-wave" }).accepted) {
      // Run the wave out.
    }
    assert.notEqual(simulation.getSnapshot().phase, "ended");
  }

  const [first] = planAiCommands(simulation.getSnapshot(), "p1", "hard");
  assert.equal(first?.type, "move-tower");
  runPrep(simulation);
  const events = simulation.getSnapshot().events.filter((event) => event.type === "tower-moved");
  assert.equal(events.length, 1);
});

test("a bots-only match reaches a winner and replays identically", () => {
  const run = (): ReturnType<typeof playToEnd> => playToEnd(botMatch(21, ["easy", "medium", "hard", "hard"]));
  const first = run();
  assert.ok(first.winnerId, "someone won");
  assert.deepEqual(run(), first);
});

test("over fixed seeds, hard outscores medium and medium outscores easy", () => {
  const totals: Record<AiDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
  const lineup: AiDifficulty[] = ["easy", "medium", "hard"];
  for (let seed = 1; seed <= 5; seed += 1) {
    // Rotate the seats so the first pick of a spot does not favour one difficulty.
    for (let rotation = 0; rotation < lineup.length; rotation += 1) {
      const seats = lineup.map((_, index) => lineup[(index + rotation) % lineup.length] as AiDifficulty);
      const result = playToEnd(botMatch(seed, seats));
      result.points.forEach((points, index) => {
        totals[seats[index] as AiDifficulty] += points;
      });
    }
  }
  assert.ok(totals.hard > totals.medium, `hard ${totals.hard} should beat medium ${totals.medium}`);
  assert.ok(totals.medium > totals.easy, `medium ${totals.medium} should beat easy ${totals.easy}`);
});
