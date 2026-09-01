import {
  getCreatureAttackDamage,
  getCreatureBaseHp,
  getCreatureRewardPoints,
  DEFAULT_TOWER_TARGET_MODE,
  DEFAULT_TOWER_HEALTH,
  DEFAULT_WALL_HEALTH,
  GAME_RULES,
  PATH_CELL_MAX_WEAR,
  BETWEEN_WAVE_PATH_WEAR_REPAIR,
  MOVEMENT_PROGRESS_UNITS_PER_CELL,
  getBetweenWaveTowerRepairAmount,
  getBetweenWaveWallRepairAmount,
  getCreatureMovementSpeedUnits,
  type CommandResult,
  type BalanceAnalysisSnapshot,
  type CumulativeTelemetrySnapshot,
  type MatchEvent,
  type Creature,
  type GameMap,
  type MatchSetup,
  type MatchSnapshot,
  type MatchTelemetrySnapshot,
  type PlayerState,
  type SimulationCommand,
  type TelemetryKillsByArchetype,
  type WaveTelemetrySnapshot,
  type CreatureWallTargetAssignment,
  type TowerTargetAssignment,
  type Tower,
  type Wall,
  getWallCost,
  getTowerUpgradeCost,
  getWaveClearBonus,
  isValidTowerPlacement,
  isValidTowerTargetMode,
  isValidTowerUpgradeTarget,
  isValidWallPlacement,
  WIN_SCORE,
} from "@tower-defense/shared";

import { generateMap } from "./procedural-map.js";

interface InternalMatchState {
  phase: "placement" | "wave" | "ended";
  wave: number;
  waveTick: number;
  map: GameMap;
  towers: Tower[];
  walls: Wall[];
  creatures: Creature[];
  targetAssignments: TowerTargetAssignment[];
  players: PlayerState[];
  telemetry: MatchTelemetrySnapshot;
  balanceAnalysisExports: BalanceAnalysisSnapshot[];
  playerAwardedPointsTotal: Record<string, number>;
  playerSpentOnWallsTotal: Record<string, number>;
  playerSpentOnUpgradesTotal: Record<string, number>;
  playerAwardedPointsCurrentWave: Record<string, number>;
  playerSpentOnWallsCurrentWave: Record<string, number>;
  playerSpentOnUpgradesCurrentWave: Record<string, number>;
  playerWaveClearBonusTotal: Record<string, number>;
  playerWaveClearBonusCurrentWave: Record<string, number>;
  events: MatchEvent[];
  winnerId?: string;
  endReason?: "score-win" | "all-towers-destroyed";
}

interface WaveSpawnPlan {
  totalCreatures: number;
  spawnIntervalTicks: number;
}

const WAVE_SPAWN_ARCHETYPES: readonly Creature["archetype"][] = ["runner", "swarm", "armored", "tank"];

function createEmptyKillsByArchetype(): TelemetryKillsByArchetype {
  return {
    runner: 0,
    swarm: 0,
    armored: 0,
    tank: 0
  };
}

function createWaveTelemetrySnapshot(wave: number, tick: number): WaveTelemetrySnapshot {
  return {
    wave,
    tick,
    movementProgressUnits: 0,
    movementSteps: 0,
    creaturesSpawned: 0,
    creaturesDefeated: 0,
    creaturesExited: 0,
    killsByArchetype: createEmptyKillsByArchetype(),
    towerDamageDealt: 0,
    towerDamageIntake: 0,
    wallDamageIntake: 0,
    towerRepairApplied: 0,
    wallRepairApplied: 0,
    waveClearBonusAwarded: 0
  };
}

function cloneWaveTelemetrySnapshot(snapshot: WaveTelemetrySnapshot): WaveTelemetrySnapshot {
  return {
    ...snapshot,
    killsByArchetype: { ...snapshot.killsByArchetype }
  };
}

function createEmptyCumulativeTelemetrySnapshot(): CumulativeTelemetrySnapshot {
  return {
    completedWaveCount: 0,
    movementProgressUnits: 0,
    movementSteps: 0,
    creaturesSpawned: 0,
    creaturesDefeated: 0,
    creaturesExited: 0,
    killsByArchetype: createEmptyKillsByArchetype(),
    towerDamageDealt: 0,
    towerDamageIntake: 0,
    wallDamageIntake: 0,
    towerRepairApplied: 0,
    wallRepairApplied: 0,
    waveClearBonusAwarded: 0
  };
}

function accumulateWaveTelemetry(
  target: CumulativeTelemetrySnapshot,
  waveTelemetry: WaveTelemetrySnapshot
): void {
  target.completedWaveCount += 1;
  target.movementProgressUnits += waveTelemetry.movementProgressUnits;
  target.movementSteps += waveTelemetry.movementSteps;
  target.creaturesSpawned += waveTelemetry.creaturesSpawned;
  target.creaturesDefeated += waveTelemetry.creaturesDefeated;
  target.creaturesExited += waveTelemetry.creaturesExited;
  target.killsByArchetype.runner += waveTelemetry.killsByArchetype.runner;
  target.killsByArchetype.swarm += waveTelemetry.killsByArchetype.swarm;
  target.killsByArchetype.armored += waveTelemetry.killsByArchetype.armored;
  target.killsByArchetype.tank += waveTelemetry.killsByArchetype.tank;
  target.towerDamageDealt += waveTelemetry.towerDamageDealt;
  target.towerDamageIntake += waveTelemetry.towerDamageIntake;
  target.wallDamageIntake += waveTelemetry.wallDamageIntake;
  target.towerRepairApplied += waveTelemetry.towerRepairApplied;
  target.wallRepairApplied += waveTelemetry.wallRepairApplied;
  target.waveClearBonusAwarded += waveTelemetry.waveClearBonusAwarded;
}

function cloneCumulativeTelemetrySnapshot(snapshot: CumulativeTelemetrySnapshot): CumulativeTelemetrySnapshot {
  return {
    ...snapshot,
    killsByArchetype: { ...snapshot.killsByArchetype }
  };
}

function createPlayerCounterMap(players: MatchSetup["players"]): Record<string, number> {
  return Object.fromEntries(players.map((player) => [player.id, 0]));
}

function toCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function getOpenPathForCreatures(map: GameMap, tower: Tower, walls: Wall[]): Array<{ x: number; y: number }> {
  const blocked = new Set<string>();
  blocked.add(toCellKey(tower.x, tower.y));
  for (const wall of walls) {
    blocked.add(toCellKey(wall.x, wall.y));
  }

  const buildable = new Set<string>();
  for (const cell of map.cells) {
    if (cell.buildable) {
      buildable.add(toCellKey(cell.x, cell.y));
    }
  }

  const queue: Array<{ x: number; y: number }> = [];
  const parent = new Map<string, string | undefined>();
  const starts: string[] = [];

  for (let y = 0; y < map.height; y += 1) {
    const key = toCellKey(0, y);
    if (buildable.has(key) && !blocked.has(key)) {
      starts.push(key);
      queue.push({ x: 0, y });
      parent.set(key, undefined);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }

    if (current.x === map.width - 1) {
      const pathKeys: string[] = [];
      let cursor: string | undefined = toCellKey(current.x, current.y);
      while (cursor) {
        pathKeys.push(cursor);
        cursor = parent.get(cursor);
      }
      pathKeys.reverse();
      return pathKeys.map((key) => {
        const [xText, yText] = key.split(",");
        return {
          x: Number(xText),
          y: Number(yText)
        };
      });
    }

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
      { x: current.x - 1, y: current.y }
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x < 0 || neighbor.x >= map.width || neighbor.y < 0 || neighbor.y >= map.height) {
        continue;
      }

      const key = toCellKey(neighbor.x, neighbor.y);
      if (parent.has(key) || !buildable.has(key) || blocked.has(key)) {
        continue;
      }

      parent.set(key, toCellKey(current.x, current.y));
      queue.push(neighbor);
    }
  }

  for (const key of starts) {
    const [xText, yText] = key.split(",");
    return [{ x: Number(xText), y: Number(yText) }];
  }

  for (const cell of map.cells) {
    const key = toCellKey(cell.x, cell.y);
    if (cell.buildable && !blocked.has(key)) {
      return [{ x: cell.x, y: cell.y }];
    }
  }

  return [];
}

export class MatchSimulation {
  private readonly state: InternalMatchState;
  private readonly currentWavePath: Array<{ x: number; y: number }> = [];
  private currentWaveSpawned = 0;

  public constructor(setup: MatchSetup) {
    if (setup.players.length < GAME_RULES.minPlayers || setup.players.length > GAME_RULES.maxPlayers) {
      throw new Error(
        `player count must be between ${GAME_RULES.minPlayers} and ${GAME_RULES.maxPlayers}`
      );
    }

    this.state = {
      phase: "placement",
      wave: 1,
      waveTick: 0,
      map: generateMap(setup.seed),
      towers: [],
      walls: [],
      creatures: [],
      targetAssignments: [],
      telemetry: {
        currentWave: createWaveTelemetrySnapshot(1, 0),
        completedWaves: []
      },
      balanceAnalysisExports: [],
      playerAwardedPointsTotal: createPlayerCounterMap(setup.players),
      playerSpentOnWallsTotal: createPlayerCounterMap(setup.players),
      playerSpentOnUpgradesTotal: createPlayerCounterMap(setup.players),
      playerAwardedPointsCurrentWave: createPlayerCounterMap(setup.players),
      playerSpentOnWallsCurrentWave: createPlayerCounterMap(setup.players),
      playerSpentOnUpgradesCurrentWave: createPlayerCounterMap(setup.players),
      playerWaveClearBonusTotal: createPlayerCounterMap(setup.players),
      playerWaveClearBonusCurrentWave: createPlayerCounterMap(setup.players),
      events: [],
      players: setup.players.map((player) => ({
        id: player.id,
        name: player.name,
        points: 0,
        hasPlacedTower: false,
        readyForWave: false,
        eliminated: false
      }))
    };
  }

