import { isInSpawnProtection } from "@tower-defense/shared";
import { battlefieldMount, firstFreeBuildableCoord, occupiedCellKeys } from "./board";
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

export function placeTowerForSelectedPlayer(): void {
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
