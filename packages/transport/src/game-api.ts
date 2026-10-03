// Transport-agnostic game API: the Node server and the in-browser (GitHub Pages) host both route through this.
import { stepAiPlayers } from "@tower-defense/simulation/ai-player";
import { createMatch, type MatchSimulation } from "@tower-defense/simulation/match";
import {
  AI_DIFFICULTIES,
  MAX_PLAYER_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PROJECT_NAME,
  DAMAGE_TYPES,
  UPGRADE_TRACKS,
  isValidAiDifficulty,
  isValidDamageType,
  isValidUpgradeTrack,
  type MatchSetup,
  type MatchSnapshot,
  type TowerTargetMode,
  type SimulationCommand
} from "@tower-defense/shared";
import type { WireSnapshot } from "./wire-types.js";

export interface GameApiRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  body: unknown;
}

export interface GameApiResponse {
  status: number;
  payload: unknown;
}

export interface GameApiLogger {
  info(fields: Record<string, unknown>, message: string): void;
}

const TARGET_MODES: TowerTargetMode[] = ["first", "last", "strongest", "nearest"];
const DEFAULT_SEED = 777;

// Input the host refuses to coerce. Hosts turn it into a structured 400 (see spec/07, error strategy).
export class GameApiError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "GameApiError";
  }
}

