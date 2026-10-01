import { TICKS_PER_SECOND, WIN_SCORE, getTowerUpgradeCost, getWallCost, isInSpawnProtection } from "@tower-defense/shared";
import type { MapCell, MatchEvent, MatchSetup, MatchSnapshot, SimulationCommand, TowerTargetMode } from "@tower-defense/shared";

import { applyPaletteCssVars } from "./art/palette";
import { cueForCommandResult, cuesForSnapshotChange, createSoundEngine } from "./audio/index";
import type { SoundId } from "./audio/index";
import { paintHero } from "./art/hero";
import { createBattlefieldMount } from "./battlefield-scene";
import { createDemo } from "./demo";
import { perfRecordBytes, perfTimeApply } from "./perf";
import { createSettingsStore } from "./settings/settings";
import { mountSettingsDialog } from "./settings/settings-dialog";
import { firstPendingPlayerId, nextPendingPlayerId } from "./turn";
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

const TARGET_MODES: TowerTargetMode[] = ["first", "last", "strongest", "nearest"];
const PLAYER_COLORS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] as const;

type ApiErrorPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
};

// Snapshot as sent by the host: lite responses carry wornCells/eventsOffset instead of map.cells (see spec/07).
type WireSnapshot = Omit<MatchSnapshot, "map"> & {
  map: {
    width: number;
    height: number;
    seed: number;
    spawn?: { x: number; y: number };
    cells?: MapCell[];
    wornCells?: Array<{ x: number; y: number; pathWear: number }>;
  };
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

const TOAST_CAPACITY = 5;
const TOAST_LIFETIME_MS = 4500;
const BANNER_LIFETIME_MS = 2600;
// Longer than the wave banner: the player has to notice whose turn it is and hand over the screen.
const TURN_BANNER_LIFETIME_MS = 3500;
// 5 ticks/s at 1x: creatures cover up to 5 cells/s, slow enough to follow and fast enough that a wave is over in seconds.
const BASE_TICKS_PER_SECOND = TICKS_PER_SECOND;
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
const MAX_FX_EVENT_BACKLOG = 300;

const searchParams = new URLSearchParams(window.location.search);
const DEBUG = searchParams.get("debug") === "1";

let current: MatchSnapshot | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
let turnBannerTimer: ReturnType<typeof setTimeout> | null = null;
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
  state: HTMLElement;
  points: HTMLElement;
  goalFill: HTMLElement;
  meta: HTMLElement;
  bar: HTMLElement | null;
  barFill: HTMLElement | null;
}
let playerChips = new Map<string, PlayerChipRefs>();

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing app root.");
}

