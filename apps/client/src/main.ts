import { UPGRADE_TRACKS, isInSpawnProtection } from "@tower-defense/shared";
import type { TowerTargetMode } from "@tower-defense/shared";
import { handleCellSelected, placeTowerForSelectedPlayer, runGuideAction } from "./actions";
import { paintHero } from "./art/hero";
import { applyPaletteCssVars } from "./art/palette";
import type { SoundId } from "./audio/index";
import { battlefieldMount, occupiedCellKeys, setCellClickHandler, setMoveMode, setWallMode } from "./board";
import { DAMAGE_TYPE_OPTIONS, DEBUG, PLAYBACK_SPEEDS, TARGET_MODES } from "./constants";
import { demo } from "./demo-instance";
import { app, el, must } from "./dom";
import { closeOverlay } from "./end-overlay";
import { REJECT_REASON_TEXT, addFeedback, setMenuMessage, setStatus } from "./feedback";
import { hideGuideOverlay } from "./guide";
import type { GuideAction } from "./guide";
import { installHotkeys } from "./hotkeys";
import { renderMenuPlayerInputs, showGameScreen, showMenuScreen } from "./menu";
import { renderPhase } from "./phase";
import { configurePlayback, setPlaybackSpeed, setPlaying } from "./playback";
import { playerTowerId, selectedPlayerId } from "./player-util";
import { setChipSelectHandler } from "./scoreboard";
import { settingsDialog, soundEngine } from "./services";
import { advanceMany, advanceTicks, fetchSnapshot, rematchWithSamePlayers, sendCommand, startMatchFromMenu } from "./session";
import { store } from "./state";
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

installHotkeys();

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
