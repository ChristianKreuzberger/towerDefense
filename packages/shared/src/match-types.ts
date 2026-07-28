export interface PlayerSetup {
  id: string;
  name: string;
}

export interface MatchSetup {
  players: PlayerSetup[];
  seed: number;
}

export type MatchPhase = "placement" | "wave" | "ended";

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
  tower?: TowerPlacement;
}

export interface MatchSnapshot {
  phase: MatchPhase;
  wave: number;
  players: PlayerState[];
  winnerId?: string;
}

export type SimulationCommand =
  | {
      type: "place-tower";
      playerId: string;
      x: number;
      y: number;
    };