app.innerHTML = `
  <section id="menuScreen" class="menu-screen">
    <div class="menu-card">
      <canvas id="menuHero" class="menu-hero" aria-hidden="true"></canvas>
      <div class="menu-body">
        <div class="menu-badge">Offline mode &bull; local skirmish &bull; 1&ndash;8 players</div>
        <h1 class="menu-title">Tower <span>Defense</span></h1>
        <p class="menu-subtitle">Place your tower, hold the line, and race to 1000 points before the field collapses.</p>
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
          <button id="menuRefreshBtn" class="ghost">Refresh Existing Match</button>
          <button id="menuSettingsBtn" class="ghost menu-settings">Settings</button>
        </div>
        <div id="menuMessage" class="menu-message"></div>
      </div>
    </div>
  </section>

  <section id="gameScreen" class="game-screen hidden">
    <div class="stage">
      <header class="topbar">
        <div class="brand">Tower <span>Defense</span></div>
        <section class="phase-banner" id="phaseBanner">
          <div class="phase-label" id="phaseLabel">NO MATCH</div>
          <div class="phase-sub" id="phaseSub"></div>
        </section>
        <div id="playbackControls" class="playback-controls hidden" role="group" aria-label="Playback">
          <button id="playPauseBtn" aria-pressed="true">Pause</button>
          <button class="speed-btn" data-speed="1" aria-pressed="true">1x</button>
          <button class="speed-btn" data-speed="2" aria-pressed="false">2x</button>
          <button class="speed-btn" data-speed="4" aria-pressed="false">4x</button>
        </div>
      </header>

      <div id="guideOverlay" class="guide-overlay guide-idle" aria-live="polite">
        <div id="guideCard" class="guide-card hint">
          <div class="guide-text">
            <div id="guideTitle" class="guide-title"></div>
            <div id="guideBody" class="guide-body"></div>
          </div>
          <button id="guideActionBtn" class="guide-action"></button>
          <button id="guideCloseBtn" class="guide-close" aria-label="Dismiss guidance">&times;</button>
        </div>
      </div>

      <section class="battlefield">
        <div class="board-frame">
          <div id="board" class="board-grid"></div>
          <div id="waveBanner" class="wave-banner" aria-live="polite"><strong></strong><span></span></div>
          <div id="turnBanner" class="turn-banner" aria-live="polite"><strong></strong><span></span></div>
        </div>
        <div class="small battlefield-meta" id="battlefieldMeta">Click a buildable tile to place your tower.</div>
      </section>
    </div>

    <aside class="control-panel">
      <div class="hud-chip-row" id="playerCards" aria-label="Scoreboard"></div>

      <div class="panel-block">
        <label for="playerId">Active Player <span class="hint">(1-8)</span></label>
        <select id="playerId"></select>
      </div>

      <div class="grid2 debug-only">
        <div>
          <label for="x">Wall X</label>
          <input id="x" type="number" value="0" />
        </div>
        <div>
          <label for="y">Wall Y</label>
          <input id="y" type="number" value="1" />
        </div>
      </div>

      <div class="toolbar" role="group" aria-label="Actions">
        <button id="placeTowerBtn" data-sfx="none" class="tool" title="Place your tower on the highlighted tile (T)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 12h9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><span class="tool-label">Place Tower</span><span class="tool-cost">free</span><kbd>T</kbd>
        </button>
        <button id="placeWallBtn" class="tool" aria-pressed="false" title="Toggle wall mode, then click tiles (W)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M9 5v7M15 12v7" stroke="currentColor" stroke-width="2"/></svg><span class="tool-label">Place Wall</span><span class="tool-cost" id="wallCost">25</span><kbd>W</kbd>
        </button>
        <button id="upgradeBtn" data-sfx="none" class="tool" title="Upgrade your tower (U)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 9h-5v9H9v-9H4z" fill="currentColor"/></svg><span class="tool-label">Upgrade Tower</span><span class="tool-cost" id="upgradeCost">50</span><kbd>U</kbd>
        </button>
        <button id="readyBtn" data-sfx="none" class="tool good" title="Lock in your setup (R)">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="tool-label">Ready For Wave</span><span class="tool-cost">&nbsp;</span><kbd>R</kbd>
        </button>
      </div>

      <div class="panel-block">
        <label for="mode">Target Mode</label>
        <select id="mode">
          <option value="first">first</option>
          <option value="last">last</option>
          <option value="strongest">strongest</option>
          <option value="nearest">nearest</option>
        </select>
      </div>

      <div class="stack debug-only">
        <button id="advanceBtn" class="primary">Advance Wave Tick</button>
        <button id="autoBtn">Advance Wave (Auto)</button>
        <button id="demoBtn">Demo Combat</button>
      </div>

      <div id="status" class="status">No match yet.</div>

      <div class="session-row">
        <button id="refreshBtn" class="ghost">Refresh Snapshot</button>
        <button id="backToMenuBtn" class="ghost">Back To Menu</button>
        <button id="settingsBtn" class="ghost">Settings</button>
      </div>
    </aside>

    <section class="snapshot-panel debug-only">
      <h3>Snapshot JSON</h3>
      <textarea id="snapshot" readonly></textarea>
    </section>
  </section>

  <footer class="shortcuts-bar" id="shortcutBar">
    <div><kbd>R</kbd> ready <kbd>T</kbd> tower <kbd>W</kbd> wall mode <kbd>U</kbd> upgrade <kbd>P</kbd> pause <kbd>M</kbd> mute <kbd>Arrows</kbd> move cursor</div>
  </footer>

  <div id="settingsRoot"></div>

  <div id="feedbackQueue" class="toasts" role="status" aria-live="polite"></div>

  <div class="match-end-overlay" id="matchEndOverlay">
    <div class="match-end-modal">
      <h2>Match Ended</h2>
      <div id="matchEndSummary" class="small"></div>
      <div id="matchEndScores" class="match-end-grid"></div>
      <div class="stack">
        <button id="rematchBtn" class="primary">Rematch</button>
        <button id="restartBtn">Return To Menu</button>
        <button id="closeOverlayBtn" class="ghost">Close</button>
      </div>
    </div>
  </div>
`;

