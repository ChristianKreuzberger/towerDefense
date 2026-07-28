import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  BalanceAnalysisPlayerSnapshot,
  BalanceAnalysisSnapshot,
  TelemetryKillsByArchetype,
  WaveTelemetrySnapshot
} from "@tower-defense/shared";

import { deriveBalanceReport, extractBalanceAnalysisSnapshots, type BalanceReport } from "./balance-report.js";

export interface BaselineScenarioArtifacts {
  scenarioId: string;
  snapshots: BalanceAnalysisSnapshot[];
  reportText?: string;
}

export interface BaselineArtifacts {
  rootDir: string;
  scenarios: BaselineScenarioArtifacts[];
}

export interface BaselineDiffEntry {
  kind: "metric" | "report" | "scenario";
  path: string;
  baseline: unknown;
  candidate: unknown;
}

export interface BaselineScenarioDiff {
  scenarioId: string;
  status: "pass" | "fail";
  driftCount: number;
  drifts: BaselineDiffEntry[];
}

export interface BaselineDiffResult {
  schemaVersion: 1;
  pass: boolean;
  summary: {
    scenariosCompared: number;
    scenariosWithDrift: number;
    driftCount: number;
  };
  scenarios: BaselineScenarioDiff[];
}

interface ComparableWaveSummary {
  wave: number;
  exportOrdinal: number;
  tick: number;
  dpsProxy: number;
  waveTelemetry: WaveTelemetrySnapshot;
  players: BalanceAnalysisPlayerSnapshot[];
  totals: BalanceAnalysisSnapshot["totals"];
}

interface ComparableScenarioMetrics {
  schemaVersion: 1;
  matchSeed: number;
  snapshots: number;
  cumulative: BalanceReport["cumulative"];
  waveSummaries: ComparableWaveSummary[];
}

function compareScenarioOrder(a: BaselineScenarioArtifacts, b: BaselineScenarioArtifacts): number {
  return a.scenarioId.localeCompare(b.scenarioId);
}

function readOptionalText(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function roundDps(value: number): number {
  return Number(value.toFixed(6));
}

function cloneKills(kills: TelemetryKillsByArchetype): TelemetryKillsByArchetype {
  return {
    runner: kills.runner,
    swarm: kills.swarm,
    armored: kills.armored,
    tank: kills.tank
  };
}

function cloneWaveTelemetry(snapshot: WaveTelemetrySnapshot): WaveTelemetrySnapshot {
  return {
    ...snapshot,
    killsByArchetype: cloneKills(snapshot.killsByArchetype)
  };
}

function toComparableScenarioMetrics(snapshots: BalanceAnalysisSnapshot[]): ComparableScenarioMetrics {
  const report = deriveBalanceReport(snapshots);
  return {
    schemaVersion: 1,
    matchSeed: report.matchSeed,
    snapshots: report.snapshots.length,
    cumulative: {
      ...report.cumulative,
      dpsProxy: roundDps(report.cumulative.dpsProxy),
      killsByArchetype: cloneKills(report.cumulative.killsByArchetype),
      players: report.cumulative.players.map((player) => ({ ...player }))
    },
    waveSummaries: report.waveSummaries.map((wave) => ({
      wave: wave.wave,
      exportOrdinal: wave.exportOrdinal,
      tick: wave.tick,
      dpsProxy: roundDps(wave.dpsProxy),
      waveTelemetry: cloneWaveTelemetry(wave.waveTelemetry),
      players: wave.players.map((player) => ({ ...player })),
      totals: { ...wave.totals }
    }))
  };
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, entry]) => [key, sortObjectKeys(entry)]);
  return Object.fromEntries(entries);
}

function collectDiffs(path: string, baseline: unknown, candidate: unknown, drifts: BaselineDiffEntry[]): void {
  if (Object.is(baseline, candidate)) {
    return;
  }

  if (Array.isArray(baseline) || Array.isArray(candidate)) {
    if (!Array.isArray(baseline) || !Array.isArray(candidate)) {
      drifts.push({
        kind: "metric",
        path,
        baseline,
        candidate
      });
      return;
    }

    if (baseline.length !== candidate.length) {
      drifts.push({
        kind: "metric",
        path: `${path}.length`,
        baseline: baseline.length,
        candidate: candidate.length
      });
    }

    const length = Math.max(baseline.length, candidate.length);
    for (let index = 0; index < length; index += 1) {
      collectDiffs(`${path}[${index}]`, baseline[index], candidate[index], drifts);
    }
    return;
  }

  if (
    baseline &&
    candidate &&
    typeof baseline === "object" &&
    typeof candidate === "object"
  ) {
    const baselineRecord = baseline as Record<string, unknown>;
    const candidateRecord = candidate as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(baselineRecord), ...Object.keys(candidateRecord)])].sort((a, b) =>
      a.localeCompare(b)
    );

    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      collectDiffs(childPath, baselineRecord[key], candidateRecord[key], drifts);
    }
    return;
  }

  drifts.push({
    kind: "metric",
    path,
    baseline,
    candidate
  });
}

