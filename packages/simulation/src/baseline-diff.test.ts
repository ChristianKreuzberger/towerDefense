import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { extractBalanceAnalysisSnapshots } from "./balance-report.js";
import {
  diffBaselineArtifacts,
  formatBaselineDiffSummary,
  type BaselineArtifacts,
  type BaselineScenarioArtifacts
} from "./baseline-diff.js";

interface FixtureScenario {
  scenarioId: string;
  envelope: unknown;
  reportText: string;
}

interface DiffFixture {
  baseline: { scenarios: FixtureScenario[] };
  candidate: { scenarios: FixtureScenario[] };
}

function readFixture(name: string): DiffFixture {
  const filePath = resolve(process.cwd(), "src", "__fixtures__", name);
  const text = readFileSync(filePath, "utf8");
  return JSON.parse(text) as DiffFixture;
}

function buildScenarios(scenarios: FixtureScenario[]): BaselineScenarioArtifacts[] {
  return scenarios.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    snapshots: extractBalanceAnalysisSnapshots(scenario.envelope),
    reportText: scenario.reportText
  }));
}

function buildArtifacts(rootDir: string, scenarios: FixtureScenario[]): BaselineArtifacts {
  return {
    rootDir,
    scenarios: buildScenarios(scenarios)
  };
}

test("baseline diff passes when baseline and candidate artifacts are equivalent", () => {
  const fixture = readFixture("baseline-diff.pass.fixture.json");
  const baseline = buildArtifacts("/baseline", fixture.baseline.scenarios);
  const candidate = buildArtifacts("/candidate", fixture.candidate.scenarios);

  const result = diffBaselineArtifacts(baseline, candidate);
  assert.equal(result.pass, true);
  assert.equal(result.summary.scenariosCompared, 2);
  assert.equal(result.summary.scenariosWithDrift, 0);
  assert.equal(result.summary.driftCount, 0);
  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.scenarioId),
    ["scenario-a", "scenario-b"]
  );
});

test("baseline diff fails with deterministic scenario and metric drift ordering", () => {
  const fixture = readFixture("baseline-diff.fail.fixture.json");
  const baseline = buildArtifacts("/baseline", fixture.baseline.scenarios);
  const candidate = buildArtifacts("/candidate", fixture.candidate.scenarios);

  const result = diffBaselineArtifacts(baseline, candidate);
  assert.equal(result.pass, false);
  assert.equal(result.summary.scenariosCompared, 3);
  assert.equal(result.summary.scenariosWithDrift, 3);
  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.scenarioId),
    ["scenario-a", "scenario-m", "scenario-z"]
  );

  const scenarioA = result.scenarios.find((scenario) => scenario.scenarioId === "scenario-a");
  assert.ok(scenarioA);
  assert.equal(scenarioA.status, "fail");
  assert.ok(scenarioA.driftCount >= 2);
  assert.equal(scenarioA.drifts[0]?.path, "metrics.cumulative.dpsProxy");
  assert.equal(scenarioA.drifts[1]?.path, "metrics.cumulative.towerDamageDealt");

  const scenarioM = result.scenarios.find((scenario) => scenario.scenarioId === "scenario-m");
  assert.ok(scenarioM);
  assert.equal(scenarioM.status, "fail");
  assert.deepEqual(scenarioM.drifts[0], {
    kind: "scenario",
    path: "scenario",
    baseline: "missing",
    candidate: "present"
  });

  const scenarioZ = result.scenarios.find((scenario) => scenario.scenarioId === "scenario-z");
  assert.ok(scenarioZ);
  assert.equal(scenarioZ.status, "fail");
  assert.deepEqual(scenarioZ.drifts[0], {
    kind: "scenario",
    path: "scenario",
    baseline: "present",
    candidate: "missing"
  });
});

test("formats summary text in a deterministic and human-readable shape", () => {
  const fixture = readFixture("baseline-diff.fail.fixture.json");
  const baseline = buildArtifacts("/baseline", fixture.baseline.scenarios);
  const candidate = buildArtifacts("/candidate", fixture.candidate.scenarios);
  const result = diffBaselineArtifacts(baseline, candidate);
  const summary = formatBaselineDiffSummary(result);

  assert.ok(summary.startsWith("Tower Defense Baseline Drift Summary\n"));
  assert.ok(summary.includes("result=FAIL"));

  const scenarioAHeader = summary.indexOf("=== Scenario scenario-a ===");
  const scenarioMHeader = summary.indexOf("=== Scenario scenario-m ===");
  const scenarioZHeader = summary.indexOf("=== Scenario scenario-z ===");
  assert.ok(scenarioAHeader >= 0);
  assert.ok(scenarioMHeader > scenarioAHeader);
  assert.ok(scenarioZHeader > scenarioMHeader);

  assert.ok(
    summary.includes("- [metric] metrics.cumulative.dpsProxy: baseline=2 candidate=2.25"),
    "expected metric drift in summary"
  );
  assert.ok(
    summary.includes("- [scenario] scenario: baseline=missing candidate=present"),
    "expected added scenario drift in summary"
  );
});