  public applyCommand(command: SimulationCommand): CommandResult {
    if (this.state.phase === "ended") {
      return { accepted: false, reason: "match-already-ended" };
    }

    if (command.type === "place-tower") {
      if (this.state.phase !== "placement") {
        return { accepted: false, reason: "placement-phase-not-active" };
      }

      const player = this.state.players.find((entry) => entry.id === command.playerId);
      if (!player) {
        return { accepted: false, reason: "unknown-player" };
      }

      if (player.eliminated) {
        return { accepted: false, reason: "player-eliminated" };
      }

      if (player.hasPlacedTower) {
        return { accepted: false, reason: "tower-already-placed" };
      }

      const validation = isValidTowerPlacement(command, this.state.towers, this.state.map);
      if (!validation.valid) {
        return validation.reason
          ? { accepted: false, reason: validation.reason }
          : { accepted: false };
      }

      player.hasPlacedTower = true;
      player.tower = {
        playerId: command.playerId,
        x: command.x,
        y: command.y
      };
      this.state.towers.push({
        id: `tower-${command.playerId}`,
        playerId: command.playerId,
        x: command.x,
        y: command.y,
        health: DEFAULT_TOWER_HEALTH,
        maxHealth: DEFAULT_TOWER_HEALTH,
        level: 1,
        targetMode: DEFAULT_TOWER_TARGET_MODE
      });

      return { accepted: true };
    }

    if (command.type === "ready-for-wave") {
      if (this.state.phase !== "placement") {
        return { accepted: false, reason: "ready-phase-not-active" };
      }

      const player = this.state.players.find((entry) => entry.id === command.playerId);
      if (!player) {
        return { accepted: false, reason: "unknown-player" };
      }

      if (player.eliminated) {
        return { accepted: false, reason: "player-eliminated" };
      }

      if (!player.hasPlacedTower) {
        return { accepted: false, reason: "tower-not-placed" };
      }

      if (player.readyForWave) {
        return { accepted: false, reason: "player-already-ready-for-wave" };
      }

      player.readyForWave = true;

      if (this.state.players.every((entry) => entry.hasPlacedTower && entry.readyForWave)) {
        this.startWave();
      }

      return { accepted: true };
    }

    if (command.type === "advance-wave") {
      if (this.state.phase !== "wave") {
        return { accepted: false, reason: "wave-phase-not-active" };
      }

      this.state.waveTick += 1;

      this.moveCreaturesForCurrentTick();
      this.spawnCreaturesForCurrentTick();
      this.selectTargetsForCurrentTick();
      this.resolveCombatForCurrentTick();
      this.resolveCreatureWallAttacksForCurrentTick();
      this.resolveCreatureAttacksForCurrentTick();

      if (this.state.endReason) {
        return { accepted: true };
      }

      if (this.isWaveComplete()) {
        this.endWave();
      }

      return { accepted: true };
    }

    if (command.type === "place-wall") {
      if (this.state.phase !== "wave") {
        return { accepted: false, reason: "wall-phase-not-active" };
      }

      const player = this.state.players.find((entry) => entry.id === command.playerId);
      if (!player) {
        return { accepted: false, reason: "unknown-player" };
      }

      if (player.eliminated) {
        return { accepted: false, reason: "player-eliminated" };
      }

      const wallCost = getWallCost(this.state.walls.length);
      if (player.points < wallCost) {
        return { accepted: false, reason: "insufficient-points" };
      }

      const validation = isValidWallPlacement(command, this.state.walls, this.state.towers, this.state.map);
      if (!validation.valid) {
        return validation.reason
          ? { accepted: false, reason: validation.reason }
          : { accepted: false };
      }

      player.points -= wallCost;
      this.state.playerSpentOnWallsTotal[command.playerId] =
        (this.state.playerSpentOnWallsTotal[command.playerId] ?? 0) + wallCost;
      this.state.playerSpentOnWallsCurrentWave[command.playerId] =
        (this.state.playerSpentOnWallsCurrentWave[command.playerId] ?? 0) + wallCost;
      this.state.walls.push({
        id: `wall-${this.state.walls.length + 1}`,
        playerId: command.playerId,
        x: command.x,
        y: command.y,
        health: DEFAULT_WALL_HEALTH,
        maxHealth: DEFAULT_WALL_HEALTH
      });

      return { accepted: true };
    }

    if (command.type === "upgrade-tower") {
      if (this.state.phase !== "wave") {
        return { accepted: false, reason: "wall-phase-not-active" };
      }

      const player = this.state.players.find((entry) => entry.id === command.playerId);
      if (!player) {
        return { accepted: false, reason: "unknown-player" };
      }

      if (player.eliminated) {
        return { accepted: false, reason: "player-eliminated" };
      }

      if (!isValidTowerUpgradeTarget(command.towerId, command.playerId, this.state.towers)) {
        return { accepted: false, reason: "invalid-upgrade-target" };
      }

      const tower = this.state.towers.find((entry) => entry.id === command.towerId);
      if (!tower) {
        return { accepted: false, reason: "invalid-upgrade-target" };
      }

      const upgradeCost = getTowerUpgradeCost(tower.level);
      if (player.points < upgradeCost) {
        return { accepted: false, reason: "insufficient-points" };
      }

      player.points -= upgradeCost;
      this.state.playerSpentOnUpgradesTotal[command.playerId] =
        (this.state.playerSpentOnUpgradesTotal[command.playerId] ?? 0) + upgradeCost;
      this.state.playerSpentOnUpgradesCurrentWave[command.playerId] =
        (this.state.playerSpentOnUpgradesCurrentWave[command.playerId] ?? 0) + upgradeCost;
      tower.level += 1;

      return { accepted: true };
    }

    if (command.type === "set-target-mode") {
      if (this.state.phase !== "wave") {
        return { accepted: false, reason: "wall-phase-not-active" };
      }

      const player = this.state.players.find((entry) => entry.id === command.playerId);
      if (!player) {
        return { accepted: false, reason: "unknown-player" };
      }

      if (player.eliminated) {
        return { accepted: false, reason: "player-eliminated" };
      }

      const tower = this.state.towers.find((entry) => entry.id === command.towerId);
      if (!tower || tower.playerId !== command.playerId) {
        return { accepted: false, reason: "invalid-target-mode-target" };
      }

      if (!isValidTowerTargetMode(command.mode)) {
        return { accepted: false, reason: "invalid-target-mode" };
      }

      tower.targetMode = command.mode;
      return { accepted: true };
    }

    return { accepted: false, reason: "unsupported-command" };
  }

  public awardPoints(playerId: string, points: number): void {
    const player = this.state.players.find((entry) => entry.id === playerId);
    if (!player || this.state.phase === "ended") {
      return;
    }

    player.points += points;
    this.state.playerAwardedPointsTotal[playerId] =
      (this.state.playerAwardedPointsTotal[playerId] ?? 0) + points;
    this.state.playerAwardedPointsCurrentWave[playerId] =
      (this.state.playerAwardedPointsCurrentWave[playerId] ?? 0) + points;
    if (player.points >= WIN_SCORE) {
      this.state.phase = "ended";
      this.state.winnerId = playerId;
      this.state.endReason = "score-win";
    }
  }

  public getSnapshot(): MatchSnapshot {
    return {
      phase: this.state.phase,
      wave: this.state.wave,
      waveTick: this.state.waveTick,
      allPlayersReadyForWave: this.state.players.every(
        (player) => player.hasPlacedTower && player.readyForWave
      ),
      telemetry: {
        currentWave: cloneWaveTelemetrySnapshot(this.state.telemetry.currentWave),
        completedWaves: this.state.telemetry.completedWaves.map((waveTelemetry) =>
          cloneWaveTelemetrySnapshot(waveTelemetry)
        )
      },
      balanceAnalysisExports: this.state.balanceAnalysisExports.map((entry) => ({
        ...entry,
        waveTelemetry: cloneWaveTelemetrySnapshot(entry.waveTelemetry),
        cumulativeTelemetry: cloneCumulativeTelemetrySnapshot(entry.cumulativeTelemetry),
        players: entry.players.map((player) => ({ ...player })),
        totals: { ...entry.totals }
      })),
      map: {
        width: this.state.map.width,
        height: this.state.map.height,
        seed: this.state.map.seed,
        cells: this.state.map.cells.map((cell) => ({ ...cell }))
      },
      towers: this.state.towers.map((tower) => ({ ...tower })),
      walls: this.state.walls.map((wall) => ({ ...wall })),
      creatures: this.state.creatures.map((creature) => ({ ...creature })),
      targetAssignments: this.state.targetAssignments.map((assignment) => ({ ...assignment })),
      players: this.state.players.map((player) => ({ ...player })),
      events: this.state.events.map((event) => ({ ...event })),
      ...(this.state.winnerId ? { winnerId: this.state.winnerId } : {}),
      ...(this.state.endReason ? { endReason: this.state.endReason } : {})
    };
  }

  private startWave(): void {
    this.state.phase = "wave";
    this.state.waveTick = 0;
    this.state.telemetry.currentWave = createWaveTelemetrySnapshot(this.state.wave, this.state.waveTick);
    for (const player of this.state.players) {
      this.state.playerAwardedPointsCurrentWave[player.id] = 0;
      this.state.playerSpentOnWallsCurrentWave[player.id] = 0;
      this.state.playerSpentOnUpgradesCurrentWave[player.id] = 0;
      this.state.playerWaveClearBonusCurrentWave[player.id] = 0;
    }
    this.currentWaveSpawned = 0;
    this.currentWavePath.length = 0;
    if (this.state.towers[0]) {
      this.currentWavePath.push(
        ...getOpenPathForCreatures(this.state.map, this.state.towers[0], this.state.walls)
      );
    }
    this.state.events.push({
      type: "wave-start",
      wave: this.state.wave,
      tick: this.state.waveTick
    });
    this.state.targetAssignments = this.computeTargetAssignments();
  }

