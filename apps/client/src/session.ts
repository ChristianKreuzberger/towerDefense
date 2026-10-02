import type { MatchSetup, MatchSnapshot, SimulationCommand } from "@tower-defense/shared";
import { getJson, postJson } from "./api";
import type { ApiAdvanceManyPayload, ApiCommandPayload, ApiStartPayload, WireSnapshot } from "./api";
import { applyWireSnapshot } from "./apply";
import { cueForCommandResult } from "./audio/index";
import { rebuildBattlefield, setMoveMode, setWallMode } from "./board";
import { MAX_PLAYBACK_ERRORS } from "./constants";
import { el } from "./dom";
import { closeOverlay } from "./end-overlay";
import { addFeedback, setMenuMessage, setStatus } from "./feedback";
import { resetMatchCaches } from "./hydrate";
import { menuPlayersToSetupPlayers } from "./menu";
import { setPlaying, syncPlaybackControls } from "./playback";
import { mapPreview, soundEngine } from "./services";
import { store } from "./state";
import { passTurnAfterReady } from "./turns";

// Everything that talks to the host: fetching snapshots, starting matches, sending commands.

// Start, rematch and advance-many are single-shot requests: a second click while one is in flight is ignored.
let matchStartInFlight = false;
let advanceManyInFlight = false;

export interface FetchSnapshotOptions {
  silentStatus?: boolean;
}

export async function advanceTicks(ticks: number): Promise<void> {
  const seq = ++store.requestSeq;
  try {
    const data = await postJson<ApiAdvanceManyPayload>("/api/advance-many", { ticks, lite: true, eventsSince: store.eventCursor });
    store.playbackErrors = 0;
    if (data.snapshot && !applyWireSnapshot(data.snapshot, seq)) {
      await fetchSnapshot({ silentStatus: true });
    }
  } catch (error) {
    store.playbackErrors += 1;
    if (store.playbackErrors >= MAX_PLAYBACK_ERRORS) {
      setPlaying(false);
      const message = error instanceof Error ? error.message : "request failed";
      setStatus(`Playback paused after repeated failures: ${message}`);
      addFeedback("error", "Playback paused after repeated failures", undefined, message);
    }
  }
}

export async function fetchSnapshot(options?: FetchSnapshotOptions): Promise<MatchSnapshot | null> {
  const seq = ++store.requestSeq;
  // Only a client that had no match yet is actually reconnecting; later calls are routine refreshes.
  const reconnecting = store.current === null;
  try {
    // Without cached map cells the host must send a full snapshot; afterwards lite is enough.
    const path = store.mapCache ? `/api/snapshot?lite=1&eventsSince=${store.eventCursor}` : "/api/snapshot";
    let data = await getJson<{ ok: true; snapshot: WireSnapshot }>(path);
    if (!applyWireSnapshot(data.snapshot, seq)) {
      data = await getJson<{ ok: true; snapshot: WireSnapshot }>("/api/snapshot");
      applyWireSnapshot(data.snapshot, seq);
    }
    if (reconnecting) {
      setMenuMessage("Reconnected to running match.");
    }
    return store.current;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch snapshot";
    if (!options?.silentStatus) {
      setStatus(message);
    }
    return null;
  }
}

export function startFreshMatch(wire: WireSnapshot): void {
  resetMatchCaches();
  rebuildBattlefield();
  store.cursorChosen = false;
  store.guideDismissedKey = null;
  store.playing = true;
  syncPlaybackControls();
  setWallMode(false);
  setMoveMode(false);
  applyWireSnapshot(wire, ++store.requestSeq);
  // A new match (menu Start or Rematch) opens with the preview; a reconnect never reaches this function.
  if (store.current && store.current.phase === "placement") {
    mapPreview.open(store.current);
  }
}

