import type { MapCell, MatchEvent, MatchSetup, MatchSnapshot, SimulationCommand, TowerTargetMode } from "@tower-defense/shared";

import { cellSizeForWidth, createBattlefieldMount } from "./battlefield-scene";
import { perfRecordBytes, perfTimeApply } from "./perf";
import "./style.css";

interface TestBoardHook {
  findBuildableCell(index?: number): { x: number; y: number } | null;
  cellSize(): number;
  cellToPixel(x: number, y: number): { x: number; y: number };
  creaturePositions(): Array<{ id: string; x: number; y: number }>;
  playback(): { playing: boolean; speed: number };
}

declare global {
  interface Window {
    __testBoard?: TestBoardHook;
  }
}

const TARGET_MODES: TowerTargetMode[] = ["first", "last", "strongest", "nearest"];
const PLAYER_COLORS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] as const;

type ApiErrorPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
};

// Snapshot as sent by the host: lite responses carry wornCells/eventsOffset instead of map.cells (see spec/07).
type WireSnapshot = Omit<MatchSnapshot, "map"> & {
  map: { width: number; height: number; seed: number; cells?: MapCell[]; wornCells?: Array<{ x: number; y: number; pathWear: number }> };
  eventsOffset?: number;
  eventsTotal?: number;
};

type ApiStartPayload = {
  ok: boolean;
  snapshot?: WireSnapshot;
  setup?: MatchSetup;
  error?: string;
  message?: string;
};

type ApiCommandPayload = {
  ok: boolean;
  result?: {
    accepted: boolean;
    reason?: string;
  };
  snapshot?: WireSnapshot;
  error?: string;
  message?: string;
};

type ApiAdvanceManyPayload = {
  ok: boolean;
  acceptedTicks?: number;
  stoppedReason?: string;
  snapshot?: WireSnapshot;
  error?: string;
  message?: string;
};

type FeedbackType = "accepted" | "rejected" | "info" | "error";

interface FeedbackItem {
  id: number;
  type: FeedbackType;
  message: string;
  commandType?: SimulationCommand["type"];
  reason?: string;
  createdAt: number;
}

interface FetchSnapshotOptions {
  silentStatus?: boolean;
}

interface MapCache {
  key: string;
  cells: MapCell[];
  byKey: Map<string, MapCell>;
  buildable: MapCell[];
  worn: MapCell[];
}

type GuideAction = "focus-place" | "place-tower" | "ready-player" | "toggle-playback";

interface GuideState {
  key: string;
  tone: "place" | "ready" | "start" | "hint";
  title: string;
  body: string;
  actionLabel: string;
  action: GuideAction;
}

interface MenuPlayerInput {
  id: string;
  inputId: string;
  defaultName: string;
}

const FEEDBACK_CAPACITY = 12;
// 5 ticks/s at 1x: creatures cover up to 5 cells/s, slow enough to follow and fast enough that a wave is over in seconds.
const BASE_TICKS_PER_SECOND = 5;
const PLAYBACK_SPEEDS = [1, 2, 4] as const;
const PLAYBACK_CHECK_INTERVAL_MS = 50;
const MAX_TICKS_PER_REQUEST = 4;
const MAX_PLAYBACK_ERRORS = 3;
const MANUAL_TRANSITION_MS = 120;
// Only these events drive presentation; the rest (movement, targeting, telemetry) would bloat the retained log.
const RETAINED_EVENT_TYPES: ReadonlySet<MatchEvent["type"]> = new Set([
  "tower-repaired",
  "wall-repaired",
  "path-repaired",
  "wave-clear-bonus"
]);
const EVENT_LOG_CAPACITY = 200;

const searchParams = new URLSearchParams(window.location.search);
const DEBUG = searchParams.get("debug") === "1";

let current: MatchSnapshot | null = null;
let feedbackItems: FeedbackItem[] = [];
let feedbackIdCounter = 1;
let menuPlayers: MenuPlayerInput[] = [];
let guideDismissedKey: string | null = null;
let lastGuideKey = "";
let mapCache: MapCache | null = null;
let eventLog: MatchEvent[] = [];
let eventCursor = 0;
let requestSeq = 0;
let appliedSeq = 0;
let playing = true;
let playbackSpeed: (typeof PLAYBACK_SPEEDS)[number] = 1;
let playbackTimer: ReturnType<typeof setInterval> | null = null;
let playbackLastClock = 0;
let tickDebt = 0;
let playbackInFlight = false;
let playbackErrors = 0;
let wallMode = false;
let playerSignature = "";
let chipStructureSignature = "";
interface PlayerChipRefs {
  root: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
  bar: HTMLElement | null;
}
let playerChips = new Map<string, PlayerChipRefs>();

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing app root.");
}

