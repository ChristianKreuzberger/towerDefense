import { isInSpawnProtection } from "@tower-defense/shared";
import { battlefieldMount, firstFreeTowerSpot, occupiedCellKeys } from "./board";
import { coordValue } from "./coord";
import { el, must } from "./dom";
import { addFeedback } from "./feedback";
import type { GuideAction } from "./guide";
import { resolvePlacementCell } from "./placement";
import { setPlaying } from "./playback";
import { playerTowerId, selectedPlayerId } from "./player-util";
import { fetchSnapshot, sendCommand } from "./session";
import { store } from "./state";

// User intents that become host commands: tile clicks, the tower placement shortcut and guide buttons.

export function handleCellSelected(x: number, y: number): void {
  if (!store.current) {
    return;
  }
  store.cursorChosen = true;

  el.x.value = String(x);
  el.y.value = String(y);
  battlefieldMount.setCursor(x, y);

  const cell = store.mapCache?.byKey.get(`${x},${y}`);
  if (!cell) {
    return;
  }
  // Only tower spots take towers; the road and plain grass explain themselves instead of failing silently.
  if (!store.mapCache?.towerSpotKeys.has(`${x},${y}`)) {
    if (store.moveMode || (store.current.phase === "placement" && !store.current.towers.some((tower) => tower.playerId === selectedPlayerId()))) {
      addFeedback("rejected", "", store.moveMode ? "move-tower" : "place-tower", "not-tower-spot");
    }
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

  const alreadyHasTower = store.current.towers.some((tower) => tower.playerId === playerId);
  if (store.current.phase === "placement" && !alreadyHasTower) {
    void sendCommand({ type: "place-tower", playerId, x, y });
  }
}

export function placeTowerForSelectedPlayer(): void {
  const playerId = selectedPlayerId();
  const snapshot = store.current;
  const coords = snapshot
    ? resolvePlacementCell({
        cursor: { x: coordValue(el.x), y: coordValue(el.y) },
        cursorChosen: store.cursorChosen,
        isFreeSpot: (cell) =>
          Boolean(store.mapCache?.towerSpotKeys.has(`${cell.x},${cell.y}`))
          && !occupiedCellKeys(snapshot).has(`${cell.x},${cell.y}`)
          && !isInSpawnProtection(snapshot.map, cell.x, cell.y),
        firstFree: () => firstFreeTowerSpot(snapshot)
      })
    : null;
  if (!coords) {
    addFeedback("info", "Click a free tower spot first, then place your tower");
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

export function runGuideAction(action: GuideAction): void {
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
