import type { Creature, CreatureArchetype } from "./creature-types.js";
import type { GameMap } from "./map-types.js";
import type { Tower, TowerTargetMode } from "./tower-types.js";
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
      type: "wave-end";
      wave: number;
      tick: number;
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
  tower?: TowerPlacement;
}

export interface MatchSnapshot {
  phase: MatchPhase;
  wave: number;
  waveTick: number;
  allPlayersReadyForWave: boolean;
  map: GameMap;
  towers: Tower[];
  walls: Wall[];
  creatures: Creature[];
  players: PlayerState[];
  events: MatchEvent[];
  winnerId?: string;
}

export type CommandRejectReason =
  | "match-already-ended"
  | "placement-phase-not-active"
  | "ready-phase-not-active"
  | "wave-phase-not-active"
  | "unknown-player"
  | "tower-already-placed"
  | "tower-not-placed"
  | "wall-phase-not-active"
  | "player-already-ready-for-wave"
  | "invalid-upgrade-target"
  | "invalid-target-mode-target"
  | "invalid-target-mode"
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
    }
  | {
      type: "upgrade-tower";
      playerId: string;
      towerId: string;
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
