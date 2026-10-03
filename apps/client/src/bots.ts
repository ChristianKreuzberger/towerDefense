import type { SimulationCommand } from "@tower-defense/shared";
import type { ApiAiStepPayload } from "@tower-defense/transport/wire-types";
import { postJson } from "./api";
import { applyWireSnapshot, onSnapshotApplied } from "./apply";
import { botName, botsCanAct, describeBotAction } from "./bot-text";
import { BOT_STEP_DELAY_MS } from "./constants";
import { el } from "./dom";
import { addFeedback } from "./feedback";
import { mapPreview, tour } from "./services";
import { store } from "./state";

// Paces the bots in prep: the host plays one bot command per /api/ai-step call, and this timer spaces the calls so
// the table can watch. The decisions themselves stay deterministic on the host; only the timing lives here.

let timer: ReturnType<typeof setTimeout> | null = null;
let stepInFlight = false;

function dialogOpen(): boolean {
  return mapPreview.isOpen() || tour.isOpen();
}

function eligible(): boolean {
  return botsCanAct(store.current) && !el.gameScreen.classList.contains("hidden");
}

export function installBotPacing(): void {
  onSnapshotApplied(syncBotPacing);
}

// Called after every applied snapshot; arms the next step when a bot still has something to do.
function syncBotPacing(): void {
  if (timer !== null || stepInFlight || !eligible()) {
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    void runBotStep();
  }, BOT_STEP_DELAY_MS);
}

async function runBotStep(): Promise<void> {
  if (!eligible()) {
    return;
  }
  // The map preview and tour are modal: bots hold still behind them, then carry on.
  if (dialogOpen()) {
    syncBotPacing();
    return;
  }
  stepInFlight = true;
  const seq = ++store.requestSeq;
  try {
    const data = await postJson<ApiAiStepPayload>("/api/ai-step", { lite: true, eventsSince: store.eventCursor });
    if (data.action) {
      announce(data.action.playerId, data.action.command);
    }
    if (data.snapshot) {
      applyWireSnapshot(data.snapshot, seq);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    addFeedback("error", "Bot step failed", undefined, message);
    return;
  } finally {
    stepInFlight = false;
  }
  syncBotPacing();
}

function announce(playerId: string, command: SimulationCommand): void {
  const player = store.current?.players.find((entry) => entry.id === playerId);
  addFeedback("info", describeBotAction(player?.name ?? botName(1), command));
}
