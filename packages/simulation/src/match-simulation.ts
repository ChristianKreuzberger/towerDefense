import {
  DEFAULT_TOWER_HEALTH,
  GAME_RULES,
  type CommandResult,
  type Creature,
  type GameMap,
  type MatchSetup,
  type MatchSnapshot,
  type PlayerState,
  type SimulationCommand,
  type Tower,
  isValidTowerPlacement,
  WIN_SCORE
} from "@tower-defense/shared";

import { generateMap } from "./procedural-map.js";

interface InternalMatchState {
  phase: "placement" | "wave" | "ended";
  wave: number;
  map: GameMap;
  towers: Tower[];
  creatures: Creature[];
  players: PlayerState[];
  winnerId?: string;
}

export class MatchSimulation {
  private readonly state: InternalMatchState;

  public constructor(setup: MatchSetup) {
    if (setup.players.length < GAME_RULES.minPlayers || setup.players.length > GAME_RULES.maxPlayers) {
      throw new Error(
        `player count must be between ${GAME_RULES.minPlayers} and ${GAME_RULES.maxPlayers}`
      );
    }

    this.state = {
      phase: "placement",
      wave: 1,
      map: generateMap(setup.seed),
      towers: [],
      creatures: [],
      players: setup.players.map((player) => ({
        id: player.id,
        name: player.name,
        points: 0,
        hasPlacedTower: false
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
        level: 1
      });

      if (this.state.players.every((entry) => entry.hasPlacedTower)) {
        this.state.phase = "wave";
      }

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
      map: {
        width: this.state.map.width,
        height: this.state.map.height,
        seed: this.state.map.seed,
        cells: this.state.map.cells.map((cell) => ({ ...cell }))
      },
      towers: this.state.towers.map((tower) => ({ ...tower })),
      creatures: this.state.creatures.map((creature) => ({ ...creature })),
      players: this.state.players.map((player) => ({ ...player })),
      ...(this.state.winnerId ? { winnerId: this.state.winnerId } : {})
    };
  }
}

export function createMatch(setup: MatchSetup): MatchSimulation {
  return new MatchSimulation(setup);
}
