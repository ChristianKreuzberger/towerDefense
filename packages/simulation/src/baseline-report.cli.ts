import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getTowerUpgradeCost,
  getWallCost,
  isValidWallPlacement,
  type SimulationCommand,
  type TowerTargetMode
} from "@tower-defense/shared";

import { formatBalanceReport, deriveBalanceReport } from "./balance-report.js";
import { createMatch } from "./match-simulation.js";

interface BaselineScenario {
  id: string;
  description: string;
  seed: number;
  players: Array<{ id: string; name: string }>;
  waveLoop: {
    completedWaves: number;
    maxAdvanceSteps: number;
  };
  waveStartActions?: Record<number, WaveStartAction[]>;
}

type WaveStartAction =
  | { type: "place-wall"; playerId: string }
  | { type: "upgrade-tower"; playerId: string }
  | { type: "set-target-mode"; playerId: string; mode: TowerTargetMode };

interface CliArgs {
  outputDir: string;
  printSummary: boolean;
}

interface ScenarioResult {
  id: string;
  seed: number;
  players: number;
  snapshotsPath: string;
  reportPath: string;
  exports: number;
}

const BASELINE_SCENARIOS: BaselineScenario[] = [
  {
    id: "solo_seed-777_wave2",
    description: "Single player, two deterministic waves from fixed seed",
    seed: 777,
    players: [{ id: "p1", name: "Alpha" }],
    waveLoop: {
      completedWaves: 2,
      maxAdvanceSteps: 200
    }
  },
  {
    id: "duo_seed-19_wave2",
    description: "Two players, deterministic wall/upgrade commands between waves",
    seed: 19,
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" }
    ],
    waveLoop: {
      completedWaves: 2,
      maxAdvanceSteps: 260
    },
    waveStartActions: {
      2: [
        { type: "place-wall", playerId: "p1" },
        { type: "upgrade-tower", playerId: "p2" }
      ]
    }
  },
  {
    id: "trio_seed-2024_wave3",
    description: "Three players, three waves with target-mode and wall placements",
    seed: 2024,
    players: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
      { id: "p3", name: "Gamma" }
    ],
    waveLoop: {
      completedWaves: 3,
      maxAdvanceSteps: 360
    },
    waveStartActions: {
      2: [
        { type: "place-wall", playerId: "p1" },
        { type: "set-target-mode", playerId: "p2", mode: "strongest" }
      ],
      3: [
        { type: "place-wall", playerId: "p3" },
        { type: "upgrade-tower", playerId: "p1" }
      ]
    }
  }
];

function usage(): string {
  return [
    "Deterministic baseline capture utility",
    "Usage:",
    "  node dist/baseline-report.cli.js",
    "  node dist/baseline-report.cli.js --output <dir>",
    "  node dist/baseline-report.cli.js --stdout",
    "",
    "Outputs (per scenario):",
    "  - <output>/inputs/<scenario-id>.snapshots.json",
    "  - <output>/reports/<scenario-id>.report.txt"
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let outputDir = "artifacts/baselines/balance";
  let printSummary = false;

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === "--output" || token === "-o") {
      const value = args.shift();
      if (!value) {
        throw new Error("missing value for --output");
      }

      outputDir = value;
      continue;
    }

    if (token === "--stdout") {
      printSummary = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      throw new Error("help");
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return { outputDir, printSummary };
}

function applyCommandOrThrow(
  simulation: ReturnType<typeof createMatch>,
  command: SimulationCommand,
  context: string
): void {
  const result = simulation.applyCommand(command);
  if (!result.accepted) {
    const reason = result.reason ?? "unknown-reason";
    throw new Error(`command rejected during ${context}: ${command.type} (${reason})`);
  }
}

function placeTowersDeterministically(simulation: ReturnType<typeof createMatch>, scenarioId: string): void {
  const players = simulation.getSnapshot().players
    .filter((player) => !player.eliminated)
    .map((player) => player.id)
    .sort((a, b) => a.localeCompare(b));

  for (const playerId of players) {
    const snapshot = simulation.getSnapshot();
    const available = snapshot.map.cells
      .filter((cell) => cell.buildable)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));

    let placed = false;
    for (const cell of available) {
      const result = simulation.applyCommand({
        type: "place-tower",
        playerId,
        x: cell.x,
        y: cell.y
      });
      if (result.accepted) {
        placed = true;
        break;
      }
    }

    if (!placed) {
      throw new Error(`could not place tower for ${playerId} in scenario ${scenarioId}`);
    }
  }
}