app.innerHTML = `
  <section id="menuScreen" class="menu-screen">
    <div class="menu-card">
      <div class="menu-badge">Offline mode • local skirmish • 1–8 players</div>
      <h1>Tower Defense</h1>
      <p class="menu-subtitle">Build your opening tower, hold the lane, and race to 1000 points before the field collapses.</p>
      <div class="menu-fields">
        <div class="menu-field">
          <label for="menuSeed">Map Seed</label>
          <input id="menuSeed" type="number" value="777" />
        </div>
        <div class="menu-field">
          <label for="menuPlayerCount">Players</label>
          <select id="menuPlayerCount">
            ${Array.from({ length: 8 }, (_, index) => {
              const count = index + 1;
              const selected = count === 2 ? "selected" : "";
              return `<option value="${count}" ${selected}>${count}</option>`;
            }).join("")}
          </select>
        </div>
        <div class="menu-field">
          <label for="menuAiPlayers">AI Players</label>
          <input id="menuAiPlayers" type="number" value="0" disabled />
          <span class="menu-hint">Coming later</span>
        </div>
      </div>
      <div id="menuPlayerNames" class="menu-player-names"></div>
      <div class="menu-actions">
        <button id="menuStartBtn" class="primary">Start Match</button>
        <button id="menuRefreshBtn">Refresh Existing Match</button>
      </div>
      <div class="menu-footnote">Tip: begin with two players to get a comfortable feel for the placement phase.</div>
      <div id="menuMessage" class="menu-message"></div>
    </div>
  </section>

  <section id="gameScreen" class="game-screen hidden">
    <header class="game-header">
      <div>
        <h2>Tower Defense Local Host</h2>
        <div class="small">Place towers, hold the lane, and outscore everyone.</div>
      </div>
      <div class="hud-chip-row" id="playerCards"></div>
    </header>

    <section class="phase-banner" id="phaseBanner">
      <div class="phase-label" id="phaseLabel">NO MATCH</div>
      <div class="phase-sub" id="phaseSub"></div>
    </section>

    <div class="battle-layout">
      <section class="battlefield card">
        <div class="battlefield-header">
          <h3>Battlefield</h3>
          <div class="small" id="battlefieldMeta">Click a buildable tile to place your tower.</div>
          <div id="playbackControls" class="playback-controls hidden" role="group" aria-label="Playback">
            <button id="playPauseBtn" aria-pressed="true">Pause</button>
            <button class="speed-btn" data-speed="1" aria-pressed="true">1x</button>
            <button class="speed-btn" data-speed="2" aria-pressed="false">2x</button>
            <button class="speed-btn" data-speed="4" aria-pressed="false">4x</button>
          </div>
        </div>
        <div id="guideOverlay" class="guide-overlay guide-idle" aria-live="polite">
          <div id="guideCard" class="guide-card hint">
            <div class="guide-text">
              <div id="guideTitle" class="guide-title"></div>
              <div id="guideBody" class="guide-body"></div>
            </div>
            <button id="guideActionBtn" class="guide-action"></button>
            <button id="guideCloseBtn" class="guide-close" aria-label="Dismiss guidance">x</button>
          </div>
        </div>
        <div id="board" class="board-grid"></div>
      </section>

      <aside class="control-panel card">
        <div class="panel-heading">
          <h3>Commander Panel</h3>
          <div class="panel-subtitle">Set your tower, then make the first wave count.</div>
        </div>
        <div class="command-help">Click a buildable tile on the battlefield to place your tower, then press R to lock in readiness.</div>
        <label>Active Player</label>
        <select id="playerId"></select>

        <div class="grid2 debug-only">
          <div>
            <label>Wall X</label>
            <input id="x" type="number" value="0" />
          </div>
          <div>
            <label>Wall Y</label>
            <input id="y" type="number" value="1" />
          </div>
        </div>

        <label>Target Mode</label>
        <select id="mode">
          <option value="first">first</option>
          <option value="last">last</option>
          <option value="strongest">strongest</option>
          <option value="nearest">nearest</option>
        </select>

        <div class="stack">
          <button id="readyBtn" class="good">Ready For Wave</button>
          <button id="placeWallBtn" aria-pressed="false">Place Wall</button>
          <button id="upgradeBtn">Upgrade Tower</button>
          <button id="modeBtn">Apply Target Mode</button>
          <button id="advanceBtn" class="primary debug-only">Advance Wave Tick</button>
          <button id="autoBtn" class="debug-only">Advance Wave (Auto)</button>
          <button id="refreshBtn">Refresh Snapshot</button>
          <button id="backToMenuBtn">Back To Menu</button>
        </div>

        <h3>Last Action</h3>
        <div id="status" class="status">No match yet.</div>

        <h3>Action Feedback</h3>
        <div id="feedbackQueue" class="feedback-queue">No feedback yet.</div>
      </aside>
    </div>

    <section class="snapshot-panel card debug-only">
      <h3>Snapshot JSON</h3>
      <textarea id="snapshot" readonly></textarea>
    </section>
  </section>

  <footer class="shortcuts-bar" id="shortcutBar">
    <div><kbd>R</kbd> ready <kbd>T</kbd> tower <kbd>W</kbd> wall mode <kbd>U</kbd> upgrade <kbd>P</kbd> pause</div>
    <div><kbd>Arrows</kbd> move cursor <kbd>Click</kbd> tile to place</div>
  </footer>

  <div class="match-end-overlay" id="matchEndOverlay">
    <div class="match-end-modal">
      <h2>Match Ended</h2>
      <div id="matchEndSummary" class="small"></div>
      <div id="matchEndScores" class="match-end-grid"></div>
      <div class="stack">
        <button id="rematchBtn" class="primary">Rematch</button>
        <button id="restartBtn" class="primary">Return To Menu</button>
        <button id="closeOverlayBtn">Close</button>
      </div>
    </div>
  </div>
`;

