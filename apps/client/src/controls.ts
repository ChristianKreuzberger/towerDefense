import { UPGRADE_TRACKS } from "@tower-defense/shared";
import type { TowerTargetMode } from "@tower-defense/shared";
import { handleCellSelected, placeTowerForSelectedPlayer, runGuideAction } from "./actions";
import type { SoundId } from "./audio/index";
import { setCellClickHandler, setMoveMode, setWallMode } from "./board";
import { DAMAGE_TYPE_OPTIONS, PLAYBACK_SPEEDS, TARGET_MODES } from "./constants";
import { demo } from "./demo-instance";
import { app, el, must } from "./dom";
import { closeOverlay } from "./end-overlay";
import { REJECT_REASON_TEXT, addFeedback } from "./feedback";
import { hideGuideOverlay } from "./guide";
import type { GuideAction } from "./guide";
import { renderMenuPlayerInputs, showGameScreen, showMenuScreen } from "./menu";
import { configurePlayback, setPlaybackSpeed, setPlaying } from "./playback";
import { playerTowerId, selectedPlayerId } from "./player-util";
import { setChipSelectHandler } from "./scoreboard";
import { settingsDialog, soundEngine } from "./services";
import { advanceMany, advanceTicks, fetchSnapshot, rematchWithSamePlayers, sendCommand, startMatchFromMenu } from "./session";
import { store } from "./state";
import { applyActivePlayerChange, setActivePlayer } from "./turns";

// Connects the static markup to the game logic and plugs the upward callbacks (tile clicks, chip clicks,
// playback ticks) into the lower modules. Called once at startup; the elements live as long as the page.
export function installControls(): void {
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
}
