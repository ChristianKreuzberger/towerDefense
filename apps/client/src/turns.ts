import type { MatchSnapshot } from "@tower-defense/shared";
import { setMoveMode, syncCursorToBuildableCell, updateBattlefield } from "./board";
import { el } from "./dom";
import { hideGuideOverlay, syncGuideOverlay } from "./guide";
import { showTurnBanner } from "./phase";
import { selectedPlayerId } from "./player-util";
import { renderPlayerCards } from "./scoreboard";
import { store } from "./state";
import { renderToolbar } from "./toolbar";
import { firstPendingPlayerId, nextPendingPlayerId } from "./turn";

// Hot-seat turn handling: who is the active player and when the screen is handed to the next one.

// Every wave hands the table back to the first seat. Detected from the phase change between two snapshots, so a
// fresh load (no previous snapshot) or replayed events can never trigger it, and each transition fires once.
export function resetTurnAfterWave(previous: MatchSnapshot | null, snapshot: MatchSnapshot): void {
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

export function applyActivePlayerChange(): void {
  // Move mode belongs to the player who pressed it; the next hot-seat player starts clean.
  if (store.moveMode) {
    setMoveMode(false);
  }
  store.guideDismissedKey = null;
  hideGuideOverlay();
  syncCursorToBuildableCell(store.current);
  updateBattlefield(store.current);
  syncGuideOverlay(store.current);
  renderToolbar(store.current);
  renderPlayerCards(store.current);
}

// Hot-seat play: once a player is ready, hand the screen to the next player who still has to act.
export function passTurnAfterReady(readyPlayerId: string): void {
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

export function setActivePlayer(playerId: string): void {
  if (!store.current || playerId === el.playerId.value || !store.current.players.some((player) => player.id === playerId)) {
    return;
  }
  el.playerId.value = playerId;
  applyActivePlayerChange();
}