const el = {
  menuScreen: must<HTMLElement>("menuScreen"),
  gameScreen: must<HTMLElement>("gameScreen"),
  menuSeed: must<HTMLInputElement>("menuSeed"),
  menuPlayerCount: must<HTMLSelectElement>("menuPlayerCount"),
  menuAiPlayers: must<HTMLInputElement>("menuAiPlayers"),
  menuPlayerNames: must<HTMLElement>("menuPlayerNames"),
  menuMessage: must<HTMLElement>("menuMessage"),
  menuStartBtn: must<HTMLButtonElement>("menuStartBtn"),
  menuRefreshBtn: must<HTMLButtonElement>("menuRefreshBtn"),
  playerId: must<HTMLSelectElement>("playerId"),
  x: must<HTMLInputElement>("x"),
  y: must<HTMLInputElement>("y"),
  mode: must<HTMLSelectElement>("mode"),
  playerCards: must<HTMLElement>("playerCards"),
  phaseBanner: must<HTMLElement>("phaseBanner"),
  phaseLabel: must<HTMLElement>("phaseLabel"),
  phaseSub: must<HTMLElement>("phaseSub"),
  playbackControls: must<HTMLElement>("playbackControls"),
  playPauseBtn: must<HTMLButtonElement>("playPauseBtn"),
  placeWallBtn: must<HTMLButtonElement>("placeWallBtn"),
  shortcutBar: must<HTMLElement>("shortcutBar"),
  overlay: must<HTMLElement>("matchEndOverlay"),
  overlaySummary: must<HTMLElement>("matchEndSummary"),
  overlayScores: must<HTMLElement>("matchEndScores"),
  rematchBtn: must<HTMLButtonElement>("rematchBtn"),
  guideOverlay: must<HTMLElement>("guideOverlay"),
  guideCard: must<HTMLElement>("guideCard"),
  guideTitle: must<HTMLElement>("guideTitle"),
  guideBody: must<HTMLElement>("guideBody"),
  guideActionBtn: must<HTMLButtonElement>("guideActionBtn"),
  guideCloseBtn: must<HTMLButtonElement>("guideCloseBtn"),
  status: must<HTMLElement>("status"),
  feedbackQueue: must<HTMLElement>("feedbackQueue"),
  board: must<HTMLElement>("board"),
  snapshot: must<HTMLTextAreaElement>("snapshot"),
  battlefieldMeta: must<HTMLElement>("battlefieldMeta")
};

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

const battlefieldMount = createBattlefieldMount(el.board, {
  onCellClick: (x, y) => handleCellSelected(x, y)
});

