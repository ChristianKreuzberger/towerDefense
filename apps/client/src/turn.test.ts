import assert from "node:assert/strict";
import { test } from "node:test";
import { firstPendingPlayerId, nextPendingPlayerId, type TurnPlayer } from "./turn.js";

const player = (id: string, readyForWave: boolean, eliminated = false): TurnPlayer => ({ id, readyForWave, eliminated });

test("picks the next player who is not ready", () => {
  const players = [player("p1", true), player("p2", false), player("p3", false)];
  assert.equal(nextPendingPlayerId(players, "p1"), "p2");
});

test("skips ready and eliminated players and wraps around", () => {
  const players = [player("p1", false), player("p2", true), player("p3", false, true), player("p4", true)];
  assert.equal(nextPendingPlayerId(players, "p2"), "p1");
});

test("returns null when everyone is ready", () => {
  assert.equal(nextPendingPlayerId([player("p1", true), player("p2", true)], "p1"), null);
});

test("can return the same player when they are the only one pending", () => {
  assert.equal(nextPendingPlayerId([player("p1", false), player("p2", true)], "p1"), "p1");
});

test("unknown current player starts from the first player", () => {
  assert.equal(nextPendingPlayerId([player("p1", false), player("p2", false)], "zz"), "p1");
});

test("firstPendingPlayerId returns the first player in seating order who is not ready or eliminated", () => {
  const players = [player("p1", true), player("p2", false, true), player("p3", false), player("p4", false)];
  assert.equal(firstPendingPlayerId(players), "p3");
});

test("firstPendingPlayerId picks the first seat after a wave, when everyone is unready", () => {
  assert.equal(firstPendingPlayerId([player("p1", false), player("p2", false)]), "p1");
});

test("firstPendingPlayerId skips an eliminated first seat", () => {
  assert.equal(firstPendingPlayerId([player("p1", false, true), player("p2", false)]), "p2");
});

test("firstPendingPlayerId returns null when nobody is pending", () => {
  assert.equal(firstPendingPlayerId([player("p1", true), player("p2", false, true)]), null);
  assert.equal(firstPendingPlayerId([]), null);
});

test("bots never get a hot-seat turn", () => {
  const players: TurnPlayer[] = [{ ...player("p1", true) }, { ...player("p2", false), ai: "easy" }, { ...player("p3", false) }];
  assert.equal(nextPendingPlayerId(players, "p1"), "p3");
  assert.equal(firstPendingPlayerId([{ ...player("p1", false), ai: "hard" }, player("p2", false)]), "p2");
  assert.equal(firstPendingPlayerId([{ ...player("p1", false), ai: "hard" }]), null);
});
