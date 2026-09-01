import type {
  BalanceAnalysisPlayerSnapshot,
  BalanceAnalysisSnapshot,
  TelemetryKillsByArchetype,
  WaveTelemetrySnapshot
} from "@tower-defense/shared";

export interface BalanceReportWaveSummary {
  wave: number;
  exportOrdinal: number;
  tick: number;
  dpsProxy: number;
  waveTelemetry: WaveTelemetrySnapshot;
  players: BalanceAnalysisPlayerSnapshot[];
  totals: BalanceAnalysisSnapshot["totals"];
}

export interface BalanceReportCumulativeSummary {
  wavesCompleted: number;
  totalTicks: number;
  dpsProxy: number;
  killsByArchetype: TelemetryKillsByArchetype;
  towerDamageDealt: number;
  towerDamageIntake: number;
  wallDamageIntake: number;
  towerRepairApplied: number;
  wallRepairApplied: number;
  waveClearBonusAwarded: number;
  awardedPointsTotal: number;
  spentOnWallsTotal: number;
  spentOnUpgradesTotal: number;
  netPointsTotal: number;
  endingPoints: number;
  livingTowers: number;
  livingWalls: number;
  totalTowerHealth: number;
  totalWallHealth: number;
  mapPathWearTotal: number;
  players: BalanceAnalysisPlayerSnapshot[];
}

export interface BalanceReport {
  schemaVersion: 1;
  matchSeed: number;
  snapshots: BalanceAnalysisSnapshot[];
  waveSummaries: BalanceReportWaveSummary[];
  cumulative: BalanceReportCumulativeSummary;
}

type BalanceInputEnvelope =
  | BalanceAnalysisSnapshot
  | BalanceAnalysisSnapshot[]
  | { balanceAnalysisExports: BalanceAnalysisSnapshot[] }
  | { snapshots: BalanceAnalysisSnapshot[] };

function toNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatFixed(value: number): string {
  return value.toFixed(2);
}

function compareSnapshotOrder(a: BalanceAnalysisSnapshot, b: BalanceAnalysisSnapshot): number {
  return (a.wave - b.wave) || (a.exportOrdinal - b.exportOrdinal) || (a.tick - b.tick);
}

function comparePlayerOrder(a: BalanceAnalysisPlayerSnapshot, b: BalanceAnalysisPlayerSnapshot): number {
  return a.playerId.localeCompare(b.playerId);
}

function cloneAndSortSnapshot(snapshot: BalanceAnalysisSnapshot): BalanceAnalysisSnapshot {
  return {
    ...snapshot,
    waveTelemetry: {
      ...snapshot.waveTelemetry,
      killsByArchetype: { ...snapshot.waveTelemetry.killsByArchetype }
    },
    cumulativeTelemetry: {
      ...snapshot.cumulativeTelemetry,
      killsByArchetype: { ...snapshot.cumulativeTelemetry.killsByArchetype }
    },
    players: [...snapshot.players].sort(comparePlayerOrder).map((player) => ({ ...player })),
    totals: { ...snapshot.totals }
  };
}

export function extractBalanceAnalysisSnapshots(input: unknown): BalanceAnalysisSnapshot[] {
  if (Array.isArray(input)) {
    return [...input] as BalanceAnalysisSnapshot[];
  }

  if (!input || typeof input !== "object") {
    throw new Error("snapshot input must be an object or array");
  }

  const envelope = input as BalanceInputEnvelope;
  if (Array.isArray((envelope as { balanceAnalysisExports?: unknown }).balanceAnalysisExports)) {
    return [...(envelope as { balanceAnalysisExports: BalanceAnalysisSnapshot[] }).balanceAnalysisExports];
  }

  if (Array.isArray((envelope as { snapshots?: unknown }).snapshots)) {
    return [...(envelope as { snapshots: BalanceAnalysisSnapshot[] }).snapshots];
  }

  const possibleSingle = envelope as Partial<BalanceAnalysisSnapshot>;
  if (possibleSingle.schemaVersion === 1) {
    return [possibleSingle as BalanceAnalysisSnapshot];
  }

  throw new Error("unable to find balance-analysis snapshots in input");
}

