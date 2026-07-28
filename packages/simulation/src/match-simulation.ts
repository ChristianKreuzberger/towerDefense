import {
  DEFAULT_TOWER_TARGET_MODE,
  DEFAULT_TOWER_HEALTH,
  GAME_RULES,
  type CommandResult,
  type MatchEvent,
  type Creature,
  type GameMap,
  type MatchSetup,
  type MatchSnapshot,
  type PlayerState,
  type SimulationCommand,
  type Tower,
  type Wall,
  getWallCost,
  getTowerUpgradeCost,
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
  players: PlayerState[];
  events: MatchEvent[];
  winnerId?: string;
}

interface WaveSpawnPlan {
  totalCreatures: number;
  spawnIntervalTicks: number;
}

const WAVE_SPAWN_ARCHETYPES: readonly Creature["archetype"][] = ["runner", "swarm", "armored", "tank"];

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
      events: [],
      players: setup.players.map((player) => ({
        id: player.id,
        name: player.name,
        points: 0,
        hasPlacedTower: false,
        readyForWave: false
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

      this.spawnCreaturesForCurrentTick();
      this.moveCreaturesForCurrentTick();

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
      this.state.walls.push({
        id: `wall-${this.state.walls.length + 1}`,
        playerId: command.playerId,
        x: command.x,
        y: command.y
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
    if (player.points >= WIN_SCORE) {
      this.state.phase = "ended";
      this.state.winnerId = playerId;
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
      map: {
        width: this.state.map.width,
        height: this.state.map.height,
        seed: this.state.map.seed,
        cells: this.state.map.cells.map((cell) => ({ ...cell }))
      },
      towers: this.state.towers.map((tower) => ({ ...tower })),
      walls: this.state.walls.map((wall) => ({ ...wall })),
      creatures: this.state.creatures.map((creature) => ({ ...creature })),
      players: this.state.players.map((player) => ({ ...player })),
      events: this.state.events.map((event) => ({ ...event })),
      ...(this.state.winnerId ? { winnerId: this.state.winnerId } : {})
    };
  }

  private startWave(): void {
    this.state.phase = "wave";
    this.state.waveTick = 0;
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
      hp: 1,
      x: firstPathNode.x,
      y: firstPathNode.y,
      pathIndex: 0,
      spawnTick: this.state.waveTick,
      targetTowerId: this.state.towers[0]?.id ?? "tower-missing"
    };

    this.currentWaveSpawned += 1;
    this.state.creatures.push(creature);
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
      const nextPathIndex = creature.pathIndex + 1;
      if (nextPathIndex >= this.currentWavePath.length) {
        exiting.push(creature);
        continue;
      }

      const nextPathNode = this.currentWavePath[nextPathIndex];
      if (!nextPathNode) {
        exiting.push(creature);
        continue;
      }

      moved.push({
        ...creature,
        pathIndex: nextPathIndex,
        x: nextPathNode.x,
        y: nextPathNode.y
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

  private isWaveComplete(): boolean {
    const plan = this.getWaveSpawnPlan();
    return this.currentWaveSpawned >= plan.totalCreatures && this.state.creatures.length === 0;
  }

  private endWave(): void {
    this.state.events.push({
      type: "wave-end",
      wave: this.state.wave,
      tick: this.state.waveTick
    });
    this.state.phase = "placement";
    this.state.wave += 1;
    this.state.waveTick = 0;
    for (const player of this.state.players) {
      player.readyForWave = false;
    }
  }
}

export function createMatch(setup: MatchSetup): MatchSimulation {
  return new MatchSimulation(setup);
}