const settingsStore = createSettingsStore();
const soundEngine = createSoundEngine({ settings: settingsStore });
soundEngine.bindUnlock(document);
const settingsDialog = mountSettingsDialog({ root: must<HTMLElement>("settingsRoot"), settings: settingsStore, engine: soundEngine });

const el = {
  menuScreen: must<HTMLElement>("menuScreen"),
  gameScreen: must<HTMLElement>("gameScreen"),
  menuSeed: must<HTMLInputElement>("menuSeed"),
  menuPlayerCount: must<HTMLSelectElement>("menuPlayerCount"),
  menuAiPlayers: must<HTMLInputElement>("menuAiPlayers"),
  menuPlayerNames: must<HTMLElement>("menuPlayerNames"),
  menuMessage: must<HTMLElement>("menuMessage"),
  menuSettingsBtn: must<HTMLButtonElement>("menuSettingsBtn"),
  settingsBtn: must<HTMLButtonElement>("settingsBtn"),
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
  placeTowerBtn: must<HTMLButtonElement>("placeTowerBtn"),
  upgradeBtn: must<HTMLButtonElement>("upgradeBtn"),
  wallCost: must<HTMLElement>("wallCost"),
  upgradeCost: must<HTMLElement>("upgradeCost"),
  waveBanner: must<HTMLElement>("waveBanner"),
  turnBanner: must<HTMLElement>("turnBanner"),
  demoBtn: must<HTMLButtonElement>("demoBtn"),
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

// Debug-only synthetic combat: feeds creatures and events to the board without touching the host simulation.
const demo = createDemo({
  current: () => current,
  feed: (snapshot, events) => applySnapshot(snapshot, events),
  tickMs: () => msPerTick(),
  onFinished: () => {
    el.demoBtn.textContent = "Demo Combat";
  }
});

function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured.replace(/\/$/, "");
  }
  return "";
}

// GitHub Pages has no backend, so that build hosts the game API in the page itself.
const inBrowserServer = import.meta.env.VITE_IN_BROWSER_SERVER === "true";

async function sendRequest(method: "GET" | "POST", path: string, payload?: unknown): Promise<{ ok: boolean; text: string }> {
  if (inBrowserServer) {
    const { localRequest } = await import("./local-host.js");
    return localRequest(method, path, payload);
  }

  const response = await fetch(`${apiBase()}${path}`, method === "POST"
    ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    : undefined);
  return { ok: response.ok, text: await response.text() };
}

async function getJson<T>(path: string): Promise<T> {
  const { ok, text } = await sendRequest("GET", path);
  perfRecordBytes(text.length);
  const data = JSON.parse(text) as T & ApiErrorPayload;
  if (!ok) {
    throw new Error(data.message ?? data.error ?? "request-failed");
  }
  return data;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const { ok, text } = await sendRequest("POST", path, payload);
  perfRecordBytes(text.length);
  const data = JSON.parse(text) as T & ApiErrorPayload;
  if (!ok) {
    throw new Error(data.message ?? data.error ?? "request-failed");
  }
  return data;
}

