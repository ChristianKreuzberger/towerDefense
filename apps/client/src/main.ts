import { MAX_PLAYER_NAME_LENGTH, UPGRADE_TRACKS, getTowerUpgradeCost, getWallCost, isInSpawnProtection } from "@tower-defense/shared";
import type { MatchEvent, MatchSetup, MatchSnapshot, SimulationCommand, TowerTargetMode } from "@tower-defense/shared";
import { getJson, postJson } from "./api";
import type { ApiAdvanceManyPayload, ApiCommandPayload, ApiStartPayload, WireSnapshot } from "./api";
import { paintHero } from "./art/hero";
import { applyPaletteCssVars } from "./art/palette";
import { cueForCommandResult, cuesForSnapshotChange } from "./audio/index";
import type { SoundId } from "./audio/index";
import { adjustCoord, battlefieldMount, firstFreeBuildableCoord, occupiedCellKeys, renderSnapshot, setCellClickHandler, setMoveMode, setWallMode, syncCursorToBuildableCell, updateBattlefield } from "./board";
import { BANNER_LIFETIME_MS, DAMAGE_TYPE_OPTIONS, DEBUG, MANUAL_TRANSITION_MS, MAX_FX_EVENT_BACKLOG, MAX_PLAYBACK_ERRORS, PLAYBACK_SPEEDS, TARGET_MODES, TURN_BANNER_LIFETIME_MS } from "./constants";
import { coordValue } from "./coord";
import { createDemo } from "./demo";
import { app, el, must } from "./dom";
import { REJECT_REASON_TEXT, addFeedback, setMenuMessage, setStatus } from "./feedback";
import { hideGuideOverlay, syncGuideOverlay } from "./guide";
import type { GuideAction } from "./guide";
import { hydrateSnapshot, resetMatchCaches } from "./hydrate";
import { perfTimeApply } from "./perf";
import { resolvePlacementCell } from "./placement";
import { configurePlayback, msPerTick, setPlaybackSpeed, setPlaying, startPlayback, stopPlayback, syncPlaybackControls } from "./playback";
import { playerNumber, playerTowerId, selectedPlayerId, towerColorClass } from "./player-util";
import { renderPlayerCards, setChipSelectHandler, updatePlayerOptions } from "./scoreboard";
import { mapPreview, settingsDialog, settingsStore, soundEngine } from "./services";
import { store } from "./state";
import { getToolbarState } from "./toolbar-state";
import { firstPendingPlayerId, nextPendingPlayerId } from "./turn";
import { formatWavePreview } from "./wave-preview";

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

function showMenuScreen(): void {
  // The match keeps running on the host; offer a way back unless it is already over.
  el.menuResumeBtn.classList.toggle("hidden", !store.current || store.current.phase === "ended");
  el.menuScreen.classList.remove("hidden");
  el.gameScreen.classList.add("hidden");
  stopPlayback();
  hideGuideOverlay();
  // Responses already in flight (playback ticks) must not pop the game screen back open over the menu.
  store.appliedSeq = ++store.requestSeq;
}

function showGameScreen(): void {
  el.menuScreen.classList.add("hidden");
  el.gameScreen.classList.remove("hidden");
}

function renderMenuPlayerInputs(): void {
  const count = Number(el.menuPlayerCount.value);
  store.menuPlayers = Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    inputId: `menuPlayerName${index + 1}`,
    defaultName: `Player ${index + 1}`
  }));

  el.menuPlayerNames.replaceChildren(...store.menuPlayers.map((player, index) => {
    const row = document.createElement("div");
    row.className = "menu-player";
    const swatch = document.createElement("span");
    swatch.className = `swatch ${player.id}`;
    swatch.setAttribute("aria-hidden", "true");
    swatch.textContent = String(index + 1);
    const label = document.createElement("label");
    label.className = "sr-only";
    label.htmlFor = player.inputId;
    label.textContent = `${player.id.toUpperCase()} Name`;
    const input = document.createElement("input");
    input.id = player.inputId;
    input.maxLength = MAX_PLAYER_NAME_LENGTH;
    input.value = player.defaultName;
    row.append(swatch, label, input);
    return row;
  }));
}

