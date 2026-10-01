import { UPGRADE_TRACKS, isInSpawnProtection } from "@tower-defense/shared";
import type { MatchEvent, MatchSetup, MatchSnapshot, SimulationCommand, TowerTargetMode } from "@tower-defense/shared";
import { getJson, postJson } from "./api";
import type { ApiAdvanceManyPayload, ApiCommandPayload, ApiStartPayload, WireSnapshot } from "./api";
import { paintHero } from "./art/hero";
import { applyPaletteCssVars } from "./art/palette";
import { cueForCommandResult, cuesForSnapshotChange } from "./audio/index";
import type { SoundId } from "./audio/index";
import { adjustCoord, battlefieldMount, firstFreeBuildableCoord, occupiedCellKeys, renderSnapshot, setCellClickHandler, setMoveMode, setWallMode, syncCursorToBuildableCell, updateBattlefield } from "./board";
import { DAMAGE_TYPE_OPTIONS, DEBUG, MANUAL_TRANSITION_MS, MAX_FX_EVENT_BACKLOG, MAX_PLAYBACK_ERRORS, PLAYBACK_SPEEDS, TARGET_MODES } from "./constants";
import { coordValue } from "./coord";
import { createDemo } from "./demo";
import { app, el, must } from "./dom";
import { closeOverlay, isEndOverlayOpen, renderEndOverlay } from "./end-overlay";
import { REJECT_REASON_TEXT, addFeedback, setMenuMessage, setStatus } from "./feedback";
import { hideGuideOverlay, syncGuideOverlay } from "./guide";
import type { GuideAction } from "./guide";
import { hydrateSnapshot, resetMatchCaches } from "./hydrate";
import { menuPlayersToSetupPlayers, renderMenuPlayerInputs, showGameScreen, showMenuScreen } from "./menu";
import { perfTimeApply } from "./perf";
import { announceWaveEnd, renderPhase } from "./phase";
import { resolvePlacementCell } from "./placement";
import { configurePlayback, msPerTick, setPlaybackSpeed, setPlaying, syncPlaybackControls } from "./playback";
import { playerNumber, playerTowerId, selectedPlayerId } from "./player-util";
import { renderPlayerCards, setChipSelectHandler, updatePlayerOptions } from "./scoreboard";
import { mapPreview, settingsDialog, settingsStore, soundEngine } from "./services";
import { store } from "./state";
import { isActionAvailable, renderToolbar } from "./toolbar";
import { applyActivePlayerChange, passTurnAfterReady, resetTurnAfterWave, setActivePlayer } from "./turns";

import "./style.css";
// Player colours live in art/palette.ts; publish them as --p1..--p8 before anything renders.
applyPaletteCssVars();

interface TestBoardHook {
  findBuildableCell(index?: number): { x: number; y: number } | null;
  cellSize(): number;
  demo?: { start(): boolean; stop(): void; running(): boolean };
  cellToPixel(x: number, y: number): { x: number; y: number };
  creaturePositions(): Array<{ id: string; x: number; y: number }>;
  playback(): { playing: boolean; speed: number };
}

declare global {
  interface Window {
    __testBoard?: TestBoardHook;
  }
}

interface FetchSnapshotOptions {
  silentStatus?: boolean;
}

// Debug-only synthetic combat: feeds creatures and events to the board without touching the host simulation.
const demo = createDemo({
  current: () => store.current,
  feed: (snapshot, events) => applySnapshot(snapshot, events),
  tickMs: () => msPerTick(),
  onFinished: () => {
    el.demoBtn.textContent = "Demo Combat";
  }
});

configurePlayback({ advance: advanceTicks, blocked: () => demo.running() });

setCellClickHandler(handleCellSelected);

setChipSelectHandler(setActivePlayer);

function runGuideAction(action: GuideAction): void {
  if (action === "focus-place") {
    addFeedback("info", "Guidance refreshed. Watch player readiness.");
    void fetchSnapshot({ silentStatus: true });
    return;
  }

  if (action === "place-tower") {
    placeTowerForSelectedPlayer();
    return;
  }

  if (action === "ready-player") {
    must<HTMLButtonElement>("readyBtn").click();
    return;
  }

  setPlaying(!store.playing);
}

