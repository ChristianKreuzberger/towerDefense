import type { Creature, CreatureArchetype } from "./creature-types.js";
import type { GameMap } from "./map-types.js";
import type { Tower, TowerRuin, TowerTargetMode, UpgradeTrack } from "./tower-types.js";
import type { Wall } from "./wall-types.js";

export interface PlayerSetup {
  id: string;
  name: string;
}

export interface MatchSetup {
  players: PlayerSetup[];
  seed: number;
}

export type MatchPhase = "placement" | "wave" | "ended";

export interface TowerTargetAssignment {
  towerId: string;
  mode: TowerTargetMode;
  targetCreatureId: string | null;
}

export interface CreatureTargetAssignment {
  creatureId: string;
  targetTowerId: string | null;
}

export interface CreatureWallTargetAssignment {
  creatureId: string;
  targetWallId: string | null;
}

export interface MovementResolutionStep {
  fromPathIndex: number;
  toPathIndex: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface PathCellRepairState {
  x: number;
  y: number;
  wearBefore: number;
  wearAfter: number;
}

export interface TelemetryKillsByArchetype {
  runner: number;
  swarm: number;
  armored: number;
  tank: number;
}

export interface WaveTelemetrySnapshot {
  wave: number;
  tick: number;
  movementProgressUnits: number;
  movementSteps: number;
  creaturesSpawned: number;
  creaturesDefeated: number;
  creaturesExited: number;
  killsByArchetype: TelemetryKillsByArchetype;
  towerDamageDealt: number;
  towerDamageIntake: number;
  wallDamageIntake: number;
  towerRepairApplied: number;
  wallRepairApplied: number;
  waveClearBonusAwarded: number;
  catchUpBonusAwarded: number;
  swarmIncomeCapped: number;
}

export interface MatchTelemetrySnapshot {
  currentWave: WaveTelemetrySnapshot;
  completedWaves: WaveTelemetrySnapshot[];
}

export interface CumulativeTelemetrySnapshot {
  completedWaveCount: number;
  movementProgressUnits: number;
  movementSteps: number;
  creaturesSpawned: number;
  creaturesDefeated: number;
  creaturesExited: number;
  killsByArchetype: TelemetryKillsByArchetype;
  towerDamageDealt: number;
  towerDamageIntake: number;
  wallDamageIntake: number;
  towerRepairApplied: number;
  wallRepairApplied: number;
  waveClearBonusAwarded: number;
  catchUpBonusAwarded: number;
  swarmIncomeCapped: number;
}

export interface BalanceAnalysisPlayerSnapshot {
  playerId: string;
  playerName: string;
  eliminated: boolean;
  awardedPointsThisWave: number;
  spentOnWallsThisWave: number;
  spentOnUpgradesThisWave: number;
  netPointsDeltaThisWave: number;
  awardedPointsTotal: number;
  spentOnWallsTotal: number;
  spentOnUpgradesTotal: number;
  netPointsTotal: number;
  endingPoints: number;
  waveClearBonusThisWave: number;
  waveClearBonusTotal: number;
  catchUpBonusThisWave: number;
  catchUpBonusTotal: number;
  swarmIncomeCappedThisWave: number;
  swarmIncomeCappedTotal: number;
  towerLevel: number;
  towerHealth: number;
  wallCount: number;
  wallHealthTotal: number;
}

export interface BalanceAnalysisSnapshot {
  schemaVersion: 1;
  matchSeed: number;
  exportOrdinal: number;
  wave: number;
  tick: number;
  waveTelemetry: WaveTelemetrySnapshot;
  cumulativeTelemetry: CumulativeTelemetrySnapshot;
  players: BalanceAnalysisPlayerSnapshot[];
  totals: {
    awardedPointsThisWave: number;
    spentOnWallsThisWave: number;
    spentOnUpgradesThisWave: number;
    netPointsDeltaThisWave: number;
    awardedPointsTotal: number;
    spentOnWallsTotal: number;
    spentOnUpgradesTotal: number;
    netPointsTotal: number;
    endingPoints: number;
    waveClearBonusThisWave: number;
    waveClearBonusTotal: number;
    catchUpBonusThisWave: number;
    catchUpBonusTotal: number;
    swarmIncomeCappedThisWave: number;
    swarmIncomeCappedTotal: number;
    livingTowers: number;
    livingWalls: number;
    totalTowerHealth: number;
    totalWallHealth: number;
    mapPathWearTotal: number;
  };
}

export type MatchEvent =
  | {
      type: "wave-start";
      wave: number;
      tick: number;
    }
  | {
      type: "creature-spawned";
      wave: number;
      tick: number;
      creatureId: string;
      archetype: CreatureArchetype;
      pathIndex: number;
      x: number;
      y: number;
    }
  | {
      type: "creature-exited";
      wave: number;
      tick: number;
      creatureId: string;
      pathIndex: number;
      x: number;
      y: number;
    }
  | {
      type: "movement-resolved";
      wave: number;
      tick: number;
      creatureId: string;
      fromPathIndex: number;
      toPathIndex: number;
      fromProgressUnits: number;
      toProgressUnits: number;
      speedUnits: number;
      sourceCellWear: number;
      steps: MovementResolutionStep[];
      finalX: number;
      finalY: number;
      exited: boolean;
    }
  | {
      type: "wave-end";
      wave: number;
      tick: number;
    }
  | {
      type: "wave-clear-bonus";
      wave: number;
      tick: number;
      playerId: string;
      bonus: number;
      cleared: boolean;
    }
  | {
      type: "catch-up-bonus";
      wave: number;
      tick: number;
      playerId: string;
      bonus: number;
      // Points behind the leader when the bonus was paid.
      gap: number;
    }
  | {
      type: "swarm-income-capped";
      wave: number;
      tick: number;
      playerId: string;
      creatureId: string;
      // Reward points the kill would have paid but did not, because of the per-wave swarm income cap.
      forfeitedPoints: number;
    }
  | {
      type: "tower-repaired";
      wave: number;
      tick: number;
      towerId: string;
      playerId: string;
      repairAmount: number;
      remainingHp: number;
    }
  | {
      type: "wall-repaired";
      wave: number;
      tick: number;
      wallId: string;
      playerId: string;
      repairAmount: number;
      remainingHp: number;
    }
  | {
      type: "path-repaired";
      wave: number;
      tick: number;
      repairs: PathCellRepairState[];
    }
  | {
      type: "targets-selected";
      wave: number;
      tick: number;
      assignments: TowerTargetAssignment[];
    }
  | {
      type: "tower-hit";
      wave: number;
      tick: number;
      towerId: string;
      playerId: string;
      creatureId: string;
      // Creature cell at impact: a creature killed within one batched response never shows up in a snapshot.
      x: number;
      y: number;
      damage: number;
      remainingHp: number;
    }
  | {
      // The tower fired but missed; no damage. x/y is the creature cell, like tower-hit.
      type: "tower-miss";
      wave: number;
      tick: number;
      towerId: string;
      playerId: string;
      creatureId: string;
      x: number;
      y: number;
    }
  | {
      type: "creature-defeated";
      wave: number;
      tick: number;
      towerId: string;
      playerId: string;
      creatureId: string;
      x: number;
      y: number;
      rewardPoints: number;
    }
  | {
      type: "creature-targets-selected";
      wave: number;
      tick: number;
      assignments: CreatureTargetAssignment[];
    }
  | {
      type: "creature-wall-targets-selected";
      wave: number;
      tick: number;
      assignments: CreatureWallTargetAssignment[];
    }
  | {
      type: "wall-hit";
      wave: number;
      tick: number;
      creatureId: string;
      targetWallId: string;
      damage: number;
      remainingHp: number;
    }
  | {
      type: "wall-destroyed";
      wave: number;
      tick: number;
      wallId: string;
      playerId: string;
      destroyedByCreatureId: string;
    }
  | {
      type: "creature-attack";
      wave: number;
      tick: number;
      creatureId: string;
      targetTowerId: string;
      damage: number;
      remainingHp: number;
    }
  | {
      type: "tower-moved";
      wave: number;
      tick: number;
      towerId: string;
      playerId: string;
      fromX: number;
      fromY: number;
      x: number;
      y: number;
    }
  | {
      type: "tower-destroyed";
      wave: number;
      tick: number;
      towerId: string;
      playerId: string;
      destroyedByCreatureId: string;
    }
  | {
      type: "telemetry-snapshot";
      wave: number;
      tick: number;
      snapshot: WaveTelemetrySnapshot;
    }
  | {
      type: "balance-analysis-export";
      wave: number;
      tick: number;
      snapshot: BalanceAnalysisSnapshot;
    };

export interface TowerPlacement {
  playerId: string;
  x: number;
  y: number;
}

export interface PlayerState {
  id: string;
  name: string;
  points: number;
  hasPlacedTower: boolean;
  readyForWave: boolean;
  eliminated: boolean;
  // True while the player still holds their one free tower move (unlocked after 5 completed rounds).
  towerMoveAvailable: boolean;
  tower?: TowerPlacement;
}

export interface MatchSnapshot {
  phase: MatchPhase;
  wave: number;
  waveTick: number;
  allPlayersReadyForWave: boolean;
  // Creatures of the current (or, in prep, the upcoming) wave that have not spawned yet.
  creaturesToSpawn: number;
  telemetry: MatchTelemetrySnapshot;
  balanceAnalysisExports: BalanceAnalysisSnapshot[];
  map: GameMap;
  towers: Tower[];
  ruins: TowerRuin[];
  walls: Wall[];
  creatures: Creature[];
  targetAssignments: TowerTargetAssignment[];
  players: PlayerState[];
  events: MatchEvent[];
  winnerId?: string;
  endReason?: "score-win" | "all-towers-destroyed";
}

export type CommandRejectReason =
  | "match-already-ended"
  | "placement-phase-not-active"
  | "ready-phase-not-active"
  | "wave-phase-not-active"
  | "unknown-player"
  | "player-eliminated"
  | "tower-already-placed"
  | "tower-not-placed"
  | "wall-phase-not-active"
  | "upgrade-phase-not-active"
  | "tower-max-level"
  | "invalid-upgrade-track"
  | "tower-move-locked"
  | "tower-move-used"
  | "move-phase-not-active"
  | "invalid-move-target"
  | "player-already-ready-for-wave"
  | "invalid-upgrade-target"
  | "invalid-target-mode-target"
  | "invalid-target-mode"
  | "out-of-bounds"
  | "cell-not-buildable"
  | "tower-overlap"
  | "wall-overlap"
  | "path-blocked"
  | "spawn-protected"
  | "insufficient-points"
  | "unsupported-command";

export interface CommandResult {
  accepted: boolean;
  reason?: CommandRejectReason;
}

export type SimulationCommand =
  | {
      type: "place-tower";
      playerId: string;
      x: number;
      y: number;
    }
  | {
      type: "place-wall";
      playerId: string;
      x: number;
      y: number;
    }
  | {
      type: "move-tower";
      playerId: string;
      towerId: string;
      x: number;
      y: number;
    }
  | {
      type: "upgrade-tower";
      playerId: string;
      towerId: string;
      track: UpgradeTrack;
    }
  | {
      type: "set-target-mode";
      playerId: string;
      towerId: string;
      mode: TowerTargetMode;
    }
  | {
      type: "ready-for-wave";
      playerId: string;
    }
  | {
      type: "advance-wave";
    };
