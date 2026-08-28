import type { CreatureArchetype, MatchSetup, MatchSnapshot, SimulationCommand, TowerTargetMode } from "@tower-defense/shared";

import "./style.css";

const TARGET_MODES: TowerTargetMode[] = ["first", "last", "strongest", "nearest"];
const CREATURE_GLYPH: Record<CreatureArchetype, string> = {
  runner: "R",
  swarm: "S",
  armored: "A",
  tank: "T"
};
const PLAYER_COLORS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] as const;

type ApiErrorPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
};

type ApiStartPayload = {
  ok: boolean;
  snapshot?: MatchSnapshot;
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
  snapshot?: MatchSnapshot;
  error?: string;
  message?: string;
};

type ApiAdvanceManyPayload = {
  ok: boolean;
  acceptedTicks?: number;
  stoppedReason?: string;
  snapshot?: MatchSnapshot;
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

type GuideAction = "focus-place" | "place-tower" | "ready-player" | "advance-wave";

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
const POLL_INTERVAL_MS = 450;
const MAX_POLLING_ERRORS = 3;

let current: MatchSnapshot | null = null;
let feedbackItems: FeedbackItem[] = [];
let feedbackIdCounter = 1;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollingActive = false;
let pollingInFlight = false;
let pollingErrorCount = 0;
let menuPlayers: MenuPlayerInput[] = [];
let guideDismissedKey: string | null = null;
let lastGuideKey = "";
let lastGuideUpdateAt = 0;
let processedEventCount = 0;

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
          <div class="small" id="battlefieldMeta">Use arrows to move cursor.</div>
        </div>
        <div id="board" class="board-grid"></div>
      </section>

      <aside class="control-panel card">
        <div class="panel-heading">
          <h3>Commander Panel</h3>
          <div class="panel-subtitle">Set your tower, then make the first wave count.</div>
        </div>
        <div class="command-help">Use the cursor to pick a buildable tile, then press T to place your tower or R to lock in readiness.</div>
        <label>Active Player</label>
        <select id="playerId"></select>

        <div class="grid2">
          <div>
            <label>X</label>
            <input id="x" type="number" value="0" />
          </div>
          <div>
            <label>Y</label>
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
          <button id="placeTowerBtn">Place Tower</button>
          <button id="readyBtn" class="good">Ready For Wave</button>
          <button id="placeWallBtn">Place Wall</button>
          <button id="upgradeBtn">Upgrade Tower</button>
          <button id="modeBtn">Apply Target Mode</button>
          <button id="advanceBtn" class="primary">Advance Wave Tick</button>
          <button id="autoBtn">Advance 30 Ticks</button>
          <button id="refreshBtn">Refresh Snapshot</button>
          <button id="backToMenuBtn">Back To Menu</button>
        </div>

        <h3>Last Action</h3>
        <div id="status" class="status">No match yet.</div>

        <h3>Action Feedback</h3>
        <div id="feedbackQueue" class="feedback-queue">No feedback yet.</div>
      </aside>
    </div>

    <section class="snapshot-panel card">
      <h3>Snapshot JSON</h3>
      <textarea id="snapshot" readonly></textarea>
    </section>
  </section>

  <footer class="shortcuts-bar" id="shortcutBar">
    <div><kbd>R</kbd> ready <kbd>T</kbd> tower <kbd>W</kbd> wall <kbd>U</kbd> upgrade <kbd>A</kbd> tick</div>
    <div><kbd>Arrows</kbd> move X/Y</div>
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

  <div id="guideOverlay" class="guide-overlay hidden" aria-live="polite">
    <div id="guideCard" class="guide-card hint">
      <button id="guideCloseBtn" class="guide-close" aria-label="Dismiss guidance">x</button>
      <div id="guideTitle" class="guide-title"></div>
      <div id="guideBody" class="guide-body"></div>
      <button id="guideActionBtn" class="guide-action"></button>
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

function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured.replace(/\/$/, "");
  }
  return "";
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`);
  const data = (await response.json()) as T & ApiErrorPayload;
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

  const data = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new Error(data.message ?? data.error ?? "request-failed");
  }
  return data;
}

function showMenuScreen(): void {
  el.menuScreen.classList.remove("hidden");
  el.gameScreen.classList.add("hidden");
  stopWavePolling();
  processedEventCount = 0;
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

function hideGuideOverlay(): void {
  el.guideOverlay.classList.add("hidden");
}

function showGuideOverlay(state: GuideState): void {
  el.guideCard.className = `guide-card ${state.tone}`;
  el.guideTitle.textContent = state.title;
  el.guideBody.textContent = state.body;
  el.guideActionBtn.textContent = state.actionLabel;
  el.guideActionBtn.dataset.action = state.action;
  el.guideOverlay.classList.remove("hidden");
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
        body: "Move the cursor with the arrow keys, then place your tower on a buildable tile that keeps the lane open.",
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
        body: "The setup is complete. Advance the first wave tick to launch the battle.",
        actionLabel: "Start Game",
        action: "advance-wave"
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
      body: "The battle is live. Add walls, upgrade towers, and fine-tune targets while the creatures advance.",
      actionLabel: "Advance Tick",
      action: "advance-wave"
    };
  }

  return null;
}

function syncGuideOverlay(snapshot: MatchSnapshot | null): void {
  const now = Date.now();
  if (now - lastGuideUpdateAt < 250) {
    return;
  }
  lastGuideUpdateAt = now;

  const state = computeGuideState(snapshot);
  if (!state) {
    hideGuideOverlay();
    return;
  }

  if (guideDismissedKey === state.key) {
    return;
  }

  if (state.key === lastGuideKey && !el.guideOverlay.classList.contains("hidden")) {
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
    must<HTMLButtonElement>("placeTowerBtn").click();
    return;
  }

  if (action === "ready-player") {
    must<HTMLButtonElement>("readyBtn").click();
    return;
  }

  must<HTMLButtonElement>("advanceBtn").click();
}

function applySnapshot(snapshot: MatchSnapshot): void {
  if (snapshot.events.length < processedEventCount) {
    processedEventCount = 0;
  }

  const newEvents = snapshot.events.slice(processedEventCount);
  processedEventCount = snapshot.events.length;
  current = snapshot;
  announceRepairEvents(snapshot, newEvents);
  showGameScreen();
  updatePlayerOptions(current);
  syncCursorToBuildableCell(current);
  renderBoard(current);
  renderPlayerCards(current);
  pulseRepairedTowers(newEvents);
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
    }
  }
}

function pulseRepairedTowers(events: MatchSnapshot["events"]): void {
  for (const event of events) {
    if (event.type !== "tower-repaired") {
      continue;
    }

    const towerBar = document.querySelector(`[data-tower-id="${event.towerId}"] .tower-hp-bar`);
    towerBar?.classList.add("repair-pulse");
  }
}

function scheduleNextPoll(): void {
  if (!pollingActive || pollTimer !== null) {
    return;
  }

  pollTimer = setTimeout(() => {
    pollTimer = null;
    void runPollCycle();
  }, POLL_INTERVAL_MS);
}

function startWavePolling(): void {
  if (pollingActive) {
    return;
  }

  pollingActive = true;
  pollingErrorCount = 0;
  scheduleNextPoll();
}

function stopWavePolling(): void {
  pollingActive = false;
  pollingErrorCount = 0;
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

async function runPollCycle(): Promise<void> {
  if (!pollingActive || pollingInFlight) {
    return;
  }

  pollingInFlight = true;
  try {
    const snapshot = await fetchSnapshot({ silentStatus: true });
    if (snapshot) {
      pollingErrorCount = 0;
    } else {
      pollingErrorCount += 1;
    }

    if (pollingErrorCount >= MAX_POLLING_ERRORS) {
      stopWavePolling();
      setStatus("Polling paused after repeated snapshot failures. Use Refresh Snapshot to retry.");
      addFeedback("error", "Polling paused after repeated snapshot failures");
      return;
    }
  } finally {
    pollingInFlight = false;
  }

  scheduleNextPoll();
}

function pickDefaultPlayer(snapshot: MatchSnapshot | null): string {
  if (!snapshot || snapshot.players.length === 0) {
    return "";
  }
  return snapshot.players[0]?.id ?? "";
}

function updatePlayerOptions(snapshot: MatchSnapshot | null): void {
  const previous = el.playerId.value;
  el.playerId.innerHTML = "";
  const players = snapshot?.players ?? [];
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

function cellClassFromSnapshot(snapshot: MatchSnapshot, x: number, y: number): string[] {
  const cell = snapshot.map.cells.find((entry) => entry.x === x && entry.y === y);
  const classes = ["grid-cell"];

  if (!cell) {
    classes.push("blocked");
    return classes;
  }

  if (cell.buildable) {
    classes.push("buildable");
  } else {
    classes.push("path");
  }

  if (cell.pathWear > 0) {
    classes.push("worn");
  }

  if (Number(el.x.value) === x && Number(el.y.value) === y) {
    classes.push("cursor");
  }

  return classes;
}

function towerColorClass(playerId: string): string {
  const index = Number(playerId.replace(/\D+/g, "")) - 1;
  return PLAYER_COLORS[Math.max(0, Math.min(PLAYER_COLORS.length - 1, index))] ?? "p1";
}

function renderBoard(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    el.board.innerHTML = "<div class=\"board-empty\">No active match</div>";
    return;
  }

  const width = snapshot.map.width;
  const height = snapshot.map.height;

  const wallsByCell = new Map<string, string>();
  const towersByCell = new Map<string, { playerId: string; level: number }>();
  const creaturesByCell = new Map<string, CreatureArchetype[]>();

  for (const wall of snapshot.walls) {
    wallsByCell.set(`${wall.x},${wall.y}`, wall.playerId);
  }

  for (const tower of snapshot.towers) {
    towersByCell.set(`${tower.x},${tower.y}`, {
      playerId: tower.playerId,
      level: tower.level
    });
  }

  for (const creature of snapshot.creatures) {
    const key = `${creature.x},${creature.y}`;
    const list = creaturesByCell.get(key) ?? [];
    list.push(creature.archetype);
    creaturesByCell.set(key, list);
  }

  const cells: string[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = `${x},${y}`;
      const classes = cellClassFromSnapshot(snapshot, x, y).join(" ");
      const tower = towersByCell.get(key);
      const wall = wallsByCell.get(key);
      const creatures = creaturesByCell.get(key) ?? [];

      const markers: string[] = [];

      if (wall) {
        markers.push(`<span class="marker wall-marker ${towerColorClass(wall)}">W</span>`);
      }

      if (tower) {
        markers.push(
          `<span class="marker tower-marker ${towerColorClass(tower.playerId)} level-${Math.min(3, tower.level)}">T${tower.level}</span>`
        );
      }

      if (creatures.length > 0) {
        const archetype = creatures[0] ?? "runner";
        const extra = creatures.length > 1 ? `<span class="stack-count">+${creatures.length - 1}</span>` : "";
        markers.push(`<span class="marker creature-marker">${CREATURE_GLYPH[archetype]}${extra}</span>`);
      }

      cells.push(`<div class="${classes}" data-x="${x}" data-y="${y}">${markers.join("")}</div>`);
    }
  }

  el.board.innerHTML = `<div class="game-grid" style="--grid-width:${width};">${cells.join("")}</div>`;
  const creatureLabel = snapshot.creatures.length === 1 ? "creature" : "creatures";
  el.battlefieldMeta.textContent = `Wave ${snapshot.wave} • Tick ${snapshot.waveTick} • ${snapshot.creatures.length} ${creatureLabel} active`;
}

function renderSnapshot(snapshot: MatchSnapshot | null): void {
  el.snapshot.value = JSON.stringify(snapshot, null, 2);
}

function renderPlayerCards(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    el.playerCards.textContent = "No active match";
    return;
  }

  const cards: string[] = [];
  for (const player of snapshot.players) {
    const colorClass = towerColorClass(player.id);
    const tower = snapshot.towers.find((entry) => entry.playerId === player.id);
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

    cards.push(
      `<div class="player-chip ${status} ${colorClass}"${tower ? ` data-tower-id="${tower.id}"` : ""}>` +
      `<div class="player-chip-name">${player.name}</div>` +
      `<div class="player-chip-meta">${player.points} pts | ${towerStatus} | ${label}</div>` +
      (tower
        ? `<div class="tower-hp-bar" role="progressbar" aria-label="${player.name} tower health" aria-valuemin="0" aria-valuemax="${tower.maxHealth}" aria-valuenow="${tower.health}" style="width: ${(tower.health / tower.maxHealth) * 100}%"></div>`
        : "") +
      "</div>"
    );
  }
  el.playerCards.innerHTML = cards.join("");
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
    stopWavePolling();
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
    startWavePolling();
  } else {
    stopWavePolling();
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
  try {
    const data = await getJson<{ ok: true; snapshot: MatchSnapshot }>("/api/snapshot");
    applySnapshot(data.snapshot);
    setMenuMessage("Reconnected to running match.");
    guideDismissedKey = null;
    return current;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch snapshot";
    if (!options?.silentStatus) {
      setStatus(message);
    }
    return null;
  }
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
    applySnapshot(data.snapshot);
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
    applySnapshot(data.snapshot);
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

function firstFreeBuildableCoord(snapshot: MatchSnapshot | null): { x: number; y: number } | null {
  if (!snapshot) {
    return null;
  }

  const occupied = new Set<string>();
  for (const tower of snapshot.towers) {
    occupied.add(`${tower.x},${tower.y}`);
  }
  for (const wall of snapshot.walls) {
    occupied.add(`${wall.x},${wall.y}`);
  }

  const currentX = Number(el.x.value);
  const currentY = Number(el.y.value);
  const currentCellIsFree = Number.isFinite(currentX) && Number.isFinite(currentY)
    && snapshot.map.cells.some((cell) => cell.x === currentX && cell.y === currentY && cell.buildable && !occupied.has(`${cell.x},${cell.y}`));

  if (currentCellIsFree) {
    return { x: currentX, y: currentY };
  }

  const cell = snapshot.map.cells.find((entry) => entry.buildable && !occupied.has(`${entry.x},${entry.y}`));
  if (!cell) {
    return null;
  }

  return { x: cell.x, y: cell.y };
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
    renderBoard(current);
  }
}

function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

async function sendCommand(command: SimulationCommand): Promise<void> {
  try {
    const data = await postJson<ApiCommandPayload>("/api/command", { command });
    const result = data.result;
    if (!result?.accepted) {
      setStatus(`rejected: ${result?.reason ?? "unknown"}`);
      addFeedback("rejected", "Command rejected", command.type, result?.reason);
    } else {
      setStatus("accepted");
      addFeedback("accepted", "Command accepted", command.type);
    }

    if (data.snapshot) {
      applySnapshot(data.snapshot);
    } else {
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
  renderBoard(current);
  syncGuideOverlay(current);
});

must<HTMLButtonElement>("closeOverlayBtn").addEventListener("click", closeOverlay);
el.rematchBtn.addEventListener("click", () => {
  void rematchWithSamePlayers();
});

must<HTMLButtonElement>("placeTowerBtn").addEventListener("click", () => {
  const playerId = selectedPlayerId();
  const coords = currentCommandCoords(current);
  void sendCommand({
    type: "place-tower",
    playerId,
    x: coords.x,
    y: coords.y
  });
});

must<HTMLButtonElement>("readyBtn").addEventListener("click", () => {
  void sendCommand({ type: "ready-for-wave", playerId: selectedPlayerId() });
});

must<HTMLButtonElement>("placeWallBtn").addEventListener("click", () => {
  void sendCommand({
    type: "place-wall",
    playerId: selectedPlayerId(),
    x: coordValue(el.x),
    y: coordValue(el.y)
  });
});

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
    const data = await postJson<ApiAdvanceManyPayload>("/api/advance-many", { ticks: 30 });
    setStatus(`advance-many: attempted=30 accepted=${data.acceptedTicks ?? 0} stopped=${data.stoppedReason ?? "none"}`);
    addFeedback("info", `Advance-many accepted ${data.acceptedTicks ?? 0} ticks`, "advance-wave", data.stoppedReason);

    if (data.snapshot) {
      applySnapshot(data.snapshot);
    } else {
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
    must<HTMLButtonElement>("placeTowerBtn").click();
    return;
  }

  if (key === "w") {
    event.preventDefault();
    must<HTMLButtonElement>("placeWallBtn").click();
    return;
  }

  if (key === "u") {
    event.preventDefault();
    must<HTMLButtonElement>("upgradeBtn").click();
    return;
  }

  if (key === "a") {
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

renderMenuPlayerInputs();
renderPhase(null);
renderFeedbackQueue();
showMenuScreen();
setStatus("No match yet.");
setMenuMessage("Create a local match or reconnect to an existing one.");
hideGuideOverlay();
void fetchSnapshot({ silentStatus: true });