export function deriveBalanceReport(snapshots: BalanceAnalysisSnapshot[]): BalanceReport {
  if (snapshots.length === 0) {
    throw new Error("at least one balance-analysis snapshot is required");
  }

  const orderedSnapshots = snapshots
    .map((snapshot) => cloneAndSortSnapshot(snapshot))
    .sort(compareSnapshotOrder);

  const matchSeed = orderedSnapshots[0]?.matchSeed ?? 0;
  for (const snapshot of orderedSnapshots) {
    if (snapshot.schemaVersion !== 1) {
      throw new Error(`unsupported snapshot schema version: ${String(snapshot.schemaVersion)}`);
    }

    if (snapshot.matchSeed !== matchSeed) {
      throw new Error("all snapshots in one report must share the same matchSeed");
    }
  }

  const waveSummaries: BalanceReportWaveSummary[] = orderedSnapshots.map((snapshot) => {
    const tick = Math.max(0, snapshot.waveTelemetry.tick);
    const dealt = toNumber(snapshot.waveTelemetry.towerDamageDealt);
    return {
      wave: snapshot.wave,
      exportOrdinal: snapshot.exportOrdinal,
      tick,
      dpsProxy: tick > 0 ? dealt / tick : dealt,
      waveTelemetry: {
        ...snapshot.waveTelemetry,
        killsByArchetype: { ...snapshot.waveTelemetry.killsByArchetype }
      },
      players: snapshot.players.map((player) => ({ ...player })),
      totals: { ...snapshot.totals }
    };
  });

  const cumulativeKills = {
    runner: 0,
    swarm: 0,
    armored: 0,
    tank: 0
  };
  let totalTicks = 0;
  let towerDamageDealt = 0;
  let towerDamageIntake = 0;
  let wallDamageIntake = 0;
  let towerRepairApplied = 0;
  let wallRepairApplied = 0;
  let waveClearBonusAwarded = 0;

  for (const wave of waveSummaries) {
    totalTicks += toNumber(wave.waveTelemetry.tick);
    towerDamageDealt += toNumber(wave.waveTelemetry.towerDamageDealt);
    towerDamageIntake += toNumber(wave.waveTelemetry.towerDamageIntake);
    wallDamageIntake += toNumber(wave.waveTelemetry.wallDamageIntake);
    towerRepairApplied += toNumber(wave.waveTelemetry.towerRepairApplied);
    wallRepairApplied += toNumber(wave.waveTelemetry.wallRepairApplied);
    waveClearBonusAwarded += toNumber(wave.waveTelemetry.waveClearBonusAwarded);
    cumulativeKills.runner += toNumber(wave.waveTelemetry.killsByArchetype.runner);
    cumulativeKills.swarm += toNumber(wave.waveTelemetry.killsByArchetype.swarm);
    cumulativeKills.armored += toNumber(wave.waveTelemetry.killsByArchetype.armored);
    cumulativeKills.tank += toNumber(wave.waveTelemetry.killsByArchetype.tank);
  }

  const finalSnapshot = orderedSnapshots[orderedSnapshots.length - 1];
  if (!finalSnapshot) {
    throw new Error("at least one balance-analysis snapshot is required");
  }

  const cumulative: BalanceReportCumulativeSummary = {
    wavesCompleted: waveSummaries.length,
    totalTicks,
    dpsProxy: totalTicks > 0 ? towerDamageDealt / totalTicks : towerDamageDealt,
    killsByArchetype: cumulativeKills,
    towerDamageDealt,
    towerDamageIntake,
    wallDamageIntake,
    towerRepairApplied,
    wallRepairApplied,
    waveClearBonusAwarded,
    awardedPointsTotal: finalSnapshot.totals.awardedPointsTotal,
    spentOnWallsTotal: finalSnapshot.totals.spentOnWallsTotal,
    spentOnUpgradesTotal: finalSnapshot.totals.spentOnUpgradesTotal,
    netPointsTotal: finalSnapshot.totals.netPointsTotal,
    endingPoints: finalSnapshot.totals.endingPoints,
    livingTowers: finalSnapshot.totals.livingTowers,
    livingWalls: finalSnapshot.totals.livingWalls,
    totalTowerHealth: finalSnapshot.totals.totalTowerHealth,
    totalWallHealth: finalSnapshot.totals.totalWallHealth,
    mapPathWearTotal: finalSnapshot.totals.mapPathWearTotal,
    players: finalSnapshot.players.map((player) => ({ ...player }))
  };

  return {
    schemaVersion: 1,
    matchSeed,
    snapshots: orderedSnapshots,
    waveSummaries,
    cumulative
  };
}

function formatKills(kills: TelemetryKillsByArchetype): string {
  return `runner=${kills.runner} swarm=${kills.swarm} armored=${kills.armored} tank=${kills.tank}`;
}

