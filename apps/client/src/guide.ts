import type { MatchSnapshot } from "@tower-defense/shared";
import { el } from "./dom";
import { store } from "./state";

export type GuideAction = "focus-place" | "place-tower" | "ready-player" | "toggle-playback";

export interface GuideState {
  key: string;
  tone: "place" | "ready" | "start" | "hint";
  title: string;
  body: string;
  actionLabel: string;
  action: GuideAction;
}

// The guide is an inline coach mark above the board with reserved height, so it never overlaps or shifts the battlefield.
export function hideGuideOverlay(): void {
  el.guideOverlay.classList.add("guide-idle");
  store.lastGuideKey = "";
}

export function showGuideOverlay(state: GuideState): void {
  el.guideCard.className = `guide-card ${state.tone}`;
  el.guideTitle.textContent = state.title;
  el.guideBody.textContent = state.body;
  el.guideActionBtn.textContent = state.actionLabel;
  el.guideActionBtn.dataset.action = state.action;
  el.guideOverlay.classList.remove("guide-idle");
}

export function activePlayerFromSnapshot(snapshot: MatchSnapshot): MatchSnapshot["players"][number] | null {
  const selected = el.playerId.value;
  const selectedPlayer = snapshot.players.find((player) => player.id === selected);
  if (selectedPlayer) {
    return selectedPlayer;
  }

  return snapshot.players[0] ?? null;
}

export function computeGuideState(snapshot: MatchSnapshot | null): GuideState | null {
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
      body: "The battle runs on its own. Use target modes to hold the lane, or pause to think. Upgrades (range, damage, accuracy) are bought in prep, before you ready.",
      actionLabel: store.playing ? "Pause" : "Resume",
      action: "toggle-playback"
    };
  }

  return null;
}

export function syncGuideOverlay(snapshot: MatchSnapshot | null): void {
  const state = computeGuideState(snapshot);
  if (!state) {
    hideGuideOverlay();
    return;
  }

  if (store.guideDismissedKey === state.key) {
    hideGuideOverlay();
    store.guideDismissedKey = state.key;
    return;
  }

  if (state.key === store.lastGuideKey && !el.guideOverlay.classList.contains("guide-idle")) {
    return;
  }

  store.lastGuideKey = state.key;
  showGuideOverlay(state);
}