function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured.replace(/\/$/, "");
  }
  return "";
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`);
  const text = await response.text();
  perfRecordBytes(text.length);
  const data = JSON.parse(text) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? "request-failed");
  }
  return data;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  perfRecordBytes(text.length);
  const data = JSON.parse(text) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? "request-failed");
  }
  return data;
}

function showMenuScreen(): void {
  el.menuScreen.classList.remove("hidden");
  el.gameScreen.classList.add("hidden");
  stopPlayback();
  hideGuideOverlay();
}

function showGameScreen(): void {
  el.menuScreen.classList.add("hidden");
  el.gameScreen.classList.remove("hidden");
}

function playerTowerId(playerId: string): string {
  return `tower-${playerId}`;
}

function setStatus(text: string): void {
  el.status.textContent = text;
}

function setMenuMessage(text: string): void {
  el.menuMessage.textContent = text;
}

function addFeedback(
  type: FeedbackType,
  message: string,
  commandType?: SimulationCommand["type"],
  reason?: string
): void {
  const item: FeedbackItem = {
    id: feedbackIdCounter,
    type,
    message,
    createdAt: Date.now()
  };

  if (commandType !== undefined) {
    item.commandType = commandType;
  }

  if (reason !== undefined) {
    item.reason = reason;
  }

  feedbackIdCounter += 1;
  feedbackItems = [item, ...feedbackItems].slice(0, FEEDBACK_CAPACITY);
  renderFeedbackQueue();
}

function renderFeedbackQueue(): void {
  if (feedbackItems.length === 0) {
    el.feedbackQueue.textContent = "No feedback yet.";
    return;
  }

  const entries = feedbackItems.map((item) => {
    const command = item.commandType ? ` (${item.commandType})` : "";
    const reason = item.reason ? ` reason=${item.reason}` : "";
    const time = new Date(item.createdAt).toLocaleTimeString();
    return (
      `<div class="feedback-item ${item.type}">` +
      `<div class="feedback-head"><span class="feedback-type">${item.type.toUpperCase()}</span><span class="feedback-time">${time}</span></div>` +
      `<div class="feedback-body">${item.message}${command}${reason}</div>` +
      "</div>"
    );
  });

  el.feedbackQueue.innerHTML = entries.join("");
}

function renderMenuPlayerInputs(): void {
  const count = Number(el.menuPlayerCount.value);
  menuPlayers = Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    inputId: `menuPlayerName${index + 1}`,
    defaultName: `Player ${index + 1}`
  }));

  el.menuPlayerNames.innerHTML = menuPlayers.map((player) => (
    `<label for="${player.inputId}">${player.id.toUpperCase()} Name</label>` +
    `<input id="${player.inputId}" value="${player.defaultName}" />`
  )).join("");
}

function menuPlayersToSetupPlayers(): MatchSetup["players"] {
  return menuPlayers.map((player, index) => {
    const element = must<HTMLInputElement>(player.inputId);
    const name = element.value.trim();
    return {
      id: `p${index + 1}`,
      name: name.length > 0 ? name : player.defaultName
    };
  });
}

// The guide is an inline coach mark above the board with reserved height, so it never overlaps or shifts the battlefield.
function hideGuideOverlay(): void {
  el.guideOverlay.classList.add("guide-idle");
  lastGuideKey = "";
}

function showGuideOverlay(state: GuideState): void {
  el.guideCard.className = `guide-card ${state.tone}`;
  el.guideTitle.textContent = state.title;
  el.guideBody.textContent = state.body;
  el.guideActionBtn.textContent = state.actionLabel;
  el.guideActionBtn.dataset.action = state.action;
  el.guideOverlay.classList.remove("guide-idle");
}

function activePlayerFromSnapshot(snapshot: MatchSnapshot): MatchSnapshot["players"][number] | null {
  const selected = el.playerId.value;
  const selectedPlayer = snapshot.players.find((player) => player.id === selected);
  if (selectedPlayer) {
    return selectedPlayer;
  }

  return snapshot.players[0] ?? null;
}

function computeGuideState(snapshot: MatchSnapshot | null): GuideState | null {
  if (!snapshot || snapshot.phase === "ended") {
    return null;
  }

  const activePlayer = activePlayerFromSnapshot(snapshot);
  if (!activePlayer) {
    return null;
  }

  if (snapshot.phase === "placement") {
    if (!activePlayer.hasPlacedTower) {
      return {
        key: `place-${activePlayer.id}`,
        tone: "place",
        title: `${activePlayer.name}, claim the opening tower`,
        body: "Click a buildable tile on the battlefield to place your tower there.",
        actionLabel: "Place Tower Now",
        action: "place-tower"
      };
    }

    if (!activePlayer.readyForWave) {
      const everyonePlaced = snapshot.players.every((player) => player.hasPlacedTower);
      if (everyonePlaced) {
        return {
          key: `ready-${activePlayer.id}-${snapshot.wave}`,
          tone: "ready",
          title: `${activePlayer.name}, lock in your setup`,
          body: "Every tower is in place. Confirm readiness so the first wave can begin on schedule.",
          actionLabel: "Ready For Wave",
          action: "ready-player"
        };
      }
    }

    const allReady = snapshot.players.every((player) => player.readyForWave);
    if (allReady) {
      return {
        key: `start-wave-${snapshot.wave}`,
        tone: "start",
        title: "All players are ready",
        body: "The setup is complete. The battle starts automatically.",
        actionLabel: "Play",
        action: "toggle-playback"
      };
    }

    return {
      key: `wait-${activePlayer.id}-${snapshot.wave}`,
      tone: "hint",
      title: "Waiting for the field to settle",
      body: "You are set. Watch the player cards while the rest of the table finishes placement and readiness.",
      actionLabel: "Refresh Snapshot",
      action: "focus-place"
    };
  }

  if (snapshot.phase === "wave") {
    return {
      key: `wave-${snapshot.wave}`,
      tone: "hint",
      title: "Wave in progress",
      body: "The battle runs on its own. Use Place Wall, upgrades, and target modes to hold the lane, or pause to think.",
      actionLabel: playing ? "Pause" : "Resume",
      action: "toggle-playback"
    };
  }

  return null;
}

function syncGuideOverlay(snapshot: MatchSnapshot | null): void {
  const state = computeGuideState(snapshot);
  if (!state) {
    hideGuideOverlay();
    return;
  }

  if (guideDismissedKey === state.key) {
    hideGuideOverlay();
    guideDismissedKey = state.key;
    return;
  }

  if (state.key === lastGuideKey && !el.guideOverlay.classList.contains("guide-idle")) {
    return;
  }

  lastGuideKey = state.key;
  showGuideOverlay(state);
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

  setPlaying(!playing);
}

function mapKeyOf(map: { seed: number; width: number; height: number }): string {
  return `${map.seed}:${map.width}x${map.height}`;
}

function resetMatchCaches(): void {
  eventLog = [];
  eventCursor = 0;
}

function buildMapCache(key: string, cells: MapCell[]): MapCache {
  const byKey = new Map<string, MapCell>();
  const buildable: MapCell[] = [];
  const worn: MapCell[] = [];
  for (const cell of cells) {
    byKey.set(`${cell.x},${cell.y}`, cell);
    if (cell.buildable) {
      buildable.push(cell);
    }
    if (cell.pathWear > 0) {
      worn.push(cell);
    }
  }
  return { key, cells, byKey, buildable, worn };
}

// Turns a wire snapshot (possibly lite) into a full MatchSnapshot. Returns null when a lite snapshot
// arrives for a map whose cells we do not have, so the caller can fall back to a full fetch.
function hydrateSnapshot(wire: WireSnapshot): { snapshot: MatchSnapshot; newEvents: MatchEvent[] } | null {
  const key = mapKeyOf(wire.map);
  if (wire.map.cells) {
    mapCache = buildMapCache(key, wire.map.cells);
  } else if (!mapCache || mapCache.key !== key) {
    return null;
  } else {
    // The cached cell objects are mutated in place so the scene and lookups always see current wear.
    for (const cell of mapCache.worn) {
      cell.pathWear = 0;
    }
    mapCache.worn = [];
    for (const entry of wire.map.wornCells ?? []) {
      const cell = mapCache.byKey.get(`${entry.x},${entry.y}`);
      if (cell) {
        cell.pathWear = entry.pathWear;
        mapCache.worn.push(cell);
      }
    }
  }

  const offset = wire.eventsOffset ?? 0;
  const tail = wire.events;
  const total = wire.eventsTotal ?? offset + tail.length;
  let newEvents: MatchEvent[];
  if (total < eventCursor) {
    // The host restarted its match behind our back; drop history rather than replaying it.
    eventLog = [];
    newEvents = [];
  } else {
    newEvents = tail.slice(Math.max(0, eventCursor - offset));
  }
  eventCursor = total;
  const retained = newEvents.filter((event) => RETAINED_EVENT_TYPES.has(event.type));
  if (retained.length > 0) {
    eventLog = [...eventLog, ...retained].slice(-EVENT_LOG_CAPACITY);
  }

  const snapshot: MatchSnapshot = {
    ...wire,
    map: { width: wire.map.width, height: wire.map.height, seed: wire.map.seed, cells: mapCache.cells },
    events: eventLog
  };
  return { snapshot, newEvents };
}

// Applies a host response unless a newer one was already applied. Returns false when a full refetch is needed.
function applyWireSnapshot(wire: WireSnapshot, seq: number): boolean {
  if (seq < appliedSeq) {
    return true;
  }
  const hydrated = hydrateSnapshot(wire);
  if (!hydrated) {
    return false;
  }
  appliedSeq = seq;
  applySnapshot(hydrated.snapshot, hydrated.newEvents);
  return true;
}

function applySnapshot(snapshot: MatchSnapshot, newEvents: MatchEvent[]): void {
  perfTimeApply(() => applySnapshotInner(snapshot, newEvents));
}

function applySnapshotInner(snapshot: MatchSnapshot, newEvents: MatchEvent[]): void {
  const previous = current;
  current = snapshot;
  // Real ticks between snapshots set how long creatures glide; anything else (new wave, rewind) snaps quickly.
  const ticksElapsed = previous && previous.wave === snapshot.wave && previous.phase === "wave" && snapshot.phase === "wave"
    ? snapshot.waveTick - previous.waveTick
    : 0;
  const glideMs = ticksElapsed > 0 ? ticksElapsed * msPerTick() : MANUAL_TRANSITION_MS;

  announceRepairEvents(snapshot, newEvents);
  showGameScreen();
  updatePlayerOptions(current);
  syncCursorToBuildableCell(current);
  updateBattlefield(current, glideMs);
  renderPlayerCards(current, newEvents);
  renderPhase(current);
  renderEndOverlay(current);
  renderSnapshot(current);
  syncGuideOverlay(current);
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
    }
  }
}

function msPerTick(): number {
  return 1000 / (BASE_TICKS_PER_SECOND * playbackSpeed);
}

function playbackShouldRun(): boolean {
  return playing && !document.hidden && current?.phase === "wave" && !el.gameScreen.classList.contains("hidden");
}

function startPlayback(): void {
  if (playbackTimer !== null) {
    return;
  }
  playbackLastClock = performance.now();
  tickDebt = 0;
  playbackErrors = 0;
  playbackTimer = setInterval(playbackStep, PLAYBACK_CHECK_INTERVAL_MS);
}

function stopPlayback(): void {
  if (playbackTimer !== null) {
    clearInterval(playbackTimer);
    playbackTimer = null;
  }
  tickDebt = 0;
}

// Fixed-rate tick accumulator: at most one request in flight, and stalls or hidden tabs never cause a catch-up burst.
function playbackStep(): void {
  const now = performance.now();
  const elapsedMs = Math.min(now - playbackLastClock, 250);
  playbackLastClock = now;
  if (!playbackShouldRun()) {
    tickDebt = 0;
    return;
  }

  tickDebt = Math.min(tickDebt + (elapsedMs / 1000) * BASE_TICKS_PER_SECOND * playbackSpeed, MAX_TICKS_PER_REQUEST);
  const ticks = Math.floor(tickDebt);
  if (playbackInFlight || ticks < 1) {
    return;
  }
  tickDebt -= ticks;
  playbackInFlight = true;
  void advanceTicks(ticks).finally(() => {
    playbackInFlight = false;
  });
}

async function advanceTicks(ticks: number): Promise<void> {
  const seq = ++requestSeq;
  try {
    const data = await postJson<ApiAdvanceManyPayload>("/api/advance-many", { ticks, lite: true, eventsSince: eventCursor });
    playbackErrors = 0;
    if (data.snapshot && !applyWireSnapshot(data.snapshot, seq)) {
      await fetchSnapshot({ silentStatus: true });
    }
  } catch (error) {
    playbackErrors += 1;
    if (playbackErrors >= MAX_PLAYBACK_ERRORS) {
      setPlaying(false);
      const message = error instanceof Error ? error.message : "request failed";
      setStatus(`Playback paused after repeated failures: ${message}`);
      addFeedback("error", "Playback paused after repeated failures", undefined, message);
    }
  }
}

function setPlaying(next: boolean): void {
  playing = next;
  syncPlaybackControls();
  if (playing) {
    tickDebt = 0;
    playbackLastClock = performance.now();
  }
  // The wave guidance button label mirrors the current state.
  syncGuideOverlay(current);
}

function setPlaybackSpeed(next: (typeof PLAYBACK_SPEEDS)[number]): void {
  playbackSpeed = next;
  syncPlaybackControls();
}

function syncPlaybackControls(): void {
  el.playPauseBtn.textContent = playing ? "Pause" : "Play";
  el.playPauseBtn.setAttribute("aria-pressed", String(playing));
  for (const button of el.playbackControls.querySelectorAll<HTMLButtonElement>(".speed-btn")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === playbackSpeed));
  }
}

document.addEventListener("visibilitychange", () => {
  tickDebt = 0;
  playbackLastClock = performance.now();
});

function pickDefaultPlayer(snapshot: MatchSnapshot | null): string {
  if (!snapshot || snapshot.players.length === 0) {
    return "";
  }
  return snapshot.players[0]?.id ?? "";
}

function updatePlayerOptions(snapshot: MatchSnapshot | null): void {
  const players = snapshot?.players ?? [];
  const signature = players.map((player) => `${player.id}:${player.name}`).join("|");
  if (signature === playerSignature) {
    return;
  }
  playerSignature = signature;

  const previous = el.playerId.value;
  el.playerId.innerHTML = "";
  for (const player of players) {
    const option = document.createElement("option");
    option.value = player.id;
    option.textContent = `${player.id} (${player.name})`;
    el.playerId.append(option);
  }
  if (players.some((player) => player.id === previous)) {
    el.playerId.value = previous;
  } else {
    el.playerId.value = pickDefaultPlayer(snapshot);
  }
}

function towerColorClass(playerId: string): string {
  const index = Number(playerId.replace(/\D+/g, "")) - 1;
  return PLAYER_COLORS[Math.max(0, Math.min(PLAYER_COLORS.length - 1, index))] ?? "p1";
}

function updateBattlefield(snapshot: MatchSnapshot | null, transitionMs = 0): void {
  battlefieldMount.renderMap(snapshot, transitionMs);
  battlefieldMount.setCursor(coordValue(el.x), coordValue(el.y));
  syncPlacementContext(snapshot);

  if (!snapshot) {
    el.battlefieldMeta.textContent = "Click a buildable tile to place your tower.";
    return;
  }

  const creatureLabel = snapshot.creatures.length === 1 ? "creature" : "creatures";
  el.battlefieldMeta.textContent = `Wave ${snapshot.wave} • Tick ${snapshot.waveTick} • ${snapshot.creatures.length} ${creatureLabel} active`;
}

function syncPlacementContext(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    return;
  }
  const playerId = el.playerId.value;
  battlefieldMount.setPlacementContext({
    phase: snapshot.phase,
    playerId,
    hasTowerAlready: snapshot.towers.some((tower) => tower.playerId === playerId)
  });
}

function renderSnapshot(snapshot: MatchSnapshot | null): void {
  if (!DEBUG) {
    return;
  }
  // The static cell list is elided; it is 2500 entries of noise in a debugging view.
  const view = snapshot ? { ...snapshot, map: { ...snapshot.map, cells: `[${snapshot.map.cells.length} cells]` } } : null;
  el.snapshot.value = JSON.stringify(view, null, 2);
}

function buildPlayerChip(player: MatchSnapshot["players"][number], towerId: string | null): PlayerChipRefs {
  const root = document.createElement("div");
  root.className = "player-chip";
  const name = document.createElement("div");
  name.className = "player-chip-name";
  const meta = document.createElement("div");
  meta.className = "player-chip-meta";
  root.append(name, meta);
  let bar: HTMLElement | null = null;
  if (towerId) {
    bar = document.createElement("div");
    bar.className = "tower-hp-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${player.name} tower health`);
    bar.setAttribute("aria-valuemin", "0");
    root.append(bar);
  }
  return { root, name, meta, bar };
}

