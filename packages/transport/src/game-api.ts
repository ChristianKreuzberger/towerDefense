// Transport-agnostic game API: the Node server and the in-browser (GitHub Pages) host both route through this.
import { createMatch, type MatchSimulation } from "@tower-defense/simulation/match";
import {
  PROJECT_NAME,
  type MatchSetup,
  type MatchSnapshot,
  type TowerTargetMode,
  type SimulationCommand
} from "@tower-defense/shared";

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

function normalizeSetup(body: unknown): MatchSetup {
  const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};

  const seed = typeof source.seed === "number" && Number.isInteger(source.seed)
    ? source.seed
    : Number(source.seed ?? 777);

  const inputPlayers = Array.isArray(source.players) ? source.players : [];
  const players = inputPlayers
    .map((entry, index) => {
      if (typeof entry !== "object" || !entry) {
        return null;
      }

      const mapped = entry as Record<string, unknown>;
      const id = typeof mapped.id === "string" && mapped.id.trim().length > 0
        ? mapped.id.trim()
        : `p${index + 1}`;
      const name = typeof mapped.name === "string" && mapped.name.trim().length > 0
        ? mapped.name.trim()
        : `Player ${index + 1}`;

      return { id, name };
    })
    .filter((entry): entry is { id: string; name: string } => entry !== null);

  if (players.length < 1 || players.length > 8) {
    throw new Error("player count must be between 1 and 8");
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
function toWireSnapshot(snapshot: MatchSnapshot, options: SnapshotOptions): unknown {
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
    throw new Error("invalid command payload");
  }

  const type = commandSource.type;

  if (type === "place-tower" || type === "place-wall") {
    return {
      type,
      playerId: String(commandSource.playerId ?? ""),
      x: Number(commandSource.x),
      y: Number(commandSource.y)
    };
  }

  if (type === "upgrade-tower") {
    return {
      type,
      playerId: String(commandSource.playerId ?? ""),
      towerId: String(commandSource.towerId ?? "")
    };
  }

  if (type === "set-target-mode") {
    const requestedMode = String(commandSource.mode ?? "first");
    const normalizedMode: TowerTargetMode = TARGET_MODES.includes(requestedMode as TowerTargetMode)
      ? (requestedMode as TowerTargetMode)
      : "first";

    return {
      type,
      playerId: String(commandSource.playerId ?? ""),
      towerId: String(commandSource.towerId ?? ""),
      mode: normalizedMode
    };
  }

  if (type === "ready-for-wave") {
    return {
      type,
      playerId: String(commandSource.playerId ?? "")
    };
  }

  if (type === "advance-wave") {
    return { type };
  }

  throw new Error(`unsupported command type: ${type}`);
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

  // Throws on bad input; each host turns that into a 400.
  return ({ method, pathname, searchParams, body }) => {
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
}
