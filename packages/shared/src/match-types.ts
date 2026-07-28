import type { Creature } from "./creature-types.js";
import type { GameMap } from "./map-types.js";
import type { Tower } from "./tower-types.js";

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
  creatures: Creature[];
  players: PlayerState[];
  winnerId?: string;
}

export type CommandRejectReason =
  | "match-already-ended"
  | "placement-phase-not-active"
  | "unknown-player"
  | "tower-already-placed"
  | "out-of-bounds"
  | "cell-not-buildable"
  | "tower-overlap"
  | "path-blocked"
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
    };