export async function startMatchFromMenu(): Promise<void> {
  if (matchStartInFlight) {
    return;
  }
  if (store.current && store.current.phase !== "ended" && !window.confirm("Replace the running match?")) {
    return;
  }
  setMenuMessage("");

  const players = menuPlayersToSetupPlayers();
  // Number("") is 0 and Number("abc") is NaN; never send either as a seed.
  const seedText = el.menuSeed.value.trim();
  const seed = Number(seedText);
  if (seedText === "" || !Number.isInteger(seed)) {
    setMenuMessage("Map seed must be a whole number.");
    return;
  }
  const payload: MatchSetup = { seed, players };

  matchStartInFlight = true;
  try {
    const data = await postJson<ApiStartPayload>("/api/start", payload);
    if (!data.snapshot) {
      setMenuMessage("Start failed: missing snapshot.");
      setStatus("missing snapshot from start");
      addFeedback("error", "Start failed: missing snapshot");
      return;
    }

    setStatus(`match-started: players=${players.length} seed=${payload.seed}`);
    addFeedback("info", `Match started with ${players.length} players`);
    closeOverlay();
    startFreshMatch(data.snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start match";
    setMenuMessage(message);
    setStatus(`error: ${message}`);
    addFeedback("error", "Start match failed", undefined, message);
  } finally {
    matchStartInFlight = false;
  }
}

export async function rematchWithSamePlayers(): Promise<void> {
  if (!store.current || matchStartInFlight) {
    return;
  }

  const players = store.current.players.map((player) => ({ id: player.id, name: player.name }));
  const payload: MatchSetup = {
    seed: store.current.map.seed + 1,
    players
  };

  matchStartInFlight = true;
  try {
    const data = await postJson<ApiStartPayload>("/api/start", payload);
    if (!data.snapshot) {
      setStatus("rematch failed: missing snapshot");
      addFeedback("error", "Rematch failed: missing snapshot");
      return;
    }

    setStatus(`rematch-started: seed=${payload.seed}`);
    addFeedback("info", `Rematch started with seed ${payload.seed}`);
    // Only now is the ended match replaced; a failed request leaves its modal reachable.
    closeOverlay();
    startFreshMatch(data.snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start rematch";
    setStatus(`error: ${message}`);
    addFeedback("error", "Rematch failed", undefined, message);
  } finally {
    matchStartInFlight = false;
  }
}

export async function sendCommand(command: SimulationCommand): Promise<void> {
  const seq = ++store.requestSeq;
  try {
    const data = await postJson<ApiCommandPayload>("/api/command", { command, lite: true, eventsSince: store.eventCursor });
    const result = data.result;
    const cue = cueForCommandResult(command.type, result?.accepted === true);
    if (cue) {
      soundEngine.play(cue);
    }
    if (!result?.accepted) {
      setStatus(`rejected: ${result?.reason ?? "unknown"}`);
      addFeedback("rejected", "Command rejected", command.type, result?.reason);
    } else {
      setStatus("accepted");
      if (command.type === "place-wall") {
        addFeedback("accepted", "Wall placed");
      } else if (command.type === "move-tower") {
        addFeedback("accepted", "Tower moved");
        setMoveMode(false);
      } else if (command.type === "upgrade-tower") {
        addFeedback("accepted", `Tower ${command.track} upgraded`);
      }
    }

    if (!data.snapshot || !applyWireSnapshot(data.snapshot, seq)) {
      await fetchSnapshot();
    }

    if (result?.accepted && command.type === "ready-for-wave") {
      passTurnAfterReady(command.playerId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send command";
    setStatus(`error: ${message}`);
    addFeedback("error", "Command failed", command.type, message);
  }
}

export const ADVANCE_MANY_TICKS = 200;

// Debug "advance wave (auto)" button: one big tick batch instead of the paced playback loop.
export async function advanceMany(): Promise<void> {
  if (advanceManyInFlight) {
    return;
  }
  advanceManyInFlight = true;
  try {
    const seq = ++store.requestSeq;
    const data = await postJson<ApiAdvanceManyPayload>("/api/advance-many", { ticks: ADVANCE_MANY_TICKS, lite: true, eventsSince: store.eventCursor });
    setStatus(`advance-many: attempted=${ADVANCE_MANY_TICKS} accepted=${data.acceptedTicks ?? 0} stopped=${data.stoppedReason ?? "none"}`);
    addFeedback("info", `Advance-many accepted ${data.acceptedTicks ?? 0} ticks`, "advance-wave", data.stoppedReason);

    if (!data.snapshot || !applyWireSnapshot(data.snapshot, seq)) {
      await fetchSnapshot();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to advance many";
    setStatus(`error: ${message}`);
    addFeedback("error", "Advance-many failed", "advance-wave", message);
  } finally {
    advanceManyInFlight = false;
  }
}
