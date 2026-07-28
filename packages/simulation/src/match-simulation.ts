import {
  GAME_RULES,
  type MatchSetup,
  type MatchSnapshot,
  type PlayerState,
  type SimulationCommand,
  WIN_SCORE
} from "@tower-defense/shared";

interface InternalMatchState {
  phase: "placement" | "wave" | "ended";
  wave: number;
  players: PlayerState[];
  winnerId?: string;
}

export interface CommandResult {
  accepted: boolean;
  reason?: string;
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
      return { accepted: false, reason: "match already ended" };
    }

    if (command.type === "place-tower") {
      if (this.state.phase !== "placement") {
        return { accepted: false, reason: "placement phase not active" };
      }

      const player = this.state.players.find((entry) => entry.id === command.playerId);
      if (!player) {
        return { accepted: false, reason: "unknown player" };
      }

      if (player.hasPlacedTower) {
        return { accepted: false, reason: "tower already placed" };
      }

      player.hasPlacedTower = true;
      player.tower = {
        playerId: command.playerId,
        x: command.x,
        y: command.y
      };

      if (this.state.players.every((entry) => entry.hasPlacedTower)) {
        this.state.phase = "wave";
      }

      return { accepted: true };
    }

    return { accepted: false, reason: "unsupported command" };
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
      players: this.state.players.map((player) => ({ ...player })),
      ...(this.state.winnerId ? { winnerId: this.state.winnerId } : {})
    };
  }
}

export function createMatch(setup: MatchSetup): MatchSimulation {
  return new MatchSimulation(setup);
}
