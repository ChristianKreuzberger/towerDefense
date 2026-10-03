import type { MapCell, MatchSetup, MatchSnapshot, SimulationCommand } from "@tower-defense/shared";

// Snapshot as sent by the host: lite responses carry wornCells/eventsOffset instead of map.cells (see spec/07).
export type WireSnapshot = Omit<MatchSnapshot, "map"> & {
  map: {
    schemaVersion: number;
    width: number;
    height: number;
    seed: number;
    spawn?: { x: number; y: number };
    goal?: { x: number; y: number };
    cells?: MapCell[];
    towerSpots: Array<{ x: number; y: number }>;
    wornCells?: Array<{ x: number; y: number; pathWear: number }>;
  };
  eventsOffset?: number;
  eventsTotal?: number;
};

export type ApiStartPayload = {
  ok: boolean;
  snapshot?: WireSnapshot;
  setup?: MatchSetup;
  error?: string;
  message?: string;
};

export type ApiCommandPayload = {
  ok: boolean;
  result?: {
    accepted: boolean;
    reason?: string;
  };
  snapshot?: WireSnapshot;
  error?: string;
  message?: string;
};

export type ApiAiStepPayload = {
  ok: boolean;
  action?: { playerId: string; command: SimulationCommand; accepted: boolean } | null;
  pending?: boolean;
  snapshot?: WireSnapshot;
  error?: string;
  message?: string;
};

export type ApiAdvanceManyPayload = {
  ok: boolean;
  acceptedTicks?: number;
  stoppedReason?: string;
  snapshot?: WireSnapshot;
  error?: string;
  message?: string;
};