function menuPlayersToSetupPlayers(): MatchSetup["players"] {
  return store.menuPlayers.map((player, index) => {
    const element = must<HTMLInputElement>(player.inputId);
    const name = element.value.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    return {
      id: `p${index + 1}`,
      name: name.length > 0 ? name : player.defaultName
    };
  });
}

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

function showWaveBanner(title: string, sub: string): void {
  const strong = el.waveBanner.querySelector("strong");
  const span = el.waveBanner.querySelector("span");
  if (strong) strong.textContent = title;
  if (span) span.textContent = sub;
  el.waveBanner.classList.remove("show");
  void el.waveBanner.offsetWidth;
  el.waveBanner.classList.add("show");
  if (store.bannerTimer !== null) {
    clearTimeout(store.bannerTimer);
  }
  store.bannerTimer = setTimeout(() => el.waveBanner.classList.remove("show"), BANNER_LIFETIME_MS);
}

function showTurnBanner(player: { id: string; name: string }): void {
  const strong = el.turnBanner.querySelector("strong");
  const span = el.turnBanner.querySelector("span");
  if (strong) strong.textContent = player.name;
  if (span) span.textContent = "it's your turn";
  el.turnBanner.style.setProperty("--turn-color", `var(--${towerColorClass(player.id)})`);
  el.turnBanner.classList.remove("show");
  void el.turnBanner.offsetWidth;
  el.turnBanner.classList.add("show");
  if (store.turnBannerTimer !== null) {
    clearTimeout(store.turnBannerTimer);
  }
  store.turnBannerTimer = setTimeout(() => el.turnBanner.classList.remove("show"), TURN_BANNER_LIFETIME_MS);
}

// Every wave hands the table back to the first seat. Detected from the phase change between two snapshots, so a
// fresh load (no previous snapshot) or replayed events can never trigger it, and each transition fires once.
function resetTurnAfterWave(previous: MatchSnapshot | null, snapshot: MatchSnapshot): void {
  if (!previous || previous.phase !== "wave" || snapshot.phase !== "placement") {
    return;
  }
  const firstId = firstPendingPlayerId(snapshot.players);
  const first = snapshot.players.find((player) => player.id === firstId);
  if (!first) {
    return;
  }
  setActivePlayer(first.id);
  if (snapshot.players.length > 1) {
    showTurnBanner(first);
  }
}

function announceWaveEnd(events: MatchEvent[]): void {
  const end = events.find((event) => event.type === "wave-end");
  if (!end) {
    return;
  }
  const bonus = events.find((event) => event.type === "wave-clear-bonus");
  const sub = bonus && bonus.type === "wave-clear-bonus" ? `Full clear: +${bonus.bonus} points each` : "Towers repaired, prepare the next wave";
  showWaveBanner(`Wave ${end.wave} ${bonus ? "cleared" : "complete"}`, sub);
}

// Costs come from the shared cost functions so the UI can never drift from what the simulation charges.
// Dimmed and aria-disabled: still clickable (so a press explains itself), but hotkeys skip it. After the match
// ended the button is really disabled, so closing the end modal never leaves live controls behind.
function setAvailability(button: HTMLButtonElement, enabled: boolean, ended: boolean): void {
  button.classList.toggle("dim", !enabled);
  button.setAttribute("aria-disabled", String(!enabled));
  button.disabled = ended;
}

function isActionAvailable(button: HTMLButtonElement): boolean {
  return !button.disabled && button.getAttribute("aria-disabled") !== "true";
}