  private getWaveSpawnPlan(): WaveSpawnPlan {
    return {
      totalCreatures: this.state.wave + 2,
      spawnIntervalTicks: 2
    };
  }

  private spawnCreaturesForCurrentTick(): void {
    const plan = this.getWaveSpawnPlan();
    if (this.currentWaveSpawned >= plan.totalCreatures) {
      return;
    }

    if ((this.state.waveTick - 1) % plan.spawnIntervalTicks !== 0) {
      return;
    }

    const firstPathNode = this.currentWavePath[0];
    if (!firstPathNode) {
      return;
    }

    const spawnOrdinal = this.currentWaveSpawned + 1;
    const archetype = WAVE_SPAWN_ARCHETYPES[(spawnOrdinal - 1) % WAVE_SPAWN_ARCHETYPES.length] ?? "runner";
    const creature: Creature = {
      id: `wave-${this.state.wave}-creature-${spawnOrdinal}`,
      archetype,
      hp: getCreatureBaseHp(archetype),
      x: firstPathNode.x,
      y: firstPathNode.y,
      pathIndex: 0,
      pathProgressUnits: 0,
      spawnTick: this.state.waveTick,
      targetTowerId: this.state.towers[0]?.id ?? "tower-missing"
    };

    this.currentWaveSpawned += 1;
    this.state.creatures.push(creature);
    this.state.telemetry.currentWave.creaturesSpawned += 1;
    this.updateCurrentWaveTelemetryTick();
    this.state.events.push({
      type: "creature-spawned",
      wave: this.state.wave,
      tick: this.state.waveTick,
      creatureId: creature.id,
      archetype: creature.archetype,
      pathIndex: creature.pathIndex,
      x: creature.x,
      y: creature.y
    });
  }

  private moveCreaturesForCurrentTick(): void {
    if (this.currentWavePath.length === 0) {
      this.state.creatures = [];
      return;
    }

    const moved: Creature[] = [];
    const exiting: Creature[] = [];

    for (const creature of this.state.creatures) {
      const currentPathNode = this.currentWavePath[creature.pathIndex];
      if (!currentPathNode) {
        exiting.push(creature);
        continue;
      }

      const sourceWear = this.getCellPathWear(currentPathNode.x, currentPathNode.y);
      const speedUnits = getCreatureMovementSpeedUnits(sourceWear);
      const fromPathIndex = creature.pathIndex;
      const fromProgressUnits = creature.pathProgressUnits;
      let progressUnits = creature.pathProgressUnits + speedUnits;
      let nextPathIndex = creature.pathIndex;
      const steps: Array<{
        fromPathIndex: number;
        toPathIndex: number;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
      }> = [];
      let exited = false;

      while (progressUnits >= MOVEMENT_PROGRESS_UNITS_PER_CELL) {
        const targetPathIndex = nextPathIndex + 1;
        if (targetPathIndex >= this.currentWavePath.length) {
          exited = true;
          progressUnits = 0;
          break;
        }

        const fromPathNode = this.currentWavePath[nextPathIndex];
        const toPathNode = this.currentWavePath[targetPathIndex];
        if (!fromPathNode || !toPathNode) {
          exited = true;
          progressUnits = 0;
          break;
        }

        steps.push({
          fromPathIndex: nextPathIndex,
          toPathIndex: targetPathIndex,
          fromX: fromPathNode.x,
          fromY: fromPathNode.y,
          toX: toPathNode.x,
          toY: toPathNode.y
        });
        progressUnits -= MOVEMENT_PROGRESS_UNITS_PER_CELL;
        nextPathIndex = targetPathIndex;
      }

      const finalPathNode = this.currentWavePath[nextPathIndex] ?? currentPathNode;

      this.state.events.push({
        type: "movement-resolved",
        wave: this.state.wave,
        tick: this.state.waveTick,
        creatureId: creature.id,
        fromPathIndex,
        toPathIndex: exited ? this.currentWavePath.length : nextPathIndex,
        fromProgressUnits,
        toProgressUnits: exited ? 0 : progressUnits,
        speedUnits,
        sourceCellWear: sourceWear,
        steps,
        finalX: finalPathNode.x,
        finalY: finalPathNode.y,
        exited
      });

      const progressDelta = exited
        ? (steps.length * MOVEMENT_PROGRESS_UNITS_PER_CELL) - fromProgressUnits
        : ((nextPathIndex - fromPathIndex) * MOVEMENT_PROGRESS_UNITS_PER_CELL) + (progressUnits - fromProgressUnits);
      this.state.telemetry.currentWave.movementProgressUnits += Math.max(0, progressDelta);
      this.state.telemetry.currentWave.movementSteps += steps.length;
      if (exited) {
        this.state.telemetry.currentWave.creaturesExited += 1;
      }
      this.updateCurrentWaveTelemetryTick();

      if (exited) {
        exiting.push({
          ...creature,
          pathIndex: nextPathIndex,
          x: finalPathNode.x,
          y: finalPathNode.y,
          pathProgressUnits: 0
        });
        continue;
      }

      moved.push({
        ...creature,
        pathIndex: nextPathIndex,
        x: finalPathNode.x,
        y: finalPathNode.y,
        pathProgressUnits: progressUnits
      });
    }

    this.state.creatures = moved;

    for (const creature of exiting) {
      this.state.events.push({
        type: "creature-exited",
        wave: this.state.wave,
        tick: this.state.waveTick,
        creatureId: creature.id,
        pathIndex: creature.pathIndex,
        x: creature.x,
        y: creature.y
      });
    }
  }

  private selectTargetsForCurrentTick(): void {
    const assignments = this.computeTargetAssignments();
    this.state.targetAssignments = assignments;
    this.state.events.push({
      type: "targets-selected",
      wave: this.state.wave,
      tick: this.state.waveTick,
      assignments: assignments.map((assignment) => ({ ...assignment }))
    });
  }