function createScenarioMap(artifacts: BaselineArtifacts): Map<string, BaselineScenarioArtifacts> {
  const map = new Map<string, BaselineScenarioArtifacts>();
  for (const scenario of artifacts.scenarios) {
    map.set(scenario.scenarioId, scenario);
  }
  return map;
}

export function loadBaselineArtifacts(rootDir: string): BaselineArtifacts {
  const resolvedRoot = resolve(process.cwd(), rootDir);
  const inputDir = resolve(resolvedRoot, "inputs");
  const reportDir = resolve(resolvedRoot, "reports");

  const entries = readdirSync(inputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".snapshots.json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const scenarios = entries.map((fileName) => {
    const scenarioId = fileName.slice(0, -".snapshots.json".length);
    const snapshotFile = resolve(inputDir, fileName);
    const reportFile = resolve(reportDir, `${scenarioId}.report.txt`);
    const raw = JSON.parse(readFileSync(snapshotFile, "utf8")) as unknown;
    const snapshots = extractBalanceAnalysisSnapshots(raw);
    const reportText = readOptionalText(reportFile);
    return {
      scenarioId,
      snapshots,
      ...(typeof reportText === "string" ? { reportText } : {})
    };
  });

  return {
    rootDir: resolvedRoot,
    scenarios: scenarios.sort(compareScenarioOrder)
  };
}

export function diffBaselineArtifacts(
  baselineArtifacts: BaselineArtifacts,
  candidateArtifacts: BaselineArtifacts
): BaselineDiffResult {
  const baselineMap = createScenarioMap(baselineArtifacts);
  const candidateMap = createScenarioMap(candidateArtifacts);
  const scenarioIds = [...new Set([...baselineMap.keys(), ...candidateMap.keys()])].sort((a, b) => a.localeCompare(b));

  const scenarios: BaselineScenarioDiff[] = scenarioIds.map((scenarioId) => {
    const baseline = baselineMap.get(scenarioId);
    const candidate = candidateMap.get(scenarioId);
    const drifts: BaselineDiffEntry[] = [];

    if (!baseline) {
      drifts.push({
        kind: "scenario",
        path: "scenario",
        baseline: "missing",
        candidate: "present"
      });
    }

    if (!candidate) {
      drifts.push({
        kind: "scenario",
        path: "scenario",
        baseline: "present",
        candidate: "missing"
      });
    }

    if (baseline && candidate) {
      const baselineMetrics = sortObjectKeys(toComparableScenarioMetrics(baseline.snapshots));
      const candidateMetrics = sortObjectKeys(toComparableScenarioMetrics(candidate.snapshots));
      collectDiffs("metrics", baselineMetrics, candidateMetrics, drifts);

      if (typeof baseline.reportText === "string" && typeof candidate.reportText === "string") {
        if (baseline.reportText !== candidate.reportText) {
          drifts.push({
            kind: "report",
            path: "reportText",
            baseline: baseline.reportText,
            candidate: candidate.reportText
          });
        }
      }
    }

    drifts.sort((a, b) => {
      return a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind);
    });

    return {
      scenarioId,
      status: drifts.length > 0 ? "fail" : "pass",
      driftCount: drifts.length,
      drifts
    };
  });

  const scenariosWithDrift = scenarios.filter((scenario) => scenario.status === "fail").length;
  const driftCount = scenarios.reduce((sum, scenario) => sum + scenario.driftCount, 0);
  return {
    schemaVersion: 1,
    pass: scenariosWithDrift === 0,
    summary: {
      scenariosCompared: scenarios.length,
      scenariosWithDrift,
      driftCount
    },
    scenarios
  };
}

function formatDriftValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null || typeof value === "undefined") {
    return String(value);
  }

  return JSON.stringify(value);
}

export function formatBaselineDiffSummary(result: BaselineDiffResult): string {
  const lines: string[] = [];
  lines.push("Tower Defense Baseline Drift Summary");
  lines.push(`schemaVersion=${result.schemaVersion}`);
  lines.push(`result=${result.pass ? "PASS" : "FAIL"}`);
  lines.push(`scenariosCompared=${result.summary.scenariosCompared}`);
  lines.push(`scenariosWithDrift=${result.summary.scenariosWithDrift}`);
  lines.push(`driftCount=${result.summary.driftCount}`);
  lines.push("");

  for (const scenario of result.scenarios) {
    lines.push(`=== Scenario ${scenario.scenarioId} ===`);
    lines.push(`status=${scenario.status.toUpperCase()} driftCount=${scenario.driftCount}`);
    if (scenario.drifts.length === 0) {
      lines.push("No drift.");
    } else {
      for (const drift of scenario.drifts) {
        lines.push(
          `- [${drift.kind}] ${drift.path}: baseline=${formatDriftValue(drift.baseline)} candidate=${formatDriftValue(drift.candidate)}`
        );
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
