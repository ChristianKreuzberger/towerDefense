import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import test from "node:test";

let TEST_PORT = 4190;
let SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

async function findOpenPort(startPort = 4190, endPort = 4299): Promise<number> {
  for (let port = startPort; port <= endPort; port += 1) {
    const probe = await new Promise<boolean>((resolve) => {
      const server = createNetServer();

      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });

    if (probe) {
      return port;
    }
  }

  throw new Error(`no open test port found in range ${startPort}-${endPort}`);
}

async function waitForServer(child: ChildProcess): Promise<void> {
  const maxAttempts = 600;
  const delayMs = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before becoming ready with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${SERVER_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server may still be binding its configured port.
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`server did not become ready within ${(maxAttempts * delayMs) / 1000} seconds`);
}

type JsonResponse = {
  ok?: boolean;
  snapshot?: {
    phase?: string;
    map?: {
      cells?: Array<{ buildable: boolean; x: number; y: number }>;
    };
    players?: Array<{ id: string; name: string }>;
    towers?: Array<unknown>;
  };
  result?: {
    accepted?: boolean;
    reason?: string;
  };
};

const runServerSmokeTest = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true" ? test.skip : test;

async function postJson(path: string, payload: unknown): Promise<{ status: number; body: JsonResponse }> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: (await response.json()) as JsonResponse };
}

runServerSmokeTest("server start, snapshot, and command flow preserves rejection state", async () => {
  TEST_PORT = await findOpenPort();
  SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), PORT_MAX: String(TEST_PORT + 20) },
    stdio: "ignore"
  });

  try {
    await waitForServer(child);

    const start = await postJson("/api/start", {
      seed: 777,
      players: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Bravo" }
      ]
    });
    assert.equal(start.status, 200);
    assert.equal(start.body.ok, true);

    const startSnapshot = start.body.snapshot;
    if (!startSnapshot) {
      throw new Error("expected start snapshot");
    }
    assert.equal(startSnapshot.phase, "placement");
    assert.ok(startSnapshot.phase, "expected start phase");
    if (!startSnapshot.map) {
      throw new Error("expected start map");
    }
    if (!startSnapshot.map.cells) {
      throw new Error("expected start map cells");
    }
    const buildableCell = startSnapshot.map.cells.find((cell) => cell.buildable);
    assert.ok(buildableCell, "expected a buildable cell in the start snapshot");

    const snapshotResponse = await fetch(`${SERVER_URL}/api/snapshot`);
    const snapshotBody = (await snapshotResponse.json()) as { snapshot: { players: Array<{ id: string }> } };
    assert.equal(snapshotResponse.status, 200);
    assert.equal(snapshotBody.snapshot.players.length, 2);

    const placement = await postJson("/api/command", {
      command: {
        type: "place-tower",
        playerId: "p1",
        x: buildableCell.x,
        y: buildableCell.y
      }
    });
    assert.equal(placement.status, 200);
    const placementResult = placement.body.result;
    if (!placementResult) {
      throw new Error("expected placement result");
    }
    assert.equal(placementResult.accepted, true);
    const placedSnapshot = placement.body.snapshot;
    if (!placedSnapshot) {
      throw new Error("expected placed snapshot");
    }
    if (!placedSnapshot.towers) {
      throw new Error("expected placed towers");
    }
    assert.equal(placedSnapshot.towers.length, 1);

    const duplicatePlacement = await postJson("/api/command", {
      command: {
        type: "place-tower",
        playerId: "p1",
        x: buildableCell.x,
        y: buildableCell.y
      }
    });
    assert.equal(duplicatePlacement.status, 200);
    const duplicateResult = duplicatePlacement.body.result;
    if (!duplicateResult) {
      throw new Error("expected duplicate placement result");
    }
    assert.equal(duplicateResult.accepted, false);
    assert.equal(duplicateResult.reason, "tower-already-placed");
    const duplicateSnapshot = duplicatePlacement.body.snapshot;
    if (!duplicateSnapshot) {
      throw new Error("expected duplicate snapshot");
    }
    assert.equal(duplicateSnapshot.phase, "placement");
    if (!duplicateSnapshot.towers) {
      throw new Error("expected duplicate towers");
    }
    assert.equal(duplicateSnapshot.towers.length, 1);
  } finally {
    child.kill();
  }
});
type LiteSnapshot = {
  map?: { cells?: unknown[]; wornCells?: unknown[]; width?: number };
  events?: unknown[];
  eventsOffset?: number;
  eventsTotal?: number;
  balanceAnalysisExports?: unknown[];
  towers?: unknown[];
};