function renderToolbar(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    return;
  }
  const playerId = el.playerId.value;
  const player = snapshot.players.find((entry) => entry.id === playerId);
  const tower = snapshot.towers.find((entry) => entry.playerId === playerId);
  const points = player?.points ?? 0;
  const wallCost = getWallCost(snapshot.walls.length);
  el.wallCost.textContent = `${wallCost}`;
  el.wallCost.classList.toggle("short", points < wallCost);
  const state = getToolbarState({
    phase: snapshot.phase,
    upgrades: tower?.upgrades ?? null,
    eliminated: Boolean(player?.eliminated),
    readyForWave: Boolean(player?.readyForWave),
    towerMoveAvailable: Boolean(player?.towerMoveAvailable),
    wave: snapshot.wave
  });
  for (const track of UPGRADE_TRACKS) {
    const button = el.upgradeBtns[track];
    const cost = el.upgradeCosts[track];
    const level = tower?.upgrades[track] ?? null;
    const price = level === null ? null : getTowerUpgradeCost(track, level);
    cost.textContent = state.upgrades[track].maxed ? "MAX" : price === null ? "-" : `${price}`;
    cost.classList.toggle("short", !state.upgrades[track].maxed && price !== null && points < price);
    button.classList.toggle("dim", !state.upgrades[track].enabled);
    button.setAttribute("aria-disabled", String(!state.upgrades[track].enabled));
  }
  // The wall button stays clickable so a press explains why it is off (see the click handler) instead of failing silently.
  el.placeWallBtn.classList.toggle("dim", !state.wallEnabled);
  el.placeWallBtn.setAttribute("aria-disabled", String(!state.wallEnabled));
  if (!state.wallEnabled && store.wallMode) {
    setWallMode(false);
  }
  setAvailability(el.placeTowerBtn, state.placeTowerEnabled, snapshot.phase === "ended");
  setAvailability(el.readyBtn, state.readyEnabled, snapshot.phase === "ended");
  // Stays clickable like the wall button, so a press can explain why it is off.
  el.moveTowerBtn.classList.toggle("dim", !state.moveEnabled);
  el.moveTowerBtn.setAttribute("aria-disabled", String(!state.moveEnabled));
  el.moveTowerCost.textContent = state.moveLabel;
  if (!state.moveEnabled && store.moveMode) {
    setMoveMode(false);
  }
  el.mode.disabled = !state.targetModeEnabled;
  el.damageType.disabled = !state.damageTypeEnabled;
  if (tower) {
    el.mode.value = tower.targetMode;
    el.damageType.value = tower.damageType;
  }
}

function phaseSubText(snapshot: MatchSnapshot): string {
  if (snapshot.phase === "placement") {
    const repairEvents = snapshot.events.filter(
      (event) => event.type === "tower-repaired" || event.type === "wall-repaired" || event.type === "path-repaired"
    );
    const latestRepairWave = repairEvents.at(-1)?.wave;
    if (latestRepairWave !== undefined && latestRepairWave === snapshot.wave - 1) {
      const repairCount = repairEvents.filter((event) => event.wave === latestRepairWave).length;
      return `Round ${latestRepairWave} complete. Automatic repairs applied (${repairCount} update${repairCount === 1 ? "" : "s"}).`;
    }

    const unplaced = snapshot.players.filter((player) => !player.hasPlacedTower);
    if (unplaced.length > 0) {
      const names = unplaced.map((player) => player.name).slice(0, 2).join(", ");
      const suffix = unplaced.length > 2 ? ", …" : "";
      return `Waiting on ${names}${suffix}. Place your tower to keep the setup moving.`;
    }

    return "All towers are set. Buy upgrades now, then lock in readiness to start the first wave.";
  }

  if (snapshot.phase === "wave") {
    return "Combat is live. Use walls and target modes to hold the lane.";
  }

  if (snapshot.phase === "ended") {
    const winnerName = snapshot.players.find((player) => player.id === snapshot.winnerId)?.name ?? snapshot.winnerId;
    return winnerName
      ? `Winner ${winnerName} • ${snapshot.endReason ?? "match concluded"}`
      : "No winner • the match ended in a draw-like state.";
  }

  return "Prepare for the next round.";
}

function renderPhase(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    el.phaseBanner.className = "phase-banner";
    el.phaseLabel.textContent = "NO MATCH";
    el.phaseSub.textContent = "Start a local match to play.";
    el.wavePreview.textContent = "";
    el.shortcutBar.style.display = "flex";
    el.playbackControls.classList.add("hidden");
    stopPlayback();
    return;
  }

  let label = "PLACEMENT PHASE";
  const sub = phaseSubText(snapshot);
  el.phaseBanner.className = "phase-banner";

  if (snapshot.phase === "wave") {
    el.phaseBanner.classList.add("wave");
    label = `WAVE ${snapshot.wave} COMBAT`;
  }

  if (snapshot.phase === "ended") {
    el.phaseBanner.classList.add("ended");
    label = "MATCH ENDED";
  }

  el.phaseLabel.textContent = label;
  el.phaseSub.textContent = sub;
  el.wavePreview.textContent = snapshot.phase === "placement" ? formatWavePreview(snapshot.wave) : "";
  el.shortcutBar.style.display = snapshot.phase === "ended" ? "none" : "flex";

  if (snapshot.phase === "wave") {
    el.playbackControls.classList.remove("hidden");
    startPlayback();
  } else {
    el.playbackControls.classList.add("hidden");
    stopPlayback();
  }
}

