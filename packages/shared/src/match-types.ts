import type { Creature } from "./creature-types.js";
import type { GameMap } from "./map-types.js";
import type { Tower } from "./tower-types.js";
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
  map: GameMap;
  towers: Tower[];
  walls: Wall[];
  creatures: Creature[];
  players: PlayerState[];
  winnerId?: string;
}

export type CommandRejectReason =
  | "match-already-ended"
  | "placement-phase-not-active"
  | "unknown-player"
  | "tower-already-placed"
  | "wall-phase-not-active"
  | "out-of-bounds"
  | "cell-not-buildable"
  | "tower-overlap"
  | "wall-overlap"
  | "path-blocked"
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
    };