runServerSmokeTest("lite snapshots omit map cells and return only new events", async () => {
  TEST_PORT = await findOpenPort();
  SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), PORT_MAX: String(TEST_PORT + 20) },
    stdio: "ignore"
  });

  try {
    await waitForServer(child);
    const start = await postJson("/api/start", { seed: 777, players: [{ id: "p1", name: "Alpha" }] });
    const cells = start.body.snapshot?.map?.cells ?? [];
    const buildable = cells.find((cell) => cell.buildable);
    assert.ok(buildable);
    await postJson("/api/command", { command: { type: "place-tower", playerId: "p1", x: buildable.x, y: buildable.y } });
    await postJson("/api/command", { command: { type: "ready-for-wave", playerId: "p1" } });
    await postJson("/api/advance-many", { ticks: 2 });

    const full = (await (await fetch(`${SERVER_URL}/api/snapshot`)).json()) as { snapshot: LiteSnapshot };
    assert.ok((full.snapshot.map?.cells?.length ?? 0) > 0, "full snapshot keeps map cells");
    const total = full.snapshot.events?.length ?? 0;
    assert.ok(total > 0);

    const lite = (await (await fetch(`${SERVER_URL}/api/snapshot?lite=1&eventsSince=${total - 1}`)).json()) as {
      snapshot: LiteSnapshot;
    };
    assert.equal(lite.snapshot.map?.cells, undefined);
    assert.ok(Array.isArray(lite.snapshot.map?.wornCells));
    assert.equal(lite.snapshot.map?.width, full.snapshot.map?.width);
    assert.equal(lite.snapshot.events?.length, 1);
    assert.equal(lite.snapshot.eventsOffset, total - 1);
    assert.equal(lite.snapshot.eventsTotal, total);
    assert.deepEqual(lite.snapshot.balanceAnalysisExports, []);
    assert.equal(lite.snapshot.towers?.length, 1);

    const viaCommand = await postJson("/api/command", {
      lite: true,
      eventsSince: total,
      command: { type: "advance-wave" }
    });
    const commandSnapshot = viaCommand.body.snapshot as LiteSnapshot | undefined;
    assert.equal(commandSnapshot?.map?.cells, undefined);
    assert.equal(commandSnapshot?.eventsOffset, total);

    const advanced = await postJson("/api/advance-many", { ticks: 2, lite: true, eventsSince: 0 });
    const advancedSnapshot = advanced.body.snapshot as LiteSnapshot | undefined;
    assert.equal(advancedSnapshot?.map?.cells, undefined);
    assert.equal(advancedSnapshot?.eventsOffset, 0);
  } finally {
    child.kill();
  }
});

type ErrorBody = { ok?: boolean; error?: string; message?: string };

async function withServer(run: () => Promise<void>): Promise<void> {
  TEST_PORT = await findOpenPort();
  SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), PORT_MAX: String(TEST_PORT + 20) },
    stdio: "ignore"
  });
  try {
    await waitForServer(child);
    await run();
  } finally {
    child.kill();
  }
}

async function postRaw(path: string, body: string): Promise<{ status: number; body: ErrorBody }> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  return { status: response.status, body: (await response.json()) as ErrorBody };
}

function assertRejected(result: { status: number; body: ErrorBody }, error: string): void {
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, error);
  assert.equal(typeof result.body.message, "string");
}

const twoPlayers = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Bravo" }
];

runServerSmokeTest("malformed JSON is rejected with invalid-json", async () => {
  await withServer(async () => {
    assertRejected(await postRaw("/api/start", "{not json"), "invalid-json");
  });
});

runServerSmokeTest("start rejects duplicate player ids and bad seeds", async () => {
  await withServer(async () => {
    assertRejected(
      await postJson("/api/start", { players: [{ id: "p1", name: "A" }, { id: "p1", name: "B" }] }),
      "invalid-setup"
    );

    for (const seed of [null, "abc", 1.5, ""]) {
      assertRejected(await postRaw("/api/start", JSON.stringify({ seed, players: twoPlayers })), "invalid-seed");
    }
    assertRejected(await postRaw("/api/start", '{"seed":1e999,"players":[{"id":"p1"}]}'), "invalid-seed");
    assertRejected(await postJson("/api/start", { players: [] }), "invalid-setup");

    const defaulted = await postJson("/api/start", { players: twoPlayers });
    assert.equal(defaulted.status, 200);
  });
});

runServerSmokeTest("commands reject bad coordinates, target modes and payloads", async () => {
  await withServer(async () => {
    const start = await postJson("/api/start", { seed: 777, players: twoPlayers });
    const width = (start.body.snapshot?.map as { width?: number } | undefined)?.width ?? 0;
    assert.ok(width > 0);

    const bad: Array<Record<string, unknown>> = [
      { x: 1.5, y: 2 },
      { x: "3", y: 2 },
      { x: null, y: 2 },
      { x: 2 },
      { x: -1, y: 2 },
      { x: width, y: 0 },
      { x: 0, y: 100000 }
    ];
    for (const type of ["place-tower", "place-wall"]) {
      for (const coords of bad) {
        const result = await postJson("/api/command", { command: { type, playerId: "p1", ...coords } });
        assertRejected(result, "invalid-coordinates");
      }
    }

    assertRejected(
      await postJson("/api/command", { command: { type: "set-target-mode", playerId: "p1", towerId: "t", mode: "bogus" } }),
      "invalid-target-mode"
    );
    assertRejected(
      await postJson("/api/command", { command: { type: "set-target-mode", playerId: "p1", towerId: "t" } }),
      "invalid-target-mode"
    );
    assertRejected(await postJson("/api/command", { command: { type: "explode" } }), "invalid-command");
    assertRejected(await postJson("/api/command", {}), "invalid-command");
    assertRejected(await postRaw("/api/command", "nope"), "invalid-json");
  });
});

runServerSmokeTest("CORS headers are sent and OPTIONS preflight succeeds", async () => {
  await withServer(async () => {
    const preflight = await fetch(`${SERVER_URL}/api/command`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /Content-Type/i);

    const health = await fetch(`${SERVER_URL}/health`);
    assert.equal(health.headers.get("access-control-allow-origin"), "*");
    const error = await fetch(`${SERVER_URL}/api/snapshot`);
    assert.equal(error.headers.get("access-control-allow-origin"), "*");
  });
});