// Applies a host response unless a newer one was already applied. Returns false when a full refetch is needed.
function applyWireSnapshot(wire: WireSnapshot, seq: number): boolean {
  if (seq < store.appliedSeq) {
    return true;
  }
  const hydrated = hydrateSnapshot(wire);
  if (!hydrated) {
    return false;
  }
  store.appliedSeq = seq;
  applySnapshot(hydrated.snapshot, hydrated.newEvents);
  return true;
}

function applySnapshot(snapshot: MatchSnapshot, newEvents: MatchEvent[]): void {
  perfTimeApply(() => applySnapshotInner(snapshot, newEvents));
}

function applySnapshotInner(snapshot: MatchSnapshot, newEvents: MatchEvent[]): void {
  const previous = store.current;
  store.current = snapshot;
  // Real ticks between snapshots set how long creatures glide; anything else (new wave, rewind) snaps quickly.
  const ticksElapsed = previous && previous.wave === snapshot.wave && previous.phase === "wave" && snapshot.phase === "wave"
    ? snapshot.waveTick - previous.waveTick
    : 0;
  const glideMs = ticksElapsed > 0 ? ticksElapsed * msPerTick() : MANUAL_TRANSITION_MS;

  // A fresh load or reconnect delivers the whole event history; replaying that as toasts or effects would be noise.
  const fxEvents = previous !== null && newEvents.length <= MAX_FX_EVENT_BACKLOG ? newEvents : [];
  announceRepairEvents(snapshot, fxEvents);
  soundEngine.playCues(
    cuesForSnapshotChange({ previous, next: snapshot, events: fxEvents, suppress: previous === null || newEvents.length > MAX_FX_EVENT_BACKLOG }),
    glideMs
  );
  showGameScreen();
  updatePlayerOptions(store.current);
  syncCursorToBuildableCell(store.current);
  updateBattlefield(store.current, glideMs, fxEvents);
  announceWaveEnd(fxEvents);
  resetTurnAfterWave(previous, snapshot);
  renderToolbar(store.current);
  renderPlayerCards(store.current, newEvents);
  renderPhase(store.current);
  renderEndOverlay(store.current);
  renderSnapshot(store.current);
  syncGuideOverlay(store.current);
}

function announceRepairEvents(snapshot: MatchSnapshot, events: MatchSnapshot["events"]): void {
  const playerNames = new Map(snapshot.players.map((player) => [player.id, player.name]));
  for (const event of events) {
    if (event.type === "tower-repaired") {
      const playerName = playerNames.get(event.playerId) ?? event.playerId;
      const tower = snapshot.towers.find((entry) => entry.id === event.towerId);
      const maxHealth = tower?.maxHealth ?? event.remainingHp;
      addFeedback("info", `${playerName} tower repaired +${event.repairAmount} HP (${event.remainingHp}/${maxHealth})`);
      continue;
    }

    if (event.type === "wall-repaired") {
      const playerName = playerNames.get(event.playerId) ?? event.playerId;
      addFeedback("info", `${playerName} wall repaired +${event.repairAmount} HP (${event.remainingHp})`);
      continue;
    }

    if (event.type === "path-repaired") {
      addFeedback("info", `Path wear repaired on ${event.repairs.length} cell${event.repairs.length === 1 ? "" : "s"}`);
      continue;
    }

    if (event.type === "wave-clear-bonus") {
      const playerName = playerNames.get(event.playerId) ?? event.playerId;
      const clearLabel = event.cleared ? "full clear" : "wave completed";
      addFeedback("accepted", `${playerName} earned wave-clear bonus +${event.bonus} pts (${clearLabel})`);
      continue;
    }

    if (event.type === "catch-up-bonus") {
      const playerName = playerNames.get(event.playerId) ?? event.playerId;
      addFeedback("accepted", `${playerName} earned catch-up bonus +${event.bonus} pts (${event.gap} behind the leader)`);
    }
  }
}

