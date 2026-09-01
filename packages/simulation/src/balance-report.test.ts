import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import type { BalanceAnalysisSnapshot } from "@tower-defense/shared";

import {
  deriveBalanceReport,
  extractBalanceAnalysisSnapshots,
  formatBalanceReport
} from "./balance-report.js";

function readFixture(): unknown {
  const filePath = resolve(
    process.cwd(),
    "src",
    "__fixtures__",
    "balance-analysis-snapshots.fixture.json"
  );
  const text = readFileSync(filePath, "utf8");
  return JSON.parse(text) as unknown;
}

test("extracts snapshots from fixture envelope deterministically", () => {
  const fixture = readFixture();
  const snapshots = extractBalanceAnalysisSnapshots(fixture);

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.wave, 2);
  assert.equal(snapshots[1]?.wave, 1);
});

test("derives report in deterministic wave and player order", () => {
  const snapshots = extractBalanceAnalysisSnapshots(readFixture());
  const report = deriveBalanceReport(snapshots);

  assert.equal(report.waveSummaries.length, 2);
  assert.equal(report.waveSummaries[0]?.wave, 1);
  assert.equal(report.waveSummaries[1]?.wave, 2);

  const wave1Players = report.waveSummaries[0]?.players ?? [];
  const wave2Players = report.waveSummaries[1]?.players ?? [];
  assert.deepEqual(
    wave1Players.map((player) => player.playerId),
    ["p1", "p2"]
  );
  assert.deepEqual(
    wave2Players.map((player) => player.playerId),
    ["p1", "p2"]
  );

  assert.equal(report.cumulative.wavesCompleted, 2);
  assert.equal(report.cumulative.totalTicks, 22);
  assert.equal(report.cumulative.towerDamageDealt, 55);
  assert.equal(report.cumulative.killsByArchetype.runner, 2);
  assert.equal(report.cumulative.killsByArchetype.tank, 1);
  assert.equal(report.cumulative.players[0]?.playerId, "p1");
  assert.equal(report.cumulative.players[1]?.playerId, "p2");
});

test("formats report with stable section ordering and key lines", () => {
  const snapshots = extractBalanceAnalysisSnapshots(readFixture());
  const report = deriveBalanceReport(snapshots);
  const output = formatBalanceReport(report);

  const wave1Header = output.indexOf("=== Wave 1 (export=1, tick=10) ===");
  const wave2Header = output.indexOf("=== Wave 2 (export=2, tick=12) ===");
  const cumulativeHeader = output.indexOf("=== Cumulative Summary ===");

  assert.ok(wave1Header >= 0, "expected wave 1 header");
  assert.ok(wave2Header > wave1Header, "expected wave 2 after wave 1");
  assert.ok(cumulativeHeader > wave2Header, "expected cumulative after wave sections");

  assert.ok(
    output.includes("DPS proxy: 2.50 dmg/tick (dealt=25, ticks=10)"),
    "expected wave 1 dps proxy line"
  );
  assert.ok(
    output.includes("DPS proxy: 2.50 dmg/tick (dealt=30, ticks=12)"),
    "expected wave 2 dps proxy line"
  );
  assert.ok(
    output.includes("DPS proxy: 2.50 dmg/tick (dealt=55, ticks=22)"),
    "expected cumulative dps proxy line"
  );

  assert.ok(
    output.includes("- p1 (Alpha) status=active delta=3 bonus=0 total=6 ending=6 towerLv=1 towerHp=94 walls=1 wallHp=12"),
    "expected deterministic p1 wave line"
  );
  assert.ok(
    output.includes("- p2 (Beta) status=eliminated delta=3 bonus=0 total=5 ending=5 towerLv=1 towerHp=0 walls=0 wallHp=0"),
    "expected deterministic elimination line"
  );
});

test("supports single snapshot object and snapshot array inputs", () => {
  const snapshots = extractBalanceAnalysisSnapshots(readFixture()) as BalanceAnalysisSnapshot[];
  const firstSnapshot = snapshots[0];
  assert.ok(firstSnapshot, "expected a first snapshot in fixture");

  const fromSingle = extractBalanceAnalysisSnapshots(firstSnapshot);
  const fromArray = extractBalanceAnalysisSnapshots([firstSnapshot]);

  assert.equal(fromSingle.length, 1);
  assert.equal(fromArray.length, 1);
  assert.equal(fromSingle[0]?.exportOrdinal, firstSnapshot.exportOrdinal);
  assert.equal(fromArray[0]?.exportOrdinal, firstSnapshot.exportOrdinal);
});