function placeWallDeterministically(
  simulation: ReturnType<typeof createMatch>,
  playerId: string,
  scenarioId: string,
  wave: number
): void {
  const snapshot = simulation.getSnapshot();
  const player = snapshot.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`unknown player ${playerId} in scenario ${scenarioId}`);
  }

  const wallCost = getWallCost(snapshot.walls.length);
  if (player.points < wallCost) {
    simulation.awardPoints(playerId, wallCost - player.points);
  }

  const afterTopUp = simulation.getSnapshot();
  const available = afterTopUp.map.cells
    .filter((cell) => cell.buildable)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));

  for (const cell of available) {
    const validation = isValidWallPlacement(
      { playerId, x: cell.x, y: cell.y },
      afterTopUp.walls,
      afterTopUp.towers,
      afterTopUp.map
    );
    if (!validation.valid) {
      continue;
    }

    const result = simulation.applyCommand({
      type: "place-wall",
      playerId,
      x: cell.x,
      y: cell.y
    });
    if (result.accepted) {
      return;
    }
  }

  throw new Error(`could not place wall for ${playerId} in scenario ${scenarioId} wave ${wave}`);
}

function readyAllPlacedPlayers(simulation: ReturnType<typeof createMatch>, scenarioId: string, wave: number): void {
  const snapshot = simulation.getSnapshot();
  for (const player of snapshot.players
    .filter((entry) => !entry.eliminated && entry.hasPlacedTower && !entry.readyForWave)
    .sort((a, b) => a.id.localeCompare(b.id))) {
    applyCommandOrThrow(
      simulation,
      { type: "ready-for-wave", playerId: player.id },
      `${scenarioId}:wave-${wave}:ready-all`
    );
  }
}

function applyWaveStartAction(
  simulation: ReturnType<typeof createMatch>,
  action: WaveStartAction,
  scenarioId: string,
  wave: number
): void {
  if (action.type === "place-wall") {
    placeWallDeterministically(simulation, action.playerId, scenarioId, wave);
    return;
  }

  if (action.type === "upgrade-tower") {
    const snapshot = simulation.getSnapshot();
    const player = snapshot.players.find((entry) => entry.id === action.playerId);
    const tower = snapshot.towers.find((entry) => entry.playerId === action.playerId);
    if (!player || !tower) {
      throw new Error(`missing tower/player for upgrade in scenario ${scenarioId} wave ${wave}`);
    }

    const upgradeCost = getTowerUpgradeCost(tower.level);
    if (player.points < upgradeCost) {
      simulation.awardPoints(action.playerId, upgradeCost - player.points);
    }

    applyCommandOrThrow(
      simulation,
      { type: "upgrade-tower", playerId: action.playerId, towerId: `tower-${action.playerId}` },
      `${scenarioId}:wave-${wave}:upgrade-tower`
    );
    return;
  }

  applyCommandOrThrow(
    simulation,
    {
      type: "set-target-mode",
      playerId: action.playerId,
      towerId: `tower-${action.playerId}`,
      mode: action.mode
    },
    `${scenarioId}:wave-${wave}:set-target-mode`
  );
}

function advanceCurrentWaveUntilComplete(
  simulation: ReturnType<typeof createMatch>,
  expectedCompletedWaves: number,
  maxAdvanceSteps: number,
  scenarioId: string
): void {
  let advanceSteps = 0;
  while (simulation.getSnapshot().telemetry.completedWaves.length < expectedCompletedWaves) {
    const snapshot = simulation.getSnapshot();
    if (snapshot.phase !== "wave") {
      throw new Error(`scenario ${scenarioId} left wave phase unexpectedly while advancing wave ${expectedCompletedWaves}`);
    }

    applyCommandOrThrow(simulation, { type: "advance-wave" }, `${scenarioId}:advance-wave`);
    advanceSteps += 1;
    if (advanceSteps > maxAdvanceSteps) {
      throw new Error(`scenario ${scenarioId} exceeded max advance steps (${maxAdvanceSteps})`);
    }
  }
}