function isEndOverlayOpen(): boolean {
  return el.overlay.style.display === "flex";
}

// aria-modal alone does not stop Tab or screen readers reaching the page behind, so the siblings are made inert.
function setEndOverlayBackgroundInert(on: boolean): void {
  if (on) {
    store.endOverlayInerted = [...(el.overlay.parentElement?.children ?? [])].filter((node) => node !== el.overlay && !node.hasAttribute("inert"));
    store.endOverlayInerted.forEach((node) => node.setAttribute("inert", ""));
  } else {
    store.endOverlayInerted.forEach((node) => node.removeAttribute("inert"));
    store.endOverlayInerted = [];
  }
}

function hideEndOverlay(): void {
  if (!isEndOverlayOpen()) {
    return;
  }
  el.overlay.style.display = "none";
  setEndOverlayBackgroundInert(false);
  const target = store.endOverlayOpener && store.endOverlayOpener.isConnected ? store.endOverlayOpener : el.settingsBtn;
  store.endOverlayOpener = null;
  target.focus();
}

function renderEndOverlay(snapshot: MatchSnapshot | null): void {
  if (!snapshot || snapshot.phase !== "ended") {
    store.endOverlayDismissed = false;
    hideEndOverlay();
    el.overlay.style.display = "none";
    return;
  }

  const winner = snapshot.players.find((player) => player.id === snapshot.winnerId);
  const winnerText = winner
    ? `${winner.name} (${winner.id})`
    : (snapshot.winnerId ?? "none");

  el.overlaySummary.textContent = `${winnerText} secured the win${snapshot.endReason ? ` • ${snapshot.endReason}` : ""}.`;

  const ranked = [...snapshot.players].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  // Names are user input: build text nodes, never parse them as HTML.
  el.overlayScores.replaceChildren(...ranked.flatMap((player) => {
    const name = document.createElement("div");
    name.textContent = player.name;
    const points = document.createElement("div");
    points.textContent = `${player.points} pts`;
    return [name, points];
  }));

  if (store.endOverlayDismissed || isEndOverlayOpen()) {
    return;
  }
  store.endOverlayOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  el.overlay.style.display = "flex";
  setEndOverlayBackgroundInert(true);
  must<HTMLButtonElement>("rematchBtn").focus();
}

function closeOverlay(): void {
  store.endOverlayDismissed = true;
  hideEndOverlay();
  el.overlay.style.display = "none";
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

function applyActivePlayerChange(): void {
  store.guideDismissedKey = null;
  hideGuideOverlay();
  syncCursorToBuildableCell(store.current);
  updateBattlefield(store.current);
  syncGuideOverlay(store.current);
  renderToolbar(store.current);
  renderPlayerCards(store.current);
}

// Hot-seat play: once a player is ready, hand the screen to the next player who still has to act.
function passTurnAfterReady(readyPlayerId: string): void {
  if (!store.current || store.current.phase !== "placement" || selectedPlayerId() !== readyPlayerId) {
    return;
  }
  const nextId = nextPendingPlayerId(store.current.players, readyPlayerId);
  if (!nextId || nextId === readyPlayerId) {
    return;
  }
  setActivePlayer(nextId);
  const next = store.current.players.find((player) => player.id === nextId);
  if (next) {
    showTurnBanner(next);
  }
}

function setActivePlayer(playerId: string): void {
  if (!store.current || playerId === el.playerId.value || !store.current.players.some((player) => player.id === playerId)) {
    return;
  }
  el.playerId.value = playerId;
  applyActivePlayerChange();
}

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