function formatPlayerLine(prefix: string, player: BalanceAnalysisPlayerSnapshot): string {
  const status = player.eliminated ? "eliminated" : "active";
  return (
    `${prefix}${player.playerId} (${player.playerName}) status=${status}` +
    ` delta=${player.netPointsDeltaThisWave}` +
    ` bonus=${player.waveClearBonusThisWave}` +
    ` total=${player.netPointsTotal}` +
    ` ending=${player.endingPoints}` +
    ` towerLv=${player.towerLevel}` +
    ` towerHp=${player.towerHealth}` +
    ` walls=${player.wallCount}` +
    ` wallHp=${player.wallHealthTotal}`
  );
}

export function formatBalanceReport(report: BalanceReport): string {
  const lines: string[] = [];
  lines.push("Tower Defense Balance Report");
  lines.push(`schemaVersion=${report.schemaVersion}`);
  lines.push(`matchSeed=${report.matchSeed}`);
  lines.push(`snapshots=${report.snapshots.length}`);
  lines.push("");

  for (const wave of report.waveSummaries) {
    lines.push(`=== Wave ${wave.wave} (export=${wave.exportOrdinal}, tick=${wave.tick}) ===`);
    lines.push(
      `DPS proxy: ${formatFixed(wave.dpsProxy)} dmg/tick ` +
        `(dealt=${wave.waveTelemetry.towerDamageDealt}, ticks=${wave.tick})`
    );
    lines.push(
      `Kills by archetype: ${formatKills(wave.waveTelemetry.killsByArchetype)} ` +
        `(defeated=${wave.waveTelemetry.creaturesDefeated}, spawned=${wave.waveTelemetry.creaturesSpawned}, exited=${wave.waveTelemetry.creaturesExited})`
    );
    lines.push(
      `Damage intake: towers=${wave.waveTelemetry.towerDamageIntake} walls=${wave.waveTelemetry.wallDamageIntake}`
    );
    lines.push(
      `Repairs: towers=${wave.waveTelemetry.towerRepairApplied} walls=${wave.waveTelemetry.wallRepairApplied}`
    );
    lines.push(
      `Economy delta: awarded=${wave.totals.awardedPointsThisWave} ` +
        `spentWalls=${wave.totals.spentOnWallsThisWave} ` +
        `spentUpgrades=${wave.totals.spentOnUpgradesThisWave} ` +
        `net=${wave.totals.netPointsDeltaThisWave}`
    );
    lines.push(`Wave-clear bonus: awarded=${wave.totals.waveClearBonusThisWave}`);
    lines.push("Players:");
    for (const player of wave.players) {
      lines.push(formatPlayerLine("- ", player));
    }
    lines.push("");
  }

  lines.push("=== Cumulative Summary ===");
  lines.push(`Waves completed: ${report.cumulative.wavesCompleted}`);
  lines.push(
    `DPS proxy: ${formatFixed(report.cumulative.dpsProxy)} dmg/tick ` +
      `(dealt=${report.cumulative.towerDamageDealt}, ticks=${report.cumulative.totalTicks})`
  );
  lines.push(`Kills by archetype: ${formatKills(report.cumulative.killsByArchetype)}`);
  lines.push(
    `Damage intake totals: towers=${report.cumulative.towerDamageIntake} walls=${report.cumulative.wallDamageIntake}`
  );
  lines.push(
    `Repairs totals: towers=${report.cumulative.towerRepairApplied} walls=${report.cumulative.wallRepairApplied}`
  );
  lines.push(`Wave-clear bonus total: ${report.cumulative.waveClearBonusAwarded}`);
  lines.push(
    `Economy totals: awarded=${report.cumulative.awardedPointsTotal} ` +
      `spentWalls=${report.cumulative.spentOnWallsTotal} ` +
      `spentUpgrades=${report.cumulative.spentOnUpgradesTotal} ` +
      `net=${report.cumulative.netPointsTotal} ending=${report.cumulative.endingPoints}`
  );
  lines.push(
    `Structures: livingTowers=${report.cumulative.livingTowers} livingWalls=${report.cumulative.livingWalls} ` +
      `towerHp=${report.cumulative.totalTowerHealth} wallHp=${report.cumulative.totalWallHealth} ` +
      `pathWearTotal=${report.cumulative.mapPathWearTotal}`
  );
  lines.push("Players (final):");
  for (const player of report.cumulative.players) {
    lines.push(formatPlayerLine("- ", player));
  }

  return `${lines.join("\n")}\n`;
}