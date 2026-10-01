import assert from "node:assert/strict";
import test from "node:test";
import { createFetchRequester, createGameClient, type GameRequester } from "./http-client.js";

test("fetch requester joins base url and path and posts JSON", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push(init ? { url, init } : { url });
    return { ok: true, text: async () => "{\"ok\":true}" };
  }) as unknown as typeof fetch;
  const request = createFetchRequester("http://host/", fakeFetch);

  await request("GET", "/api/snapshot");
  await request("POST", "/api/start", { seed: 1 });

  assert.equal(calls[0]?.url, "http://host/api/snapshot");
  assert.equal(calls[0]?.init, undefined);
  assert.equal(calls[1]?.url, "http://host/api/start");
  assert.equal(calls[1]?.init?.method, "POST");
  assert.equal(calls[1]?.init?.body, "{\"seed\":1}");
});

test("game client parses JSON and reports response text", async () => {
  const seen: string[] = [];
  const request: GameRequester = async () => ({ ok: true, text: "{\"ok\":true,\"value\":3}" });
  const client = createGameClient(request, { onResponseText: (text) => seen.push(text) });
  const data = await client.get<{ value: number }>("/x");
  assert.equal(data.value, 3);
  assert.equal(seen.length, 1);
});

test("game client throws the host message for failed responses", async () => {
  const failing = createGameClient(async () => ({ ok: false, text: "{\"ok\":false,\"error\":\"bad\",\"message\":\"nope\"}" }));
  await assert.rejects(() => failing.post("/x", {}), /nope/);
  const softFail = createGameClient(async () => ({ ok: true, text: "{\"ok\":false,\"error\":\"bad\"}" }));
  await assert.rejects(() => softFail.get("/x"), /bad/);
  const unnamed = createGameClient(async () => ({ ok: false, text: "{}" }));
  await assert.rejects(() => unnamed.get("/x"), /request-failed/);
});