// Chips are created once per (player, tower) and updated in place so HP bar transitions and pulses survive snapshots.
function renderPlayerCards(snapshot: MatchSnapshot | null, newEvents: MatchEvent[] = []): void {
  if (!snapshot) {
    playerChips = new Map();
    el.playerCards.textContent = "No active match";
    return;
  }

  const towersByPlayer = new Map(snapshot.towers.map((tower) => [tower.playerId, tower]));
  const repairedTowerIds = new Set(
    newEvents.filter((event) => event.type === "tower-repaired").map((event) => event.towerId)
  );
  const structure = snapshot.players.map((player) => `${player.id}:${towersByPlayer.has(player.id) ? 1 : 0}`).join("|");
  if (structure !== chipStructureSignature) {
    chipStructureSignature = structure;
    playerChips = new Map();
    el.playerCards.textContent = "";
    for (const player of snapshot.players) {
      const tower = towersByPlayer.get(player.id);
      const refs = buildPlayerChip(player, tower?.id ?? null);
      playerChips.set(player.id, refs);
      el.playerCards.append(refs.root);
    }
  }

  for (const player of snapshot.players) {
    const refs = playerChips.get(player.id);
    if (!refs) {
      continue;
    }
    const tower = towersByPlayer.get(player.id);
    const towerStatus = tower ? `Tower ${tower.health}/${tower.maxHealth}` : "Tower not placed";
    let status = "waiting";
    let label = "WAITING";
    if (player.eliminated) {
      status = "eliminated";
      label = "ELIMINATED";
    } else if (player.readyForWave) {
      status = "ready";
      label = "READY";
    }

    const className = `player-chip ${status} ${towerColorClass(player.id)}`;
    if (refs.root.className !== className) {
      refs.root.className = className;
    }
    if (tower) {
      refs.root.dataset.towerId = tower.id;
    } else {
      delete refs.root.dataset.towerId;
    }
    if (refs.name.textContent !== player.name) {
      refs.name.textContent = player.name;
    }
    const metaText = `${player.points} pts | ${towerStatus} | ${label}`;
    if (refs.meta.textContent !== metaText) {
      refs.meta.textContent = metaText;
    }

    if (tower && refs.bar) {
      refs.bar.setAttribute("aria-valuemax", String(tower.maxHealth));
      refs.bar.setAttribute("aria-valuenow", String(tower.health));
      refs.bar.style.width = `${(tower.health / tower.maxHealth) * 100}%`;
      if (repairedTowerIds.has(tower.id)) {
        // Restart the animation if a previous pulse class is still present.
        refs.bar.classList.remove("repair-pulse");
        void refs.bar.offsetWidth;
        refs.bar.classList.add("repair-pulse");
      } else {
        refs.bar.classList.remove("repair-pulse");
      }
    }
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

    return "All towers are set. Lock in readiness to start the first wave.";
  }

  if (snapshot.phase === "wave") {
    return "Combat is live. Use walls, upgrades, and target modes to hold the lane.";
  }

  if (snapshot.phase === "ended") {
    return snapshot.winnerId
      ? `Winner ${snapshot.winnerId} • ${snapshot.endReason ?? "match concluded"}`
      : "No winner • the match ended in a draw-like state.";
  }

  return "Prepare for the next round.";
}

