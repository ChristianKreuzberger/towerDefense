import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getTowerUpgradeCost,
  isInSpawnProtection,
  type SimulationCommand,
  type TowerTargetMode,
  type UpgradeTrack
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
  | { type: "upgrade-tower"; playerId: string; track: UpgradeTrack }
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
      maxAdvanceSteps: 400
    }
  },
  {
    id: "duo_seed-19_wave2",
    description: "Two players, deterministic upgrade commands between waves",
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
        { type: "upgrade-tower", playerId: "p2", track: "range" },
        { type: "upgrade-tower", playerId: "p1", track: "accuracy" }
      ]
    }
  },
  {
    id: "trio_seed-2024_wave3",
    description: "Three players, three waves with target-mode and upgrade commands",
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
        { type: "set-target-mode", playerId: "p2", mode: "strongest" }
      ],
      3: [
        { type: "upgrade-tower", playerId: "p1", track: "damage" }
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

// Towers only go on tower spots, which sit a little off the road. Baseline towers take the spots whose nearest road
// cell is earliest along the creatures' walk, starting a few cells after the protected cave area (where creatures
// cannot be shot). Towers right at the edge of that area get overrun in wave 2 and eliminate players, so the baseline
// towers start further along. Changing the order shifts the balance baseline.
const LANE_CELLS_BEFORE_COVERAGE = 8;

// The lane runs from the cave to the east edge and only detours around a tower standing on it, so a probe match
// with a tower far from the lane reveals the lane the real match will use.
function probeLane(seed: number): Array<{ x: number; y: number }> {
  const probe = createMatch({ players: [{ id: "probe", name: "Probe" }], seed });
  // Tower spots are never on the route, so the farthest spot leaves the lane untouched.
  const cells = [...probe.getSnapshot().map.towerSpots]
    .sort((a, b) => (b.x + b.y) - (a.x + a.y) || (a.y - b.y) || (a.x - b.x));
  let placed = false;
  for (const cell of cells) {
    if (probe.applyCommand({ type: "place-tower", playerId: "probe", x: cell.x, y: cell.y }).accepted) {
      placed = true;
      break;
    }
  }
  if (!placed) {
    throw new Error(`could not place probe tower for seed ${seed}`);
  }
  probe.applyCommand({ type: "ready-for-wave", playerId: "probe" });

  const lane: Array<{ x: number; y: number }> = [];
  for (let tick = 0; tick < 400 && probe.applyCommand({ type: "advance-wave" }).accepted; tick += 1) {
    const creature = probe.getSnapshot().creatures[0];
    if (creature && !lane.some((cell) => cell.x === creature.x && cell.y === creature.y)) {
      lane.push({ x: creature.x, y: creature.y });
    }
  }
  return lane;
}

function placeTowersDeterministically(
  simulation: ReturnType<typeof createMatch>,
  scenario: BaselineScenario
): void {
  const players = simulation.getSnapshot().players
    .filter((player) => !player.eliminated)
    .map((player) => player.id)
    .sort((a, b) => a.localeCompare(b));

  const lane = probeLane(scenario.seed);
  const spawn = simulation.getSnapshot().map;
  const walked = lane.filter((cell) => !isInSpawnProtection(spawn, cell.x, cell.y)).slice(LANE_CELLS_BEFORE_COVERAGE);
  const nearestIndex = (spot: { x: number; y: number }): { index: number; distance: number } => {
    let best = { index: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY };
    walked.forEach((cell, index) => {
      const distance = Math.hypot(cell.x - spot.x, cell.y - spot.y);
      if (distance < best.distance) {
        best = { index, distance };
      }
    });
    return best;
  };
  const candidates = simulation.getSnapshot().map.towerSpots
    .map((spot) => ({ x: spot.x, y: spot.y, ...nearestIndex(spot) }))
    .sort((a, b) => a.index - b.index || a.distance - b.distance || a.y - b.y || a.x - b.x);

  for (const playerId of players) {
    let placed = false;
    for (const cell of candidates) {
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
      throw new Error(`could not place tower for ${playerId} in scenario ${scenario.id}`);
    }
  }
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
  if (action.type === "upgrade-tower") {
    const snapshot = simulation.getSnapshot();
    const player = snapshot.players.find((entry) => entry.id === action.playerId);
    const tower = snapshot.towers.find((entry) => entry.playerId === action.playerId);
    if (!player || !tower) {
      throw new Error(`missing tower/player for upgrade in scenario ${scenarioId} wave ${wave}`);
    }

    const upgradeCost = getTowerUpgradeCost(action.track, tower.upgrades[action.track]);
    if (player.points < upgradeCost) {
      simulation.awardPoints(action.playerId, upgradeCost - player.points);
    }

    applyCommandOrThrow(
      simulation,
      { type: "upgrade-tower", playerId: action.playerId, towerId: `tower-${action.playerId}`, track: action.track },
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
      throw new Error(`scenario ${scenarioId} left wave phase unexpectedly while advancing wave ${expectedCompletedWaves} (phase ${snapshot.phase}, ${snapshot.endReason ?? "no end reason"})`);
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

  placeTowersDeterministically(simulation, scenario);

  const maxWave = scenario.waveLoop.completedWaves;
  for (let wave = 1; wave <= maxWave; wave += 1) {
    const waveActions = scenario.waveStartActions?.[wave] ?? [];
    if (simulation.getSnapshot().phase !== "wave") {
      // Upgrades are only allowed in prep, before players ready; target modes are wave-only.
      for (const action of waveActions) {
        if (action.type === "upgrade-tower") {
          applyWaveStartAction(simulation, action, scenario.id, wave);
        }
      }
      readyAllPlacedPlayers(simulation, scenario.id, wave);
    }

    const activeSnapshot = simulation.getSnapshot();
    if (activeSnapshot.phase !== "wave") {
      throw new Error(`scenario ${scenario.id} failed to enter wave ${wave}`);
    }

    for (const action of waveActions) {
      if (action.type === "upgrade-tower") {
        continue;
      }
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