function showMenuScreen(): void {
  el.menuScreen.classList.remove("hidden");
  el.gameScreen.classList.add("hidden");
  stopPlayback();
  hideGuideOverlay();
  // Responses already in flight (playback ticks) must not pop the game screen back open over the menu.
  appliedSeq = ++requestSeq;
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

const REJECT_REASON_TEXT: Record<string, string> = {
  "insufficient-points": "not enough points",
  "cell-not-buildable": "that tile is not buildable",
  "tower-overlap": "a tower is already there",
  "wall-overlap": "a wall is already there",
  "path-blocked": "that would block the path",
  "spawn-protected": "too close to the monster cave",
  "wall-phase-not-active": "walls can only be placed during combat",
  "upgrade-phase-not-active": "upgrades can only be bought during prep, before you ready",
  "player-already-ready-for-wave": "you are already ready",
  "placement-phase-not-active": "towers can only be placed during placement",
  "tower-already-placed": "you already placed your tower",
  "tower-not-placed": "place your tower first",
  "out-of-bounds": "outside the map"
};

const COMMAND_LABEL: Partial<Record<SimulationCommand["type"], string>> = {
  "place-wall": "Wall",
  "place-tower": "Tower",
  "upgrade-tower": "Upgrade",
  "set-target-mode": "Target mode",
  "ready-for-wave": "Ready"
};

// Toasts replace the old persistent feedback log: short-lived, stacked, and announced via aria-live.
function addFeedback(
  type: FeedbackType,
  message: string,
  commandType?: SimulationCommand["type"],
  reason?: string
): void {
  let text = message;
  if (commandType && type === "rejected") {
    text = `${COMMAND_LABEL[commandType] ?? commandType} rejected: ${REJECT_REASON_TEXT[reason ?? ""] ?? reason ?? "unknown reason"}`;
  } else if (commandType && type === "accepted") {
    text = `${COMMAND_LABEL[commandType] ?? commandType} done`;
  } else if (reason) {
    text = `${message}: ${reason}`;
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = text;
  el.feedbackQueue.append(toast);
  while (el.feedbackQueue.children.length > TOAST_CAPACITY) {
    el.feedbackQueue.firstElementChild?.remove();
  }
  setTimeout(() => toast.remove(), TOAST_LIFETIME_MS);
}

function renderMenuPlayerInputs(): void {
  const count = Number(el.menuPlayerCount.value);
  menuPlayers = Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    inputId: `menuPlayerName${index + 1}`,
    defaultName: `Player ${index + 1}`
  }));

  el.menuPlayerNames.innerHTML = menuPlayers.map((player, index) => (
    `<div class="menu-player">` +
    `<span class="swatch ${player.id}" aria-hidden="true">${index + 1}</span>` +
    `<label class="sr-only" for="${player.inputId}">${player.id.toUpperCase()} Name</label>` +
    `<input id="${player.inputId}" value="${player.defaultName}" />` +
    `</div>`
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
        title: `${activePlayer.name}, it's your turn: claim the opening tower`,
        body: "Click a buildable tile on the battlefield to place your tower there.",
        actionLabel: "Place Tower Now",
        action: "place-tower"
      };
    }

    if (!activePlayer.readyForWave) {
      // The sim accepts ready as soon as this player has a tower, so the turn card must not wait for the others.
      return {
        key: `ready-${activePlayer.id}-${snapshot.wave}`,
        tone: "ready",
        title: `${activePlayer.name}, it's your turn: lock in your setup`,
        body: "Confirm readiness once your tower is where you want it. The wave starts when every player is ready.",
        actionLabel: "Ready For Wave",
        action: "ready-player"
      };
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
      body: "The battle runs on its own. Use Place Wall and target modes to hold the lane, or pause to think. Upgrades are bought in prep, before you ready.",
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
    map: {
      width: wire.map.width,
      height: wire.map.height,
      seed: wire.map.seed,
      cells: mapCache.cells,
      ...(wire.map.spawn ? { spawn: wire.map.spawn } : {})
    },
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

  // A fresh load or reconnect delivers the whole event history; replaying that as toasts or effects would be noise.
  const fxEvents = previous !== null && newEvents.length <= MAX_FX_EVENT_BACKLOG ? newEvents : [];
  announceRepairEvents(snapshot, fxEvents);
  soundEngine.playCues(
    cuesForSnapshotChange({ previous, next: snapshot, events: fxEvents, suppress: previous === null || newEvents.length > MAX_FX_EVENT_BACKLOG }),
    glideMs
  );
  showGameScreen();
  updatePlayerOptions(current);
  syncCursorToBuildableCell(current);
  updateBattlefield(current, glideMs, fxEvents);
  announceWaveEnd(fxEvents);
  resetTurnAfterWave(previous, snapshot);
  renderToolbar(current);
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
  return playing && !demo.running() && !document.hidden && current?.phase === "wave" && !el.gameScreen.classList.contains("hidden");
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
    // Otherwise a single failure after a failure-triggered pause would pause again immediately.
    playbackErrors = 0;
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

function updateBattlefield(snapshot: MatchSnapshot | null, transitionMs = 0, events: MatchEvent[] = []): void {
  battlefieldMount.renderMap(snapshot, transitionMs, events);
  battlefieldMount.setCursor(coordValue(el.x), coordValue(el.y));
  syncPlacementContext(snapshot);

  if (!snapshot) {
    el.battlefieldMeta.textContent = "Click a buildable tile to place your tower.";
    return;
  }

  const creatureLabel = snapshot.creatures.length === 1 ? "creature" : "creatures";
  const wallHint = wallMode ? " • Wall mode: click a buildable tile (Esc to leave)" : "";
  el.battlefieldMeta.textContent = `Wave ${snapshot.wave} • Tick ${snapshot.waveTick} • ${snapshot.creatures.length} ${creatureLabel} active${wallHint}`;
}

function syncPlacementContext(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    return;
  }
  const playerId = el.playerId.value;
  battlefieldMount.setPlacementContext({
    phase: snapshot.phase,
    playerId,
    hasTowerAlready: snapshot.towers.some((tower) => tower.playerId === playerId),
    wallMode
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

function showWaveBanner(title: string, sub: string): void {
  const strong = el.waveBanner.querySelector("strong");
  const span = el.waveBanner.querySelector("span");
  if (strong) strong.textContent = title;
  if (span) span.textContent = sub;
  el.waveBanner.classList.remove("show");
  void el.waveBanner.offsetWidth;
  el.waveBanner.classList.add("show");
  if (bannerTimer !== null) {
    clearTimeout(bannerTimer);
  }
  bannerTimer = setTimeout(() => el.waveBanner.classList.remove("show"), BANNER_LIFETIME_MS);
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
  if (turnBannerTimer !== null) {
    clearTimeout(turnBannerTimer);
  }
  turnBannerTimer = setTimeout(() => el.turnBanner.classList.remove("show"), TURN_BANNER_LIFETIME_MS);
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
function renderToolbar(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    return;
  }
  const playerId = el.playerId.value;
  const player = snapshot.players.find((entry) => entry.id === playerId);
  const tower = snapshot.towers.find((entry) => entry.playerId === playerId);
  const points = player?.points ?? 0;
  const wallCost = getWallCost(snapshot.walls.length);
  const upgradeCost = tower ? getTowerUpgradeCost(tower.level) : null;
  el.wallCost.textContent = `${wallCost}`;
  el.wallCost.classList.toggle("short", points < wallCost);
  el.upgradeCost.textContent = upgradeCost === null ? "-" : `${upgradeCost}`;
  el.upgradeCost.classList.toggle("short", upgradeCost !== null && points < upgradeCost);
  // Upgrades are prep-only and locked once this player readies (matches the simulation rule).
  el.upgradeBtn.classList.toggle("dim", !tower || Boolean(player?.eliminated) || snapshot.phase !== "placement" || Boolean(player?.readyForWave));
  el.placeTowerBtn.classList.toggle("dim", Boolean(tower) || snapshot.phase !== "placement");
  if (tower) {
    el.mode.value = tower.targetMode;
  }
}

function buildPlayerChip(player: MatchSnapshot["players"][number], towerId: string | null): PlayerChipRefs {
  const root = document.createElement("div");
  root.className = "player-chip";
  // Mouse users can click anywhere on the chip; keyboard and assistive tech use the real button around the name.
  // The chip itself is not a button so the nested health progressbar keeps its accessibility semantics.
  root.addEventListener("click", () => setActivePlayer(player.id));
  const swatch = document.createElement("div");
  swatch.className = "chip-swatch";
  swatch.textContent = String(playerNumber(player.id));
  swatch.setAttribute("aria-hidden", "true");
  const body = document.createElement("div");
  body.className = "chip-body";
  const top = document.createElement("div");
  top.className = "chip-top";
  const name = document.createElement("button");
  name.type = "button";
  name.className = "player-chip-name";
  const state = document.createElement("span");
  state.className = "chip-state";
  top.append(name, state);
  const scoreRow = document.createElement("div");
  scoreRow.className = "chip-score";
  const points = document.createElement("span");
  points.className = "chip-points";
  const goal = document.createElement("div");
  goal.className = "goal-bar";
  goal.title = `Goal: ${WIN_SCORE} points`;
  const goalFill = document.createElement("i");
  goal.append(goalFill);
  scoreRow.append(points, goal);
  const meta = document.createElement("div");
  meta.className = "player-chip-meta";
  body.append(top, scoreRow, meta);
  root.append(swatch, body);
  let bar: HTMLElement | null = null;
  let barFill: HTMLElement | null = null;
  if (towerId) {
    bar = document.createElement("div");
    bar.className = "tower-hp-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${player.name} tower health`);
    bar.setAttribute("aria-valuemin", "0");
    barFill = document.createElement("i");
    bar.append(barFill);
    body.append(bar);
  }
  return { root, name, state, points, goalFill, meta, bar, barFill };
}

function playerNumber(playerId: string): number {
  return Number(playerId.replace(/\D+/g, "")) || 1;
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
    } else if (snapshot.phase === "wave") {
      status = "fighting";
      label = "FIGHTING";
    } else if (!player.hasPlacedTower) {
      label = "PLACING";
    } else if (player.readyForWave) {
      status = "ready";
      label = "READY";
    }

    const isActive = player.id === el.playerId.value;
    const className = `player-chip ${status} ${towerColorClass(player.id)}${isActive ? " active" : ""}`;
    if (isActive) {
      refs.name.setAttribute("aria-current", "true");
    } else {
      refs.name.removeAttribute("aria-current");
    }
    refs.root.title = `Switch to ${player.name} (${playerNumber(player.id)})`;
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
    if (refs.state.textContent !== label) {
      refs.state.textContent = label;
    }
    const pointsText = `${player.points} pts`;
    if (refs.points.textContent !== pointsText) {
      refs.points.textContent = pointsText;
    }
    refs.goalFill.style.width = `${Math.min(100, (player.points / WIN_SCORE) * 100)}%`;
    if (refs.meta.textContent !== towerStatus) {
      refs.meta.textContent = towerStatus;
    }

    if (tower && refs.bar && refs.barFill) {
      const ratio = tower.maxHealth > 0 ? tower.health / tower.maxHealth : 0;
      refs.bar.setAttribute("aria-valuemax", String(tower.maxHealth));
      refs.bar.setAttribute("aria-valuenow", String(tower.health));
      refs.barFill.style.width = `${ratio * 100}%`;
      refs.bar.dataset.level = ratio > 0.6 ? "high" : ratio > 0.3 ? "mid" : "low";
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

    return "All towers are set. Buy upgrades now, then lock in readiness to start the first wave.";
  }

  if (snapshot.phase === "wave") {
    return "Combat is live. Use walls and target modes to hold the lane.";
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
  const isFree = (x: number, y: number): boolean => !occupied.has(`${x},${y}`) && !isInSpawnProtection(snapshot.map, x, y);
  if (currentCell?.buildable && isFree(currentX, currentY)) {
    return { x: currentX, y: currentY };
  }

  const cell = mapCache.buildable.find((entry) => isFree(entry.x, entry.y));
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
      } else if (command.type === "upgrade-tower") {
        addFeedback("accepted", "Tower upgraded");
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

function applyActivePlayerChange(): void {
  guideDismissedKey = null;
  hideGuideOverlay();
  syncCursorToBuildableCell(current);
  updateBattlefield(current);
  syncGuideOverlay(current);
  renderToolbar(current);
  renderPlayerCards(current);
}

// Hot-seat play: once a player is ready, hand the screen to the next player who still has to act.
function passTurnAfterReady(readyPlayerId: string): void {
  if (!current || current.phase !== "placement" || selectedPlayerId() !== readyPlayerId) {
    return;
  }
  const nextId = nextPendingPlayerId(current.players, readyPlayerId);
  if (!nextId || nextId === readyPlayerId) {
    return;
  }
  setActivePlayer(nextId);
  const next = current.players.find((player) => player.id === nextId);
  if (next) {
    showTurnBanner(next);
  }
}

function setActivePlayer(playerId: string): void {
  if (!current || playerId === el.playerId.value || !current.players.some((player) => player.id === playerId)) {
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

el.placeTowerBtn.addEventListener("click", () => {
  placeTowerForSelectedPlayer();
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
  if (settingsDialog.isOpen()) {
    if (event.key === "Escape") {
      event.preventDefault();
      settingsDialog.close();
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
  const inMatch = current && !el.gameScreen.classList.contains("hidden") && el.overlay.style.display !== "flex";
  if (inMatch && current && !event.ctrlKey && !event.metaKey && !event.altKey && /^[1-8]$/.test(event.key)) {
    const target = current.players.find((player) => playerNumber(player.id) === Number(event.key));
    if (target) {
      event.preventDefault();
      setActivePlayer(target.id);
    }
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
paintHero(must<HTMLCanvasElement>("menuHero"));
renderPhase(null);
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
  const map = current.map;
  const open = new Set(mapCache.buildable.map((cell) => `${cell.x},${cell.y}`));
  // Maze corridors are the creatures' only route, so placements there are usually rejected.
  // Isolated pads (no walkable neighbour) are always legal spots for tests to click.
  const isPad = (cell: { x: number; y: number }): boolean =>
    [`${cell.x + 1},${cell.y}`, `${cell.x - 1},${cell.y}`, `${cell.x},${cell.y + 1}`, `${cell.x},${cell.y - 1}`].every(
      (key) => !open.has(key)
    );
  return mapCache.buildable
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
    return { playing, speed: playbackSpeed };
  },
  ...(DEBUG ? { demo } : {})
};