async function advanceTicks(ticks: number): Promise<void> {
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

async function fetchSnapshot(options?: FetchSnapshotOptions): Promise<MatchSnapshot | null> {
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

function startFreshMatch(wire: WireSnapshot): void {
  resetMatchCaches();
  store.cursorChosen = false;
  store.guideDismissedKey = null;
  store.playing = true;
  syncPlaybackControls();
  setWallMode(false);
  applyWireSnapshot(wire, ++store.requestSeq);
  // A new match (menu Start or Rematch) opens with the preview; a reconnect never reaches this function.
  if (store.current && store.current.phase === "placement") {
    mapPreview.open(store.current);
  }
}

async function startMatchFromMenu(): Promise<void> {
  if (store.current && store.current.phase !== "ended" && !window.confirm("Replace the running match?")) {
    return;
  }
  closeOverlay();
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
    startFreshMatch(data.snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start match";
    setMenuMessage(message);
    setStatus(`error: ${message}`);
    addFeedback("error", "Start match failed", undefined, message);
  }
}

async function rematchWithSamePlayers(): Promise<void> {
  if (!store.current) {
    return;
  }

  const players = store.current.players.map((player) => ({ id: player.id, name: player.name }));
  const payload: MatchSetup = {
    seed: store.current.map.seed + 1,
    players
  };

  closeOverlay();
  try {
    const data = await postJson<ApiStartPayload>("/api/start", payload);
    if (!data.snapshot) {
      setStatus("rematch failed: missing snapshot");
      addFeedback("error", "Rematch failed: missing snapshot");
      return;
    }

    setStatus(`rematch-started: seed=${payload.seed}`);
    addFeedback("info", `Rematch started with seed ${payload.seed}`);
    startFreshMatch(data.snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start rematch";
    setStatus(`error: ${message}`);
    addFeedback("error", "Rematch failed", undefined, message);
  }
}

function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function handleCellSelected(x: number, y: number): void {
  if (!store.current) {
    return;
  }
  store.cursorChosen = true;

  el.x.value = String(x);
  el.y.value = String(y);
  battlefieldMount.setCursor(x, y);

  const cell = store.mapCache?.byKey.get(`${x},${y}`);
  if (!cell || !cell.buildable) {
    return;
  }

  if (occupiedCellKeys(store.current).has(`${x},${y}`)) {
    return;
  }

  const playerId = selectedPlayerId();
  if (store.moveMode) {
    void sendCommand({ type: "move-tower", playerId, towerId: playerTowerId(playerId), x, y });
    return;
  }

  if (store.wallMode) {
    void sendCommand({ type: "place-wall", playerId, x, y });
    return;
  }

  const alreadyHasTower = store.current.towers.some((tower) => tower.playerId === playerId);
  if (store.current.phase === "placement" && !alreadyHasTower) {
    void sendCommand({ type: "place-tower", playerId, x, y });
  }
}

async function sendCommand(command: SimulationCommand): Promise<void> {
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

el.demoBtn.addEventListener("click", () => {
  if (demo.running()) {
    demo.stop();
    el.demoBtn.textContent = "Demo Combat";
    void fetchSnapshot({ silentStatus: true });
    return;
  }
  if (demo.start()) {
    el.demoBtn.textContent = "Stop Demo";
  } else {
    addFeedback("info", "Place at least one tower before starting the demo");
  }
});

el.menuPlayerCount.addEventListener("change", renderMenuPlayerInputs);
el.menuStartBtn.addEventListener("click", () => {
  void startMatchFromMenu();
});
el.menuResumeBtn.addEventListener("click", () => {
  showGameScreen();
  void fetchSnapshot();
});
el.menuRefreshBtn.addEventListener("click", () => {
  void fetchSnapshot();
});

must<HTMLButtonElement>("refreshBtn").addEventListener("click", () => {
  addFeedback("info", "Manual snapshot refresh");
  store.guideDismissedKey = null;
  void fetchSnapshot();
});

must<HTMLButtonElement>("restartBtn").addEventListener("click", () => {
  closeOverlay();
  showMenuScreen();
});

must<HTMLButtonElement>("backToMenuBtn").addEventListener("click", () => {
  showMenuScreen();
});

el.guideCloseBtn.addEventListener("click", () => {
  store.guideDismissedKey = store.lastGuideKey;
  hideGuideOverlay();
});

el.guideActionBtn.addEventListener("click", () => {
  const action = el.guideActionBtn.dataset.action as GuideAction | undefined;
  if (!action) {
    return;
  }

  store.guideDismissedKey = null;
  hideGuideOverlay();
  runGuideAction(action);
});

el.playerId.addEventListener("change", applyActivePlayerChange);

must<HTMLButtonElement>("closeOverlayBtn").addEventListener("click", closeOverlay);
el.rematchBtn.addEventListener("click", () => {
  void rematchWithSamePlayers();
});

function placeTowerForSelectedPlayer(): void {
  const playerId = selectedPlayerId();
  const snapshot = store.current;
  const coords = snapshot
    ? resolvePlacementCell({
        cursor: { x: coordValue(el.x), y: coordValue(el.y) },
        cursorChosen: store.cursorChosen,
        isFreeBuildable: (cell) =>
          Boolean(store.mapCache?.byKey.get(`${cell.x},${cell.y}`)?.buildable)
          && !occupiedCellKeys(snapshot).has(`${cell.x},${cell.y}`)
          && !isInSpawnProtection(snapshot.map, cell.x, cell.y),
        firstFree: () => firstFreeBuildableCoord(snapshot)
      })
    : null;
  if (!coords) {
    addFeedback("info", "Click a free buildable tile first, then place your tower");
    return;
  }
  el.x.value = String(coords.x);
  el.y.value = String(coords.y);
  void sendCommand({
    type: "place-tower",
    playerId,
    x: coords.x,
    y: coords.y
  });
}

el.readyBtn.addEventListener("click", () => {
  void sendCommand({ type: "ready-for-wave", playerId: selectedPlayerId() });
});

// Walls are placed by clicking tiles while this mode is on (the sim accepts walls during combat only).
el.placeWallBtn.addEventListener("click", () => {
  if (el.placeWallBtn.getAttribute("aria-disabled") === "true") {
    addFeedback("info", REJECT_REASON_TEXT["wall-phase-not-active"] ?? "walls are not available right now");
    return;
  }
  setWallMode(!store.wallMode);
});

el.moveTowerBtn.addEventListener("click", () => {
  if (el.moveTowerBtn.getAttribute("aria-disabled") === "true") {
    const used = el.moveTowerCost.textContent === "used";
    addFeedback("info", used ? "You already used your free tower move" : "Moving your tower unlocks after round 5 and only in prep, before you ready");
    return;
  }
  setMoveMode(!store.moveMode);
});

el.playPauseBtn.addEventListener("click", () => {
  setPlaying(!store.playing);
});

for (const button of el.playbackControls.querySelectorAll<HTMLButtonElement>(".speed-btn")) {
  button.addEventListener("click", () => {
    const speed = Number(button.dataset.speed);
    const match = PLAYBACK_SPEEDS.find((candidate) => candidate === speed);
    if (match) {
      setPlaybackSpeed(match);
    }
  });
}

for (const track of UPGRADE_TRACKS) {
  el.upgradeBtns[track].addEventListener("click", () => {
    const playerId = selectedPlayerId();
    void sendCommand({ type: "upgrade-tower", playerId, towerId: playerTowerId(playerId), track });
  });
}

el.mode.addEventListener("change", () => {
  const requestedMode = String(el.mode.value);
  const mode: TowerTargetMode = TARGET_MODES.includes(requestedMode as TowerTargetMode)
    ? (requestedMode as TowerTargetMode)
    : "first";

  const playerId = selectedPlayerId();
  void sendCommand({
    type: "set-target-mode",
    playerId,
    towerId: playerTowerId(playerId),
    mode
  });
});

el.damageType.addEventListener("change", () => {
  const requested = String(el.damageType.value);
  const damageType = DAMAGE_TYPE_OPTIONS.find((candidate) => candidate === requested);
  if (!damageType) {
    return;
  }
  const playerId = selectedPlayerId();
  void sendCommand({ type: "set-damage-type", playerId, towerId: playerTowerId(playerId), damageType });
});

el.placeTowerBtn.addEventListener("click", () => {
  placeTowerForSelectedPlayer();
});

must<HTMLButtonElement>("advanceBtn").addEventListener("click", () => {
  void sendCommand({ type: "advance-wave" });
});

must<HTMLButtonElement>("autoBtn").addEventListener("click", async () => {
  try {
    const attemptedTicks = 200;
    const seq = ++store.requestSeq;
    const data = await postJson<ApiAdvanceManyPayload>("/api/advance-many", { ticks: attemptedTicks, lite: true, eventsSince: store.eventCursor });
    setStatus(`advance-many: attempted=${attemptedTicks} accepted=${data.acceptedTicks ?? 0} stopped=${data.stoppedReason ?? "none"}`);
    addFeedback("info", `Advance-many accepted ${data.acceptedTicks ?? 0} ticks`, "advance-wave", data.stoppedReason);

    if (!data.snapshot || !applyWireSnapshot(data.snapshot, seq)) {
      await fetchSnapshot();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to advance many";
    setStatus(`error: ${message}`);
    addFeedback("error", "Advance-many failed", "advance-wave", message);
  }
});

el.menuSettingsBtn.addEventListener("click", () => settingsDialog.open(el.menuSettingsBtn));
el.settingsBtn.addEventListener("click", () => settingsDialog.open(el.settingsBtn));

// Menu and in-match buttons share one click sound; data-sfx="none" opts out and any other value names a SoundId.
app.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  if (!button || button.disabled || !app.contains(button)) {
    return;
  }
  const sfx = button.dataset.sfx;
  if (sfx === "none") {
    return;
  }
  soundEngine.play({ id: (sfx as SoundId | undefined) ?? "ui-click" });
});

document.addEventListener("keydown", (event) => {
  if (mapPreview.isOpen()) {
    // The dialog handles Esc and Tab itself; game hotkeys stay off while it is open.
    return;
  }

  if (settingsDialog.isOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      settingsDialog.close();
    }
    return;
  }

  if (isEndOverlayOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
    } else if (event.key === "Tab") {
      // Wrap inside the modal; with the page inert Tab would otherwise leave for the browser chrome.
      const buttons = [...el.overlay.querySelectorAll<HTMLButtonElement>("button")];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (first && last && event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (first && last && !event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }

  if (isFormField(event.target)) {
    return;
  }

  if (event.key.toLowerCase() === "m" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    settingsStore.set({ muted: !settingsStore.get().muted });
    return;
  }

  // `current` is not cleared when returning to the menu, so check the screen and end overlay explicitly.
  const inMatch = store.current && !el.gameScreen.classList.contains("hidden") && el.overlay.style.display !== "flex";
  if (inMatch && store.current && !event.ctrlKey && !event.metaKey && !event.altKey && /^[1-8]$/.test(event.key)) {
    const target = store.current.players.find((player) => playerNumber(player.id) === Number(event.key));
    if (target) {
      event.preventDefault();
      setActivePlayer(target.id);
    }
    return;
  }

  // Game hotkeys only make sense inside a running match, and only for actions that are available right now.
  if (!inMatch) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "r") {
    event.preventDefault();
    if (isActionAvailable(el.readyBtn)) {
      el.readyBtn.click();
    }
    return;
  }

  if (key === "t") {
    event.preventDefault();
    if (isActionAvailable(el.placeTowerBtn)) {
      placeTowerForSelectedPlayer();
    }
    return;
  }

  if (key === "w") {
    event.preventDefault();
    if (isActionAvailable(el.placeWallBtn)) {
      el.placeWallBtn.click();
    }
    return;
  }

  if (key === "v") {
    event.preventDefault();
    if (isActionAvailable(el.moveTowerBtn)) {
      el.moveTowerBtn.click();
    }
    return;
  }

  if (key === "p") {
    event.preventDefault();
    el.playPauseBtn.click();
    return;
  }

  if (event.key === "Escape" && store.moveMode) {
    setMoveMode(false);
    return;
  }

  if (event.key === "Escape" && store.wallMode) {
    setWallMode(false);
    return;
  }

  if (event.key === "Escape" && !el.guideOverlay.classList.contains("guide-idle")) {
    store.guideDismissedKey = store.lastGuideKey;
    hideGuideOverlay();
    return;
  }

  const hotkeyTrack = ({ u: "range", i: "damage", o: "accuracy" } as const)[key as "u" | "i" | "o"];
  if (hotkeyTrack) {
    event.preventDefault();
    if (isActionAvailable(el.upgradeBtns[hotkeyTrack])) {
      el.upgradeBtns[hotkeyTrack].click();
    }
    return;
  }

  if (key === "a" && DEBUG) {
    event.preventDefault();
    must<HTMLButtonElement>("advanceBtn").click();
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    adjustCoord(-1, 0);
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    adjustCoord(1, 0);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    adjustCoord(0, -1);
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    adjustCoord(0, 1);
  }
});

for (const element of document.querySelectorAll(".debug-only")) {
  element.classList.toggle("hidden", !DEBUG);
}

renderMenuPlayerInputs();
paintHero(must<HTMLCanvasElement>("menuHero"));
renderPhase(null);
showMenuScreen();
setStatus("No match yet.");
setMenuMessage("Create a local match or reconnect to an existing one.");
hideGuideOverlay();
// Hide both screens until the reconnect check answers, so a running match does not flash the menu first.
app.classList.add("booting");
const endBoot = (): void => app.classList.remove("booting");
setTimeout(endBoot, 1200);
void fetchSnapshot({ silentStatus: true }).finally(endBoot);

// Read-only test hook so Playwright can locate buildable cells without DOM grid elements.
function findBuildableCellsInOrder(): Array<{ x: number; y: number }> {
  if (!store.current || !store.mapCache) {
    return [];
  }

  const occupied = occupiedCellKeys(store.current);
  const map = store.current.map;
  const open = new Set(store.mapCache.buildable.map((cell) => `${cell.x},${cell.y}`));
  // Maze corridors are the creatures' only route, so placements there are usually rejected.
  // Isolated pads (no walkable neighbour) are always legal spots for tests to click.
  const isPad = (cell: { x: number; y: number }): boolean =>
    [`${cell.x + 1},${cell.y}`, `${cell.x - 1},${cell.y}`, `${cell.x},${cell.y + 1}`, `${cell.x},${cell.y - 1}`].every(
      (key) => !open.has(key)
    );
  return store.mapCache.buildable
    .filter((cell) => !occupied.has(`${cell.x},${cell.y}`) && !isInSpawnProtection(map, cell.x, cell.y) && isPad(cell))
    .map((cell) => ({ x: cell.x, y: cell.y }));
}

window.__testBoard = {
  findBuildableCell(index = 0): { x: number; y: number } | null {
    return findBuildableCellsInOrder()[index] ?? null;
  },
  cellSize(): number {
    return battlefieldMount.cellSize();
  },
  // CSS pixels relative to the canvas element, so it stays right when CSS scales the canvas.
  cellToPixel(x: number, y: number): { x: number; y: number } {
    return battlefieldMount.cellToCss(x, y);
  },
  creaturePositions(): Array<{ id: string; x: number; y: number }> {
    return battlefieldMount.creaturePositions();
  },
  playback(): { playing: boolean; speed: number } {
    return { playing: store.playing, speed: store.playbackSpeed };
  },
  ...(DEBUG ? { demo } : {})
};
