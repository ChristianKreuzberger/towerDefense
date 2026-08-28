import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";

const TEST_PORT = 4190;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

async function waitForServer(child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
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

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("server did not become ready within one second");
}

async function postJson(path: string, payload: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
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
    assert.equal(start.body.snapshot.phase, "placement");

    const initialSnapshot = start.body.snapshot;
    const buildableCell = initialSnapshot.map.cells.find((cell: { buildable: boolean }) => cell.buildable);
    assert.ok(buildableCell, "expected a buildable cell in the start snapshot");

    const snapshotResponse = await fetch(`${SERVER_URL}/api/snapshot`);
    const snapshotBody = await snapshotResponse.json() as any;
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
    assert.equal(placement.body.result.accepted, true);
    assert.equal(placement.body.snapshot.towers.length, 1);

    const duplicatePlacement = await postJson("/api/command", {
      command: {
        type: "place-tower",
        playerId: "p1",
        x: buildableCell.x,
        y: buildableCell.y
      }
    });
    assert.equal(duplicatePlacement.status, 200);
    assert.equal(duplicatePlacement.body.result.accepted, false);
    assert.equal(duplicatePlacement.body.result.reason, "tower-already-placed");
    assert.equal(duplicatePlacement.body.snapshot.phase, "placement");
    assert.equal(duplicatePlacement.body.snapshot.towers.length, 1);
  } finally {
    child.kill();
  }
});