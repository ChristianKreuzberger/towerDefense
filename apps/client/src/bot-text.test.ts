import assert from "node:assert/strict";
import test from "node:test";

import type { MatchSnapshot } from "@tower-defense/shared";
import { botsCanAct, clampPlayerCounts, describeBotAction, seatsToSetupPlayers, snapshotToSetupPlayers } from "./bot-text.js";

type Player = MatchSnapshot["players"][number];
const player = (fields: Partial<Player> & { id: string }): Player => ({
  name: fields.id, points: 100, hasPlacedTower: false, readyForWave: false, eliminated: false, towerMoveAvailable: false, ...fields
});
const snapshot = (players: Player[], phase: MatchSnapshot["phase"] = "placement"): MatchSnapshot => ({ phase, players } as MatchSnapshot);

test("clampPlayerCounts keeps 1 to 8 players in total and lets bots give way", () => {
  assert.deepEqual(clampPlayerCounts(5, 6), { humans: 5, bots: 3 });
  assert.deepEqual(clampPlayerCounts(0, 0), { humans: 0, bots: 1 });
  assert.deepEqual(clampPlayerCounts(0, 8), { humans: 0, bots: 8 });
  assert.deepEqual(clampPlayerCounts(9, 0), { humans: 8, bots: 0 });
});

test("seats become setup players: humans first, bots named Bot N with their difficulty", () => {
  const players = seatsToSetupPlayers([
    { kind: "human", name: "  Alpha ", defaultName: "Player 1" },
    { kind: "human", name: "", defaultName: "Player 2" },
    { kind: "bot", ai: "hard" },
    { kind: "bot", ai: "easy" }
  ]);
  assert.deepEqual(players, [
    { id: "p1", name: "Alpha" },
    { id: "p2", name: "Player 2" },
    { id: "p3", name: "Bot 1", ai: "hard" },
    { id: "p4", name: "Bot 2", ai: "easy" }
  ]);
});

test("a rematch keeps ids, names and bot difficulties", () => {
  const players = [player({ id: "p1", name: "Alpha" }), player({ id: "p2", name: "Bot 1", ai: "medium" })];
  assert.deepEqual(snapshotToSetupPlayers(players), [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Bot 1", ai: "medium" }]);
});

test("bots only act in prep, after every living human placed, while a bot is not ready", () => {
  const human = player({ id: "p1" });
  const bot = player({ id: "p2", ai: "easy" });
  assert.equal(botsCanAct(snapshot([human, bot])), false);
  assert.equal(botsCanAct(snapshot([{ ...human, hasPlacedTower: true }, bot])), true);
  assert.equal(botsCanAct(snapshot([{ ...human, eliminated: true }, bot])), true);
  assert.equal(botsCanAct(snapshot([{ ...human, hasPlacedTower: true }, { ...bot, readyForWave: true }])), false);
  assert.equal(botsCanAct(snapshot([bot], "wave")), false);
  assert.equal(botsCanAct(snapshot([bot])), true);
  assert.equal(botsCanAct(null), false);
});

test("bot actions read as short toasts", () => {
  assert.equal(describeBotAction("Bot 1", { type: "upgrade-tower", playerId: "p2", towerId: "t", track: "damage" }), "Bot 1 upgraded damage");
  assert.equal(describeBotAction("Bot 1", { type: "ready-for-wave", playerId: "p2" }), "Bot 1 is ready");
});
