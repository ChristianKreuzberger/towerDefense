import assert from "node:assert/strict";
import test from "node:test";

import { MAX_PLAYER_NAME_LENGTH } from "@tower-defense/shared";
import { createGameApi, type GameApiResponse } from "./game-api.js";

type Api = ReturnType<typeof createGameApi>;

const post = (api: Api, pathname: string, body: unknown): GameApiResponse =>
  api({ method: "POST", pathname, searchParams: new URLSearchParams(), body });

function startedApi(): Api {
  const api = createGameApi();
  const started = post(api, "/api/start", { seed: 777, players: [{ id: "p1", name: "Alpha" }] });
  assert.equal(started.status, 200);
  return api;
}

function command(api: Api, body: Record<string, unknown>): GameApiResponse {
  return post(api, "/api/command", { command: body });
}

function assertRejected(response: GameApiResponse, error: string): void {
  assert.equal(response.status, 400);
  const payload = response.payload as { ok: boolean; error: string; message: string };
  assert.equal(payload.ok, false);
  assert.equal(payload.error, error);
  assert.equal(typeof payload.message, "string");
}

test("unknown set-target-mode values are rejected instead of becoming first", () => {
  const api = startedApi();
  assertRejected(command(api, { type: "set-target-mode", playerId: "p1", towerId: "tower-p1", mode: "furthest" }), "invalid-command");
  assertRejected(command(api, { type: "set-target-mode", playerId: "p1", towerId: "tower-p1" }), "invalid-command");
});

test("place-tower and place-wall reject non-integer or non-finite coordinates", () => {
  const api = startedApi();
  for (const type of ["place-tower", "place-wall"]) {
    for (const bad of [Number.NaN, Infinity, 1.5, "3", null, undefined]) {
      assertRejected(command(api, { type, playerId: "p1", x: bad, y: 3 }), "invalid-coordinates");
      assertRejected(command(api, { type, playerId: "p1", x: 3, y: bad }), "invalid-coordinates");
    }
  }
});

test("out-of-bounds coordinates come back as a machine-readable command rejection", () => {
  const api = startedApi();
  for (const [x, y] of [[-1, 0], [0, -1], [50, 0], [0, 50], [9999, 9999]]) {
    const response = command(api, { type: "place-tower", playerId: "p1", x, y });
    assert.equal(response.status, 200);
    const result = (response.payload as { result: { accepted: boolean; reason?: string } }).result;
    assert.deepEqual(result, { accepted: false, reason: "out-of-bounds" });
  }
});

test("a missing or unsupported command is rejected with invalid-command", () => {
  const api = startedApi();
  assertRejected(post(api, "/api/command", {}), "invalid-command");
  assertRejected(command(api, { type: "teleport" }), "invalid-command");
  assertRejected(command(api, { type: "upgrade-tower", playerId: 7, towerId: "tower-p1" }), "invalid-command");
});

test("upgrade-tower needs a known track", () => {
  const api = startedApi();
  for (const track of [undefined, "speed", 3, null]) {
    assertRejected(command(api, { type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track }), "invalid-command");
  }
  const response = command(api, { type: "upgrade-tower", playerId: "p1", towerId: "tower-p1", track: "range" });
  assert.equal(response.status, 200);
});

test("duplicate player ids are rejected", () => {
  const api = createGameApi();
  assertRejected(
    post(api, "/api/start", { seed: 1, players: [{ id: "p1", name: "A" }, { id: "p1", name: "B" }] }),
    "invalid-setup"
  );
});

test("invalid player counts, non-object players and over-long names are rejected", () => {
  const api = createGameApi();
  assertRejected(post(api, "/api/start", { seed: 1, players: [] }), "invalid-setup");
  assertRejected(post(api, "/api/start", { seed: 1, players: ["p1"] }), "invalid-setup");
  assertRejected(
    post(api, "/api/start", { seed: 1, players: [{ id: "p1", name: "x".repeat(MAX_PLAYER_NAME_LENGTH + 1) }] }),
    "invalid-setup"
  );
  const ok = post(api, "/api/start", { seed: 1, players: [{ id: "p1", name: "x".repeat(MAX_PLAYER_NAME_LENGTH) }] });
  assert.equal(ok.status, 200);
});

test("a present seed must be a finite integer; a missing seed uses the default", () => {
  const players = [{ id: "p1", name: "Alpha" }];
  for (const seed of ["", "abc", "12", null, Number.NaN, Infinity, 1.5]) {
    assertRejected(post(createGameApi(), "/api/start", { seed, players }), "invalid-setup");
  }

  const defaulted = post(createGameApi(), "/api/start", { players });
  assert.equal(defaulted.status, 200);
  assert.equal((defaulted.payload as { setup: { seed: number } }).setup.seed, 777);
  assert.equal(post(createGameApi(), "/api/start", { seed: 0, players }).status, 200);
});

test("validation errors never end the running match", () => {
  const api = startedApi();
  assertRejected(command(api, { type: "teleport" }), "invalid-command");
  const snapshot = api({ method: "GET", pathname: "/api/snapshot", searchParams: new URLSearchParams(), body: {} });
  assert.equal(snapshot.status, 200);
});
