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
let timer = null;
let stepInFlight = false;
function dialogOpen() {
    return mapPreview.isOpen() || tour.isOpen();
}
function eligible() {
    return botsCanAct(store.current) && !el.gameScreen.classList.contains("hidden");
}
export function installBotPacing() {
    onSnapshotApplied(syncBotPacing);
}
// Called after every applied snapshot; arms the next step when a bot still has something to do.
function syncBotPacing() {
    if (timer !== null || stepInFlight || !eligible()) {
        return;
    }
    timer = setTimeout(() => {
        timer = null;
        void runBotStep();
    }, BOT_STEP_DELAY_MS);
}
async function runBotStep() {
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
        const data = await postJson("/api/ai-step", { lite: true, eventsSince: store.eventCursor });
        if (data.action) {
            announce(data.action.playerId, data.action.command);
        }
        if (data.snapshot) {
            applyWireSnapshot(data.snapshot, seq);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "request failed";
        addFeedback("error", "Bot step failed", undefined, message);
        return;
    }
    finally {
        stepInFlight = false;
    }
    syncBotPacing();
}
function announce(playerId, command) {
    const player = store.current?.players.find((entry) => entry.id === playerId);
    addFeedback("info", describeBotAction(player?.name ?? botName(1), command));
}
