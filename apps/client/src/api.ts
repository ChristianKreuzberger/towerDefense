import type { MapCell, MatchSetup, MatchSnapshot } from "@tower-defense/shared";
import { createFetchRequester, createGameClient } from "@tower-defense/transport/http-client";
import type { GameRequester } from "@tower-defense/transport/http-client";
import { perfRecordBytes } from "./perf";

// The client only talks to the host through the transport package; this module just picks the requester.
function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  return "";
}

// GitHub Pages has no backend, so that build hosts the game API in the page itself.
const inBrowserServer = import.meta.env.VITE_IN_BROWSER_SERVER === "true";

const requester: GameRequester = inBrowserServer
  ? async (method, path, payload) => {
      const { localRequest } = await import("./local-host.js");
      return localRequest(method, path, payload);
    }
  : createFetchRequester(apiBase(), undefined, { timeoutMs: 10_000 });

const client = createGameClient(requester, { onResponseText: (text) => perfRecordBytes(text.length) });

export const getJson = client.get;
export const postJson = client.post;

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

export type ApiAdvanceManyPayload = {
  ok: boolean;
  acceptedTicks?: number;
  stoppedReason?: string;
  snapshot?: WireSnapshot;
  error?: string;
  message?: string;
};