function advanceUntilWaveComplete(
  simulation: ReturnType<typeof createMatch>,
  expectedCompletedWaves: number,
  maxAdvanceSteps: number,
  scenarioId: string
): void {
  let advanceSteps = 0;
  while (simulation.getSnapshot().telemetry.completedWaves.length < expectedCompletedWaves) {
    const snapshot = simulation.getSnapshot();

    if (snapshot.phase === "ended") {
      throw new Error(`scenario ${scenarioId} ended early before reaching ${expectedCompletedWaves} waves`);
    }

    if (snapshot.phase === "placement") {
      for (const player of snapshot.players) {
        if (player.eliminated || !player.hasPlacedTower || player.readyForWave) {
          continue;
        }

        applyCommandOrThrow(
          simulation,
          { type: "ready-for-wave", playerId: player.id },
          `${scenarioId}:auto-ready`
        );
      }
      continue;
    }

    applyCommandOrThrow(simulation, { type: "advance-wave" }, `${scenarioId}:advance-wave`);
    advanceSteps += 1;
    if (advanceSteps > maxAdvanceSteps) {
      throw new Error(`scenario ${scenarioId} exceeded max advance steps (${maxAdvanceSteps})`);
    }
  }
}

function runScenario(scenario: BaselineScenario, outputDir: string): ScenarioResult {
  const simulation = createMatch({
    players: scenario.players,
    seed: scenario.seed
  });

  placeTowersDeterministically(simulation, scenario.id);

  const maxWave = scenario.waveLoop.completedWaves;
  for (let wave = 1; wave <= maxWave; wave += 1) {
    if (simulation.getSnapshot().phase !== "wave") {
      readyAllPlacedPlayers(simulation, scenario.id, wave);
    }

    const activeSnapshot = simulation.getSnapshot();
    if (activeSnapshot.phase !== "wave") {
      throw new Error(`scenario ${scenario.id} failed to enter wave ${wave}`);
    }

    const waveActions = scenario.waveStartActions?.[wave] ?? [];
    for (const action of waveActions) {
      applyWaveStartAction(simulation, action, scenario.id, wave);
    }

    advanceCurrentWaveUntilComplete(simulation, wave, scenario.waveLoop.maxAdvanceSteps, scenario.id);
  }

  const snapshot = simulation.getSnapshot();
  const snapshots = snapshot.balanceAnalysisExports;
  if (snapshots.length !== scenario.waveLoop.completedWaves) {
    throw new Error(
      `scenario ${scenario.id} expected ${scenario.waveLoop.completedWaves} exports but got ${snapshots.length}`
    );
  }

  const envelope = {
    scenario: {
      id: scenario.id,
      description: scenario.description,
      seed: scenario.seed,
      players: scenario.players,
      completedWaves: scenario.waveLoop.completedWaves
    },
    balanceAnalysisExports: snapshots
  };

  const report = formatBalanceReport(deriveBalanceReport(snapshots));
  const outputRoot = resolve(process.cwd(), outputDir);
  const inputDir = resolve(outputRoot, "inputs");
  const reportDir = resolve(outputRoot, "reports");
  mkdirSync(inputDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });

  const snapshotsPath = resolve(inputDir, `${scenario.id}.snapshots.json`);
  const reportPath = resolve(reportDir, `${scenario.id}.report.txt`);
  writeFileSync(snapshotsPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, report, "utf8");

  return {
    id: scenario.id,
    seed: scenario.seed,
    players: scenario.players.length,
    snapshotsPath,
    reportPath,
    exports: snapshots.length
  };
}

function formatSummary(results: ScenarioResult[]): string {
  const lines = [
    "Deterministic balance baseline capture complete",
    `scenarios=${results.length}`
  ];

  for (const result of results) {
    lines.push(
      `- ${result.id}: seed=${result.seed} players=${result.players} exports=${result.exports}`
    );
    lines.push(`  snapshots=${result.snapshotsPath}`);
    lines.push(`  report=${result.reportPath}`);
  }

  return `${lines.join("\n")}\n`;
}

function main(argv: string[]): number {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown argument error";
    if (message === "help") {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }

    process.stderr.write(`Error: ${message}\n\n${usage()}\n`);
    return 1;
  }

  try {
    const results = BASELINE_SCENARIOS.map((scenario) => runScenario(scenario, args.outputDir));
    if (args.printSummary) {
      process.stdout.write(formatSummary(results));
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown execution error";
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