function renderPhase(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    el.phaseBanner.className = "phase-banner";
    el.phaseLabel.textContent = "NO MATCH";
    el.phaseSub.textContent = "Start a local match to play.";
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
  el.shortcutBar.style.display = snapshot.phase === "ended" ? "none" : "flex";

  if (snapshot.phase === "wave") {
    el.playbackControls.classList.remove("hidden");
    startPlayback();
  } else {
    el.playbackControls.classList.add("hidden");
    stopPlayback();
  }
}

function renderEndOverlay(snapshot: MatchSnapshot | null): void {
  if (!snapshot || snapshot.phase !== "ended") {
    el.overlay.style.display = "none";
    return;
  }

  const winner = snapshot.players.find((player) => player.id === snapshot.winnerId);
  const winnerText = winner
    ? `${winner.name} (${winner.id})`
    : (snapshot.winnerId ?? "none");

  el.overlaySummary.textContent = `${winnerText} secured the win${snapshot.endReason ? ` • ${snapshot.endReason}` : ""}.`;

  const ranked = [...snapshot.players].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  el.overlayScores.innerHTML = ranked
    .map((player) => `<div>${player.name}</div><div>${player.points} pts</div>`)
    .join("");

  el.overlay.style.display = "flex";
}

function closeOverlay(): void {
  el.overlay.style.display = "none";
}

