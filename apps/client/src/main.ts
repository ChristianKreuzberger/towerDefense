import { UPGRADE_TRACKS, isInSpawnProtection } from "@tower-defense/shared";
import type { TowerTargetMode } from "@tower-defense/shared";
import { handleCellSelected, placeTowerForSelectedPlayer, runGuideAction } from "./actions";
import { paintHero } from "./art/hero";
import { applyPaletteCssVars } from "./art/palette";
import type { SoundId } from "./audio/index";
import { adjustCoord, battlefieldMount, occupiedCellKeys, setCellClickHandler, setMoveMode, setWallMode } from "./board";
import { DAMAGE_TYPE_OPTIONS, DEBUG, PLAYBACK_SPEEDS, TARGET_MODES } from "./constants";
import { demo } from "./demo-instance";
import { app, el, must } from "./dom";
import { closeOverlay, isEndOverlayOpen } from "./end-overlay";
import { REJECT_REASON_TEXT, addFeedback, setMenuMessage, setStatus } from "./feedback";
import { hideGuideOverlay } from "./guide";
import type { GuideAction } from "./guide";
import { renderMenuPlayerInputs, showGameScreen, showMenuScreen } from "./menu";
import { renderPhase } from "./phase";
import { configurePlayback, setPlaybackSpeed, setPlaying } from "./playback";
import { playerNumber, playerTowerId, selectedPlayerId } from "./player-util";
import { setChipSelectHandler } from "./scoreboard";
import { mapPreview, settingsDialog, settingsStore, soundEngine } from "./services";
import { advanceMany, advanceTicks, fetchSnapshot, rematchWithSamePlayers, sendCommand, startMatchFromMenu } from "./session";
import { store } from "./state";
import { isActionAvailable } from "./toolbar";
import { applyActivePlayerChange, setActivePlayer } from "./turns";

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

function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

configurePlayback({ advance: advanceTicks, blocked: () => demo.running() });

setCellClickHandler(handleCellSelected);

setChipSelectHandler(setActivePlayer);

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

must<HTMLButtonElement>("autoBtn").addEventListener("click", () => {
  void advanceMany();
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