function normalizeSetup(body: unknown): MatchSetup {
  const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};

  // A missing seed uses the default; a present but invalid one (empty, NaN, fractional, text) is an error.
  const seed = source.seed === undefined ? DEFAULT_SEED : source.seed;
  if (typeof seed !== "number" || !Number.isInteger(seed)) {
    throw new GameApiError("invalid-setup", "seed must be a finite integer");
  }

  const inputPlayers = Array.isArray(source.players) ? source.players : [];
  if (inputPlayers.length < MIN_PLAYERS || inputPlayers.length > MAX_PLAYERS) {
    throw new GameApiError("invalid-setup", `player count must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
  }

  const players = inputPlayers.map((entry, index) => {
    if (typeof entry !== "object" || !entry) {
      throw new GameApiError("invalid-setup", `player ${index + 1} must be an object`);
    }

    const mapped = entry as Record<string, unknown>;
    const id = typeof mapped.id === "string" && mapped.id.trim().length > 0
      ? mapped.id.trim()
      : `p${index + 1}`;
    const name = typeof mapped.name === "string" && mapped.name.trim().length > 0
      ? mapped.name.trim()
      : `Player ${index + 1}`;
    if (name.length > MAX_PLAYER_NAME_LENGTH) {
      throw new GameApiError("invalid-setup", `player names are limited to ${MAX_PLAYER_NAME_LENGTH} characters`);
    }

    if (mapped.ai !== undefined && !isValidAiDifficulty(mapped.ai)) {
      throw new GameApiError("invalid-ai-difficulty", `ai must be one of ${AI_DIFFICULTIES.join(", ")}`);
    }

    return mapped.ai === undefined ? { id, name } : { id, name, ai: mapped.ai };
  });

  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new GameApiError("invalid-setup", "player ids must be unique");
  }

  return { players, seed };
}

interface SnapshotOptions {
  lite: boolean;
  eventsSince: number;
}

function snapshotOptionsFromQuery(params: URLSearchParams): SnapshotOptions {
  return {
    lite: params.get("lite") === "1",
    eventsSince: Math.max(0, Math.floor(Number(params.get("eventsSince") ?? 0)) || 0)
  };
}

function snapshotOptionsFromBody(body: unknown): SnapshotOptions {
  const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  return {
    lite: source.lite === true,
    eventsSince: Math.max(0, Math.floor(Number(source.eventsSince ?? 0)) || 0)
  };
}

// Lite snapshots drop data that is static per map or only useful for analysis (see spec/07).
function toWireSnapshot(snapshot: MatchSnapshot, options: SnapshotOptions): WireSnapshot {
  if (!options.lite) {
    return snapshot;
  }

  const { cells, ...mapRest } = snapshot.map;
  const wornCells = cells
    .filter((cell) => cell.pathWear > 0)
    .map((cell) => ({ x: cell.x, y: cell.y, pathWear: cell.pathWear }));
  const eventsSince = Math.min(options.eventsSince, snapshot.events.length);

  return {
    ...snapshot,
    map: { ...mapRest, wornCells },
    events: snapshot.events.slice(eventsSince),
    eventsOffset: eventsSince,
    eventsTotal: snapshot.events.length,
    telemetry: { ...snapshot.telemetry, completedWaves: [] },
    balanceAnalysisExports: []
  };
}

function parseCommand(body: unknown): SimulationCommand {
  const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  const commandSource = typeof source.command === "object" && source.command
    ? (source.command as Record<string, unknown>)
    : null;

  if (!commandSource || typeof commandSource.type !== "string") {
    throw new GameApiError("invalid-command", "invalid command payload");
  }

  const type = commandSource.type;
  const text = (field: string): string => {
    const value = commandSource[field];
    if (typeof value !== "string") {
      throw new GameApiError("invalid-command", `${type}: ${field} must be a string`);
    }
    return value;
  };

  if (type === "place-tower" || type === "move-tower") {
    const { x, y } = commandSource;
    // Whether the cell lies inside the map is the simulation's call (reason "out-of-bounds").
    if (typeof x !== "number" || !Number.isInteger(x) || typeof y !== "number" || !Number.isInteger(y)) {
      throw new GameApiError("invalid-coordinates", `${type}: x and y must be finite integers`);
    }
    if (type === "move-tower") {
      return { type, playerId: text("playerId"), towerId: text("towerId"), x, y };
    }
    return { type, playerId: text("playerId"), x, y };
  }

  if (type === "upgrade-tower") {
    const track = commandSource.track;
    if (!isValidUpgradeTrack(track)) {
      throw new GameApiError("invalid-command", `upgrade-tower: track must be one of ${UPGRADE_TRACKS.join(", ")}`);
    }
    return { type, playerId: text("playerId"), towerId: text("towerId"), track };
  }

  if (type === "set-target-mode") {
    const mode = commandSource.mode;
    if (typeof mode !== "string" || !TARGET_MODES.includes(mode as TowerTargetMode)) {
      throw new GameApiError("invalid-command", `set-target-mode: mode must be one of ${TARGET_MODES.join(", ")}`);
    }
    return { type, playerId: text("playerId"), towerId: text("towerId"), mode: mode as TowerTargetMode };
  }

  if (type === "set-damage-type") {
    const damageType = commandSource.damageType;
    if (!isValidDamageType(damageType)) {
      throw new GameApiError("invalid-command", `set-damage-type: damageType must be one of ${DAMAGE_TYPES.join(", ")}`);
    }
    return { type, playerId: text("playerId"), towerId: text("towerId"), damageType };
  }

  if (type === "ready-for-wave") {
    return { type, playerId: text("playerId") };
  }

  if (type === "advance-wave") {
    return { type };
  }

  throw new GameApiError("invalid-command", `unsupported command type: ${type}`);
}

const NOT_STARTED: GameApiResponse = {
  status: 400,
  payload: { ok: false, error: "match-not-started", message: "Start a match first." }
};

export function createGameApi(log: GameApiLogger = { info: () => undefined }): (request: GameApiRequest) => GameApiResponse {
  let simulation: MatchSimulation | null = null;
  let setup: MatchSetup | null = null;

  function logPhaseTransition(previous: MatchSnapshot, next: MatchSnapshot): void {
    if (previous.phase !== "placement" && next.phase === "placement") {
      log.info({ event: "wave-ended", wave: Math.max(1, next.wave - 1), tick: previous.waveTick }, "wave ended");
    }

    if (previous.phase !== "wave" && next.phase === "wave") {
      log.info({ event: "wave-started", wave: next.wave, tick: next.waveTick }, "wave started");
    }

    if (previous.phase !== "ended" && next.phase === "ended") {
      log.info({ event: "match-ended", wave: next.wave, winnerId: next.winnerId, reason: next.endReason }, "match ended");
    }
  }

  const handle = ({ method, pathname, searchParams, body }: GameApiRequest): GameApiResponse => {
    if (method === "GET" && pathname === "/health") {
      return { status: 200, payload: { ok: true, project: PROJECT_NAME, runningMatch: simulation !== null, setup } };
    }

    if (method === "GET" && pathname === "/api/snapshot") {
      if (!simulation) {
        return NOT_STARTED;
      }
      return {
        status: 200,
        payload: { ok: true, snapshot: toWireSnapshot(simulation.getSnapshot(), snapshotOptionsFromQuery(searchParams)) }
      };
    }

    if (method === "POST" && pathname === "/api/start") {
      const nextSetup = normalizeSetup(body);
      simulation = createMatch(nextSetup);
      setup = nextSetup;
      log.info({ event: "match-created", players: nextSetup.players.length, seed: nextSetup.seed }, "match created");
      return { status: 200, payload: { ok: true, setup, snapshot: simulation.getSnapshot() } };
    }

    if (method === "POST" && pathname === "/api/command") {
      if (!simulation) {
        return NOT_STARTED;
      }
      const command = parseCommand(body);
      const previousSnapshot = simulation.getSnapshot();
      const result = simulation.applyCommand(command);
      const nextSnapshot = simulation.getSnapshot();
      logPhaseTransition(previousSnapshot, nextSnapshot);
      return {
        status: 200,
        payload: { ok: true, result, snapshot: toWireSnapshot(nextSnapshot, snapshotOptionsFromBody(body)) }
      };
    }

    // One bot command per call: the client paces the calls so bot moves are visible (spec/02, AI players).
    if (method === "POST" && pathname === "/api/ai-step") {
      if (!simulation) {
        return NOT_STARTED;
      }
      const previousSnapshot = simulation.getSnapshot();
      const step = stepAiPlayers(simulation);
      const nextSnapshot = simulation.getSnapshot();
      logPhaseTransition(previousSnapshot, nextSnapshot);
      return {
        status: 200,
        payload: {
          ok: true,
          action: step.action,
          pending: step.pending,
          snapshot: toWireSnapshot(nextSnapshot, snapshotOptionsFromBody(body))
        }
      };
    }

    if (method === "POST" && pathname === "/api/advance-many") {
      if (!simulation) {
        return NOT_STARTED;
      }
      const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
      const ticks = Math.max(1, Math.min(500, Number(source.ticks ?? 30)));

      let acceptedTicks = 0;
      let stoppedReason = "";
      for (let i = 0; i < ticks; i += 1) {
        const previousSnapshot = simulation.getSnapshot();
        const result = simulation.applyCommand({ type: "advance-wave" });
        if (!result.accepted) {
          stoppedReason = result.reason ?? "rejected";
          break;
        }
        acceptedTicks += 1;

        const snapshot = simulation.getSnapshot();
        logPhaseTransition(previousSnapshot, snapshot);
        if (snapshot.phase !== "wave") {
          stoppedReason = `phase=${snapshot.phase}`;
          break;
        }
      }

      return {
        status: 200,
        payload: {
          ok: true,
          acceptedTicks,
          stoppedReason,
          snapshot: toWireSnapshot(simulation.getSnapshot(), snapshotOptionsFromBody(body))
        }
      };
    }

    return { status: 404, payload: { ok: false, error: "not-found" } };
  };

  // Validation problems are structured, non-fatal 400s; anything else is unexpected and left to the host.
  return (request) => {
    try {
      return handle(request);
    } catch (error) {
      if (error instanceof GameApiError) {
        return { status: 400, payload: { ok: false, error: error.code, message: error.message } };
      }
      throw error;
    }
  };
}