async function fetchSnapshot(options?: FetchSnapshotOptions): Promise<MatchSnapshot | null> {
  const seq = ++requestSeq;
  try {
    // Without cached map cells the host must send a full snapshot; afterwards lite is enough.
    const path = mapCache ? `/api/snapshot?lite=1&eventsSince=${eventCursor}` : "/api/snapshot";
    let data = await getJson<{ ok: true; snapshot: WireSnapshot }>(path);
    if (!applyWireSnapshot(data.snapshot, seq)) {
      data = await getJson<{ ok: true; snapshot: WireSnapshot }>("/api/snapshot");
      applyWireSnapshot(data.snapshot, seq);
    }
    setMenuMessage("Reconnected to running match.");
    return current;
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
  guideDismissedKey = null;
  playing = true;
  syncPlaybackControls();
  setWallMode(false);
  applyWireSnapshot(wire, ++requestSeq);
}

async function startMatchFromMenu(): Promise<void> {
  closeOverlay();
  setMenuMessage("");

  const players = menuPlayersToSetupPlayers();
  const payload: MatchSetup = {
    seed: Number(el.menuSeed.value),
    players
  };

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
  if (!current) {
    return;
  }

  const players = current.players.map((player) => ({ id: player.id, name: player.name }));
  const payload: MatchSetup = {
    seed: current.map.seed + 1,
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

function selectedPlayerId(): string {
  const value = String(el.playerId.value || "").trim();
  if (!value) {
    const fallback = current?.players[0]?.id ?? "";
    if (fallback) {
      el.playerId.value = fallback;
      return fallback;
    }
  }
  return value;
}

function currentCommandCoords(snapshot: MatchSnapshot | null): { x: number; y: number } {
  const nextCell = firstFreeBuildableCoord(snapshot);
  if (nextCell) {
    el.x.value = String(nextCell.x);
    el.y.value = String(nextCell.y);
    return nextCell;
  }

  return {
    x: coordValue(el.x),
    y: coordValue(el.y)
  };
}

function occupiedCellKeys(snapshot: MatchSnapshot): Set<string> {
  const occupied = new Set<string>();
  for (const tower of snapshot.towers) {
    occupied.add(`${tower.x},${tower.y}`);
  }
  for (const wall of snapshot.walls) {
    occupied.add(`${wall.x},${wall.y}`);
  }
  return occupied;
}

function firstFreeBuildableCoord(snapshot: MatchSnapshot | null): { x: number; y: number } | null {
  if (!snapshot || !mapCache) {
    return null;
  }

  const occupied = occupiedCellKeys(snapshot);
  const currentX = Number(el.x.value);
  const currentY = Number(el.y.value);
  const currentCell = mapCache.byKey.get(`${currentX},${currentY}`);
  if (currentCell?.buildable && !occupied.has(`${currentX},${currentY}`)) {
    return { x: currentX, y: currentY };
  }

  const cell = mapCache.buildable.find((entry) => !occupied.has(`${entry.x},${entry.y}`));
  return cell ? { x: cell.x, y: cell.y } : null;
}

function syncCursorToBuildableCell(snapshot: MatchSnapshot | null): void {
  const nextCell = firstFreeBuildableCoord(snapshot);
  if (!nextCell) {
    return;
  }

  el.x.value = String(nextCell.x);
  el.y.value = String(nextCell.y);
}

function coordValue(field: HTMLInputElement): number {
  return Number(field.value);
}

function clampCoord(value: number, max: number): number {
  if (max <= 0 || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(max - 1, value));
}

function adjustCoord(dx: number, dy: number): void {
  const width = current?.map?.width ?? 64;
  const height = current?.map?.height ?? 64;
  const nextX = clampCoord(coordValue(el.x) + dx, width);
  const nextY = clampCoord(coordValue(el.y) + dy, height);
  el.x.value = String(nextX);
  el.y.value = String(nextY);
  if (current) {
    battlefieldMount.setCursor(coordValue(el.x), coordValue(el.y));
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
  if (!current) {
    return;
  }

  el.x.value = String(x);
  el.y.value = String(y);
  battlefieldMount.setCursor(x, y);

  const cell = mapCache?.byKey.get(`${x},${y}`);
  if (!cell || !cell.buildable) {
    return;
  }

  if (occupiedCellKeys(current).has(`${x},${y}`)) {
    return;
  }

  const playerId = selectedPlayerId();
  if (wallMode) {
    void sendCommand({ type: "place-wall", playerId, x, y });
    return;
  }

  const alreadyHasTower = current.towers.some((tower) => tower.playerId === playerId);
  if (current.phase === "placement" && !alreadyHasTower) {
    void sendCommand({ type: "place-tower", playerId, x, y });
  }
}

function setWallMode(next: boolean): void {
  wallMode = next;
  el.placeWallBtn.setAttribute("aria-pressed", String(next));
  el.placeWallBtn.classList.toggle("active", next);
  el.battlefieldMeta.classList.toggle("wall-mode", next);
  if (current) {
    updateBattlefield(current);
  }
}

async function sendCommand(command: SimulationCommand): Promise<void> {
  const seq = ++requestSeq;
  try {
    const data = await postJson<ApiCommandPayload>("/api/command", { command, lite: true, eventsSince: eventCursor });
    const result = data.result;
    if (!result?.accepted) {
      setStatus(`rejected: ${result?.reason ?? "unknown"}`);
      addFeedback("rejected", "Command rejected", command.type, result?.reason);
    } else {
      setStatus("accepted");
      addFeedback("accepted", "Command accepted", command.type);
    }

    if (!data.snapshot || !applyWireSnapshot(data.snapshot, seq)) {
      await fetchSnapshot();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send command";
    setStatus(`error: ${message}`);
    addFeedback("error", "Command failed", command.type, message);
  }
}

el.menuPlayerCount.addEventListener("change", renderMenuPlayerInputs);
el.menuStartBtn.addEventListener("click", () => {
  void startMatchFromMenu();
});
el.menuRefreshBtn.addEventListener("click", () => {
  void fetchSnapshot();
});

must<HTMLButtonElement>("refreshBtn").addEventListener("click", () => {
  addFeedback("info", "Manual snapshot refresh");
  guideDismissedKey = null;
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
  guideDismissedKey = lastGuideKey;
  hideGuideOverlay();
});

el.guideActionBtn.addEventListener("click", () => {
  const action = el.guideActionBtn.dataset.action as GuideAction | undefined;
  if (!action) {
    return;
  }

  guideDismissedKey = null;
  hideGuideOverlay();
  runGuideAction(action);
});

el.playerId.addEventListener("change", () => {
  guideDismissedKey = null;
  hideGuideOverlay();
  syncCursorToBuildableCell(current);
  updateBattlefield(current);
  syncGuideOverlay(current);
});

must<HTMLButtonElement>("closeOverlayBtn").addEventListener("click", closeOverlay);
el.rematchBtn.addEventListener("click", () => {
  void rematchWithSamePlayers();
});

function placeTowerForSelectedPlayer(): void {
  const playerId = selectedPlayerId();
  const coords = currentCommandCoords(current);
  void sendCommand({
    type: "place-tower",
    playerId,
    x: coords.x,
    y: coords.y
  });
}

must<HTMLButtonElement>("readyBtn").addEventListener("click", () => {
  void sendCommand({ type: "ready-for-wave", playerId: selectedPlayerId() });
});

// Walls are placed by clicking tiles while this mode is on (the sim accepts walls during combat only).
el.placeWallBtn.addEventListener("click", () => {
  setWallMode(!wallMode);
});

el.playPauseBtn.addEventListener("click", () => {
  setPlaying(!playing);
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

must<HTMLButtonElement>("upgradeBtn").addEventListener("click", () => {
  const playerId = selectedPlayerId();
  void sendCommand({
    type: "upgrade-tower",
    playerId,
    towerId: playerTowerId(playerId)
  });
});

must<HTMLButtonElement>("modeBtn").addEventListener("click", () => {
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

must<HTMLButtonElement>("advanceBtn").addEventListener("click", () => {
  void sendCommand({ type: "advance-wave" });
});

must<HTMLButtonElement>("autoBtn").addEventListener("click", async () => {
  try {
    const attemptedTicks = 200;
    const seq = ++requestSeq;
    const data = await postJson<ApiAdvanceManyPayload>("/api/advance-many", { ticks: attemptedTicks, lite: true, eventsSince: eventCursor });
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

document.addEventListener("keydown", (event) => {
  if (isFormField(event.target)) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "r") {
    event.preventDefault();
    must<HTMLButtonElement>("readyBtn").click();
    return;
  }

  if (key === "t") {
    event.preventDefault();
    placeTowerForSelectedPlayer();
    return;
  }

  if (key === "w") {
    event.preventDefault();
    el.placeWallBtn.click();
    return;
  }

  if (key === "p") {
    event.preventDefault();
    el.playPauseBtn.click();
    return;
  }

  if (event.key === "Escape" && wallMode) {
    setWallMode(false);
    return;
  }

  if (key === "u") {
    event.preventDefault();
    must<HTMLButtonElement>("upgradeBtn").click();
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
renderPhase(null);
renderFeedbackQueue();
showMenuScreen();
setStatus("No match yet.");
setMenuMessage("Create a local match or reconnect to an existing one.");
hideGuideOverlay();
void fetchSnapshot({ silentStatus: true });

// Read-only test hook so Playwright can locate buildable cells without DOM grid elements.
function findBuildableCellsInOrder(): Array<{ x: number; y: number }> {
  if (!current || !mapCache) {
    return [];
  }

  const occupied = occupiedCellKeys(current);
  return mapCache.buildable
    .filter((cell) => !occupied.has(`${cell.x},${cell.y}`))
    .map((cell) => ({ x: cell.x, y: cell.y }));
}

window.__testBoard = {
  findBuildableCell(index = 0): { x: number; y: number } | null {
    return findBuildableCellsInOrder()[index] ?? null;
  },
  cellSize(): number {
    return cellSizeForWidth(current?.map.width ?? 64);
  },
  cellToPixel(x: number, y: number): { x: number; y: number } {
    const size = cellSizeForWidth(current?.map.width ?? 64);
    return { x: x * size + size / 2, y: y * size + size / 2 };
  },
  creaturePositions(): Array<{ id: string; x: number; y: number }> {
    return battlefieldMount.creaturePositions();
  },
  playback(): { playing: boolean; speed: number } {
    return { playing, speed: playbackSpeed };
  }
};
