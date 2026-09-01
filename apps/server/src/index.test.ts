import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";

const TEST_PORT = 4190;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

async function waitForServer(child: ChildProcess): Promise<void> {
  const maxAttempts = 200;
  const delayMs = 50;

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

async function postJson(path: string, payload: unknown): Promise<{ status: number; body: JsonResponse }> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: (await response.json()) as JsonResponse };
}

test("server start, snapshot, and command flow preserves rejection state", async () => {
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), PORT_MAX: String(TEST_PORT) },
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