  private resolveCombatForCurrentTick(): void {
    if (this.state.targetAssignments.length === 0 || this.state.creatures.length === 0) {
      return;
    }

    const creaturesById = new Map<string, Creature>(
      this.state.creatures.map((creature) => [creature.id, { ...creature }])
    );

    const sortedAssignments = [...this.state.targetAssignments].sort((a, b) =>
      a.towerId.localeCompare(b.towerId)
    );

    for (const assignment of sortedAssignments) {
      if (!assignment.targetCreatureId) {
        continue;
      }

      const tower = this.state.towers.find((entry) => entry.id === assignment.towerId);
      if (!tower) {
        continue;
      }

      const creature = creaturesById.get(assignment.targetCreatureId);
      if (!creature || creature.hp <= 0) {
        continue;
      }

      const damage = this.getTowerDamage(tower);
      creature.hp -= damage;
      this.state.telemetry.currentWave.towerDamageDealt += damage;
      this.updateCurrentWaveTelemetryTick();

      this.state.events.push({
        type: "tower-hit",
        wave: this.state.wave,
        tick: this.state.waveTick,
        towerId: tower.id,
        playerId: tower.playerId,
        creatureId: creature.id,
        damage,
        remainingHp: Math.max(0, creature.hp)
      });

      if (creature.hp <= 0) {
        creaturesById.delete(creature.id);
        const rewardPoints = getCreatureRewardPoints(creature.archetype);
        this.awardPoints(tower.playerId, rewardPoints);
        this.state.telemetry.currentWave.creaturesDefeated += 1;
        this.state.telemetry.currentWave.killsByArchetype[creature.archetype] += 1;
        this.updateCurrentWaveTelemetryTick();
        this.state.events.push({
          type: "creature-defeated",
          wave: this.state.wave,
          tick: this.state.waveTick,
          towerId: tower.id,
          playerId: tower.playerId,
          creatureId: creature.id,
          rewardPoints
        });
      } else {
        creaturesById.set(creature.id, creature);
      }
    }

    this.state.creatures = [...creaturesById.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  private resolveCreatureAttacksForCurrentTick(): void {
    if (this.state.creatures.length === 0 || this.state.towers.length === 0) {
      return;
    }

    const towersById = new Map<string, Tower>(this.state.towers.map((tower) => [tower.id, { ...tower }]));
    const assignments = this.computeCreatureTargetAssignments(towersById);
    this.state.events.push({
      type: "creature-targets-selected",
      wave: this.state.wave,
      tick: this.state.waveTick,
      assignments: assignments.map((assignment) => ({ ...assignment }))
    });

    const sortedAssignments = [...assignments].sort((a, b) => a.creatureId.localeCompare(b.creatureId));
    for (const assignment of sortedAssignments) {
      if (!assignment.targetTowerId) {
        continue;
      }

      const creature = this.state.creatures.find((entry) => entry.id === assignment.creatureId);
      if (!creature || creature.hp <= 0) {
        continue;
      }

      const tower = towersById.get(assignment.targetTowerId);
      if (!tower || tower.health <= 0) {
        continue;
      }

      const damage = this.getCreatureAttackDamage(creature);
      tower.health -= damage;
      this.state.telemetry.currentWave.towerDamageIntake += damage;
      this.updateCurrentWaveTelemetryTick();
      this.state.events.push({
        type: "creature-attack",
        wave: this.state.wave,
        tick: this.state.waveTick,
        creatureId: creature.id,
        targetTowerId: tower.id,
        damage,
        remainingHp: Math.max(0, tower.health)
      });

      if (tower.health <= 0) {
        towersById.delete(tower.id);
        this.state.events.push({
          type: "tower-destroyed",
          wave: this.state.wave,
          tick: this.state.waveTick,
          towerId: tower.id,
          playerId: tower.playerId,
          destroyedByCreatureId: creature.id
        });

        const player = this.state.players.find((entry) => entry.id === tower.playerId);
        if (player) {
          player.eliminated = true;
          player.readyForWave = false;
        }

        this.state.creatures = this.state.creatures.map((entry) =>
          entry.targetTowerId === tower.id ? { ...entry, targetTowerId: "tower-missing" } : entry
        );
      } else {
        towersById.set(tower.id, tower);
      }
    }

    this.state.towers = [...towersById.values()].sort((a, b) => a.id.localeCompare(b.id));
    this.checkFailStateAfterTowerDestruction();
  }

  private resolveCreatureWallAttacksForCurrentTick(): void {
    if (this.state.creatures.length === 0 || this.state.walls.length === 0) {
      return;
    }

    const wallsById = new Map<string, Wall>(this.state.walls.map((wall) => [wall.id, { ...wall }]));
    const assignments = this.computeCreatureWallTargetAssignments(wallsById);
    this.state.events.push({
      type: "creature-wall-targets-selected",
      wave: this.state.wave,
      tick: this.state.waveTick,
      assignments: assignments.map((assignment) => ({ ...assignment }))
    });

    const sortedAssignments = [...assignments].sort((a, b) => a.creatureId.localeCompare(b.creatureId));
    let destroyedWall = false;

    for (const assignment of sortedAssignments) {
      if (!assignment.targetWallId) {
        continue;
      }

      const creature = this.state.creatures.find((entry) => entry.id === assignment.creatureId);
      if (!creature || creature.hp <= 0) {
        continue;
      }

      const wall = wallsById.get(assignment.targetWallId);
      if (!wall || wall.health <= 0) {
        continue;
      }

      const damage = this.getCreatureAttackDamage(creature);
      wall.health -= damage;
      this.state.telemetry.currentWave.wallDamageIntake += damage;
      this.updateCurrentWaveTelemetryTick();
      this.state.events.push({
        type: "wall-hit",
        wave: this.state.wave,
        tick: this.state.waveTick,
        creatureId: creature.id,
        targetWallId: wall.id,
        damage,
        remainingHp: Math.max(0, wall.health)
      });

      if (wall.health <= 0) {
        wallsById.delete(wall.id);
        destroyedWall = true;
        this.state.events.push({
          type: "wall-destroyed",
          wave: this.state.wave,
          tick: this.state.waveTick,
          wallId: wall.id,
          playerId: wall.playerId,
          destroyedByCreatureId: creature.id
        });
      } else {
        wallsById.set(wall.id, wall);
      }
    }

    this.state.walls = [...wallsById.values()].sort((a, b) => a.id.localeCompare(b.id));

    if (destroyedWall && this.state.towers[0]) {
      this.currentWavePath.length = 0;
      this.currentWavePath.push(
        ...getOpenPathForCreatures(this.state.map, this.state.towers[0], this.state.walls)
      );
    }
  }

  private computeTargetAssignments(): TowerTargetAssignment[] {
    const towers = [...this.state.towers].sort((a, b) => a.id.localeCompare(b.id));
    return towers.map((tower) => ({
      towerId: tower.id,
      mode: tower.targetMode,
      targetCreatureId: this.selectCreatureTargetForTower(tower)?.id ?? null
    }));
  }

  private selectCreatureTargetForTower(tower: Tower): Creature | undefined {
    if (this.state.creatures.length === 0) {
      return undefined;
    }

    const creatures = [...this.state.creatures].sort((a, b) => a.id.localeCompare(b.id));
    let best = creatures[0];
    if (!best) {
      return undefined;
    }

    for (const creature of creatures.slice(1)) {
      if (this.isCreatureBetterTarget(tower, creature, best)) {
        best = creature;
      }
    }

    return best;
  }

  private isCreatureBetterTarget(tower: Tower, candidate: Creature, current: Creature): boolean {
    if (tower.targetMode === "first") {
      return this.compareFirst(tower, candidate, current) < 0;
    }

    if (tower.targetMode === "last") {
      return this.compareLast(tower, candidate, current) < 0;
    }

    if (tower.targetMode === "strongest") {
      return this.compareStrongest(tower, candidate, current) < 0;
    }

    return this.compareNearest(tower, candidate, current) < 0;
  }

  private compareFirst(tower: Tower, a: Creature, b: Creature): number {
    const pathIndexCompare = b.pathIndex - a.pathIndex;
    if (pathIndexCompare !== 0) {
      return pathIndexCompare;
    }

    return this.compareByFallbackOrder(tower, a, b);
  }

  private compareLast(tower: Tower, a: Creature, b: Creature): number {
    const pathIndexCompare = a.pathIndex - b.pathIndex;
    if (pathIndexCompare !== 0) {
      return pathIndexCompare;
    }

    return this.compareByFallbackOrder(tower, a, b);
  }

  private compareStrongest(tower: Tower, a: Creature, b: Creature): number {
    const hpCompare = b.hp - a.hp;
    if (hpCompare !== 0) {
      return hpCompare;
    }

    const pathIndexCompare = b.pathIndex - a.pathIndex;
    if (pathIndexCompare !== 0) {
      return pathIndexCompare;
    }

    return this.compareByFallbackOrder(tower, a, b);
  }

  private compareNearest(tower: Tower, a: Creature, b: Creature): number {
    const distanceA = this.getSquaredDistance(tower, a);
    const distanceB = this.getSquaredDistance(tower, b);
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }

    const pathIndexCompare = b.pathIndex - a.pathIndex;
    if (pathIndexCompare !== 0) {
      return pathIndexCompare;
    }

    return this.compareByFallbackOrder(tower, a, b);
  }

  private compareByFallbackOrder(tower: Tower, a: Creature, b: Creature): number {
    const spawnTickCompare = a.spawnTick - b.spawnTick;
    if (spawnTickCompare !== 0) {
      return spawnTickCompare;
    }

    const distanceCompare = this.getSquaredDistance(tower, a) - this.getSquaredDistance(tower, b);
    if (distanceCompare !== 0) {
      return distanceCompare;
    }

    return a.id.localeCompare(b.id);
  }

  private getSquaredDistance(tower: Tower, creature: Creature): number {
    const dx = tower.x - creature.x;
    const dy = tower.y - creature.y;
    return (dx * dx) + (dy * dy);
  }

  private getTowerDamage(tower: Tower): number {
    return Math.max(1, tower.level);
  }

  private getCreatureAttackDamage(creature: Creature): number {
    return Math.max(1, getCreatureAttackDamage(creature.archetype));
  }

  private computeCreatureTargetAssignments(
    towersById: Map<string, Tower>
  ): Array<{ creatureId: string; targetTowerId: string | null }> {
    const creatures = [...this.state.creatures].sort((a, b) => a.id.localeCompare(b.id));
    return creatures.map((creature) => ({
      creatureId: creature.id,
      targetTowerId: this.selectTowerTargetForCreature(creature, towersById)?.id ?? null
    }));
  }

  private computeCreatureWallTargetAssignments(
    wallsById: Map<string, Wall>
  ): CreatureWallTargetAssignment[] {
    const creatures = [...this.state.creatures].sort((a, b) => a.id.localeCompare(b.id));
    return creatures.map((creature) => ({
      creatureId: creature.id,
      targetWallId: this.selectWallTargetForCreature(creature, wallsById)?.id ?? null
    }));
  }

  private selectTowerTargetForCreature(creature: Creature, towersById: Map<string, Tower>): Tower | undefined {
    const currentTarget = creature.targetTowerId ? towersById.get(creature.targetTowerId) : undefined;
    if (currentTarget) {
      return currentTarget;
    }

    const candidates = [...towersById.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (candidates.length === 0) {
      return undefined;
    }

    let best = candidates[0];
    if (!best) {
      return undefined;
    }
    for (const candidate of candidates.slice(1)) {
      if (this.isTowerBetterCreatureTarget(creature, candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private selectWallTargetForCreature(creature: Creature, wallsById: Map<string, Wall>): Wall | undefined {
    const candidates = [...wallsById.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (candidates.length === 0) {
      return undefined;
    }

    let best = candidates[0];
    if (!best) {
      return undefined;
    }

    for (const candidate of candidates.slice(1)) {
      if (this.isWallBetterCreatureTarget(creature, candidate, best)) {
        best = candidate;
      }
    }

    return best;
  }

  private isTowerBetterCreatureTarget(creature: Creature, candidate: Tower, current: Tower): boolean {
    const candidateDistance = this.getSquaredTowerDistanceForCreature(creature, candidate);
    const currentDistance = this.getSquaredTowerDistanceForCreature(creature, current);
    if (candidateDistance !== currentDistance) {
      return candidateDistance < currentDistance;
    }

    if (candidate.health !== current.health) {
      return candidate.health < current.health;
    }

    return candidate.id.localeCompare(current.id) < 0;
  }

  private isWallBetterCreatureTarget(creature: Creature, candidate: Wall, current: Wall): boolean {
    const candidateDistance = this.getSquaredWallDistanceForCreature(creature, candidate);
    const currentDistance = this.getSquaredWallDistanceForCreature(creature, current);
    if (candidateDistance !== currentDistance) {
      return candidateDistance < currentDistance;
    }

    if (candidate.health !== current.health) {
      return candidate.health < current.health;
    }

    return candidate.id.localeCompare(current.id) < 0;
  }

  private getSquaredTowerDistanceForCreature(creature: Creature, tower: Tower): number {
    const dx = creature.x - tower.x;
    const dy = creature.y - tower.y;
    return (dx * dx) + (dy * dy);
  }

  private getSquaredWallDistanceForCreature(creature: Creature, wall: Wall): number {
    const dx = creature.x - wall.x;
    const dy = creature.y - wall.y;
    return (dx * dx) + (dy * dy);
  }

  private getCellPathWear(x: number, y: number): number {
    const cell = this.state.map.cells.find((entry) => entry.x === x && entry.y === y);
    if (!cell) {
      return 0;
    }

    return Math.max(0, Math.min(PATH_CELL_MAX_WEAR, cell.pathWear));
  }

  private checkFailStateAfterTowerDestruction(): void {
    if (this.state.phase === "ended") {
      return;
    }

    if (this.state.towers.length > 0) {
      return;
    }

    this.state.phase = "ended";
    this.state.endReason = "all-towers-destroyed";
    this.state.targetAssignments = [];
    for (const player of this.state.players) {
      player.readyForWave = false;
      player.eliminated = true;
    }
  }

  private isWaveComplete(): boolean {
    const plan = this.getWaveSpawnPlan();
    return this.currentWaveSpawned >= plan.totalCreatures && this.state.creatures.length === 0;
  }

  private endWave(): void {
    const waveCleared = this.isWaveCleared();
    this.repairTowersBetweenWaves();
    this.repairWallsBetweenWaves();
    this.repairPathWearBetweenWaves();
    this.awardWaveClearBonus(waveCleared);
    if (this.state.phase === "ended") {
      return;
    }
    this.emitTelemetrySnapshotEvent();
    const completedWaveTelemetry = cloneWaveTelemetrySnapshot(this.state.telemetry.currentWave);
    this.state.telemetry.completedWaves.push(completedWaveTelemetry);
    this.emitBalanceAnalysisExportEvent(completedWaveTelemetry);
    this.state.events.push({
      type: "wave-end",
      wave: this.state.wave,
      tick: this.state.waveTick
    });
    this.state.phase = "placement";
    this.state.wave += 1;
    this.state.waveTick = 0;
    this.state.telemetry.currentWave = createWaveTelemetrySnapshot(this.state.wave, this.state.waveTick);
    this.state.targetAssignments = [];
    for (const player of this.state.players) {
      player.readyForWave = false;
    }
  }

  private isWaveCleared(): boolean {
    const telemetry = this.state.telemetry.currentWave;
    return telemetry.creaturesSpawned > 0 && telemetry.creaturesExited === 0;
  }

  private awardWaveClearBonus(cleared: boolean): void {
    if (!cleared) {
      return;
    }

    const bonus = getWaveClearBonus();
    const recipients = [...this.state.players]
      .filter((player) => !player.eliminated)
      .filter((player) => this.state.towers.some((tower) => tower.playerId === player.id && tower.health > 0));

    for (const player of recipients) {
      this.awardPoints(player.id, bonus);
      this.state.playerWaveClearBonusTotal[player.id] =
        (this.state.playerWaveClearBonusTotal[player.id] ?? 0) + bonus;
      this.state.playerWaveClearBonusCurrentWave[player.id] =
        (this.state.playerWaveClearBonusCurrentWave[player.id] ?? 0) + bonus;
      this.state.telemetry.currentWave.waveClearBonusAwarded += bonus;
      this.updateCurrentWaveTelemetryTick();
      this.state.events.push({
        type: "wave-clear-bonus",
        wave: this.state.wave,
        tick: this.state.waveTick,
        playerId: player.id,
        bonus,
        cleared
      });
    }
  }

  private repairTowersBetweenWaves(): void {
    const towers = [...this.state.towers].sort((a, b) => a.id.localeCompare(b.id));

    for (const tower of towers) {
      if (tower.health <= 0) {
        continue;
      }

      const player = this.state.players.find((entry) => entry.id === tower.playerId);
      if (!player || player.eliminated) {
        continue;
      }

      if (tower.health >= tower.maxHealth) {
        continue;
      }

      const repairAmount = Math.min(
        getBetweenWaveTowerRepairAmount(tower.maxHealth),
        tower.maxHealth - tower.health
      );

      if (repairAmount <= 0) {
        continue;
      }

      tower.health += repairAmount;
      this.state.telemetry.currentWave.towerRepairApplied += repairAmount;
      this.updateCurrentWaveTelemetryTick();
      this.state.events.push({
        type: "tower-repaired",
        wave: this.state.wave,
        tick: this.state.waveTick,
        towerId: tower.id,
        playerId: tower.playerId,
        repairAmount,
        remainingHp: tower.health
      });
    }

    this.state.towers = towers;
  }

  private repairWallsBetweenWaves(): void {
    const walls = [...this.state.walls].sort((a, b) => a.id.localeCompare(b.id));

    for (const wall of walls) {
      if (wall.health <= 0) {
        continue;
      }

      const player = this.state.players.find((entry) => entry.id === wall.playerId);
      if (!player || player.eliminated) {
        continue;
      }

      // Every wall takes deterministic structural strain each wave before repair.
      wall.health = Math.max(0, wall.health - 1);

      if (wall.health >= wall.maxHealth) {
        continue;
      }

      const repairAmount = Math.min(
        getBetweenWaveWallRepairAmount(wall.maxHealth),
        wall.maxHealth - wall.health
      );

      if (repairAmount <= 0) {
        continue;
      }

      wall.health += repairAmount;
      this.state.telemetry.currentWave.wallRepairApplied += repairAmount;
      this.updateCurrentWaveTelemetryTick();
      this.state.events.push({
        type: "wall-repaired",
        wave: this.state.wave,
        tick: this.state.waveTick,
        wallId: wall.id,
        playerId: wall.playerId,
        repairAmount,
        remainingHp: wall.health
      });
    }

    this.state.walls = walls;
  }

  private repairPathWearBetweenWaves(): void {
    const repairs: Array<{ x: number; y: number; wearBefore: number; wearAfter: number }> = [];

    for (const cell of this.state.map.cells) {
      const isWallCell = this.state.walls.some((wall) => wall.x === cell.x && wall.y === cell.y);
      const hadCreatureTraffic = this.state.events.some(
        (event) =>
          (event.type === "creature-spawned" || event.type === "creature-exited") &&
          event.wave === this.state.wave &&
          event.x === cell.x &&
          event.y === cell.y
      );

      const wearBeforeWave = Math.max(0, cell.pathWear);
      const wearAfterWaveLoad = Math.min(
        PATH_CELL_MAX_WEAR,
        wearBeforeWave + (isWallCell ? 2 : 0) + (hadCreatureTraffic ? 1 : 0)
      );
      const repairAmount = Math.min(BETWEEN_WAVE_PATH_WEAR_REPAIR, wearAfterWaveLoad);
      const wearAfter = wearAfterWaveLoad - repairAmount;
      cell.pathWear = wearAfter;

      if (repairAmount > 0) {
        repairs.push({
          x: cell.x,
          y: cell.y,
          wearBefore: wearAfterWaveLoad,
          wearAfter
        });
      }
    }

    if (repairs.length === 0) {
      return;
    }

    repairs.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    this.state.events.push({
      type: "path-repaired",
      wave: this.state.wave,
      tick: this.state.waveTick,
      repairs
    });
  }

  private updateCurrentWaveTelemetryTick(): void {
    this.state.telemetry.currentWave.tick = this.state.waveTick;
  }

  private emitTelemetrySnapshotEvent(): void {
    this.updateCurrentWaveTelemetryTick();
    this.state.events.push({
      type: "telemetry-snapshot",
      wave: this.state.wave,
      tick: this.state.waveTick,
      snapshot: cloneWaveTelemetrySnapshot(this.state.telemetry.currentWave)
    });
  }

  private emitBalanceAnalysisExportEvent(completedWaveTelemetry: WaveTelemetrySnapshot): void {
    const cumulativeTelemetry = createEmptyCumulativeTelemetrySnapshot();
    for (const waveTelemetry of this.state.telemetry.completedWaves) {
      accumulateWaveTelemetry(cumulativeTelemetry, waveTelemetry);
    }

    const players = [...this.state.players]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((player) => {
        const tower = this.state.towers.find((entry) => entry.playerId === player.id);
        const playerWalls = this.state.walls.filter((wall) => wall.playerId === player.id);
        const awardedTotal = this.state.playerAwardedPointsTotal[player.id] ?? 0;
        const spentWallsTotal = this.state.playerSpentOnWallsTotal[player.id] ?? 0;
        const spentUpgradesTotal = this.state.playerSpentOnUpgradesTotal[player.id] ?? 0;
        const awardedThisWave = this.state.playerAwardedPointsCurrentWave[player.id] ?? 0;
        const spentWallsThisWave = this.state.playerSpentOnWallsCurrentWave[player.id] ?? 0;
        const spentUpgradesThisWave = this.state.playerSpentOnUpgradesCurrentWave[player.id] ?? 0;
        const waveClearBonusThisWave = this.state.playerWaveClearBonusCurrentWave[player.id] ?? 0;
        const waveClearBonusTotal = this.state.playerWaveClearBonusTotal[player.id] ?? 0;
        const netThisWave = awardedThisWave - spentWallsThisWave - spentUpgradesThisWave;
        const netTotal = awardedTotal - spentWallsTotal - spentUpgradesTotal;

        return {
          playerId: player.id,
          playerName: player.name,
          eliminated: player.eliminated,
          awardedPointsThisWave: awardedThisWave,
          spentOnWallsThisWave: spentWallsThisWave,
          spentOnUpgradesThisWave: spentUpgradesThisWave,
          netPointsDeltaThisWave: netThisWave,
          awardedPointsTotal: awardedTotal,
          spentOnWallsTotal: spentWallsTotal,
          spentOnUpgradesTotal: spentUpgradesTotal,
          netPointsTotal: netTotal,
          endingPoints: player.points,
          waveClearBonusThisWave,
          waveClearBonusTotal,
          towerLevel: tower?.level ?? 0,
          towerHealth: tower?.health ?? 0,
          wallCount: playerWalls.length,
          wallHealthTotal: playerWalls.reduce((total, wall) => total + wall.health, 0)
        };
      });

    const totals = {
      awardedPointsThisWave: players.reduce((total, player) => total + player.awardedPointsThisWave, 0),
      spentOnWallsThisWave: players.reduce((total, player) => total + player.spentOnWallsThisWave, 0),
      spentOnUpgradesThisWave: players.reduce((total, player) => total + player.spentOnUpgradesThisWave, 0),
      netPointsDeltaThisWave: players.reduce((total, player) => total + player.netPointsDeltaThisWave, 0),
      awardedPointsTotal: players.reduce((total, player) => total + player.awardedPointsTotal, 0),
      spentOnWallsTotal: players.reduce((total, player) => total + player.spentOnWallsTotal, 0),
      spentOnUpgradesTotal: players.reduce((total, player) => total + player.spentOnUpgradesTotal, 0),
      netPointsTotal: players.reduce((total, player) => total + player.netPointsTotal, 0),
      endingPoints: players.reduce((total, player) => total + player.endingPoints, 0),
      waveClearBonusThisWave: players.reduce((total, player) => total + player.waveClearBonusThisWave, 0),
      waveClearBonusTotal: players.reduce((total, player) => total + player.waveClearBonusTotal, 0),
      livingTowers: this.state.towers.filter((tower) => tower.health > 0).length,
      livingWalls: this.state.walls.filter((wall) => wall.health > 0).length,
      totalTowerHealth: this.state.towers.reduce((total, tower) => total + Math.max(0, tower.health), 0),
      totalWallHealth: this.state.walls.reduce((total, wall) => total + Math.max(0, wall.health), 0),
      mapPathWearTotal: this.state.map.cells.reduce((total, cell) => total + cell.pathWear, 0)
    };

    const exportSnapshot: BalanceAnalysisSnapshot = {
      schemaVersion: 1,
      matchSeed: this.state.map.seed,
      exportOrdinal: this.state.balanceAnalysisExports.length + 1,
      wave: completedWaveTelemetry.wave,
      tick: completedWaveTelemetry.tick,
      waveTelemetry: cloneWaveTelemetrySnapshot(completedWaveTelemetry),
      cumulativeTelemetry,
      players,
      totals
    };

    this.state.balanceAnalysisExports.push(exportSnapshot);
    this.state.events.push({
      type: "balance-analysis-export",
      wave: completedWaveTelemetry.wave,
      tick: completedWaveTelemetry.tick,
      snapshot: {
        ...exportSnapshot,
        waveTelemetry: cloneWaveTelemetrySnapshot(exportSnapshot.waveTelemetry),
        cumulativeTelemetry: cloneCumulativeTelemetrySnapshot(exportSnapshot.cumulativeTelemetry),
        players: exportSnapshot.players.map((player) => ({ ...player })),
        totals: { ...exportSnapshot.totals }
      }
    });
  }
}

export function createMatch(setup: MatchSetup): MatchSimulation {
  return new MatchSimulation(setup);
}
