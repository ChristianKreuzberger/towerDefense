import { isInSpawnProtection } from "@tower-defense/shared";
import { battlefieldMount, firstFreeTowerSpot, occupiedCellKeys } from "./board";
import { coordValue } from "./coord";
import { el, must } from "./dom";
import { addFeedback } from "./feedback";
import type { GuideAction } from "./guide";
import { isTouchConfirm, resolvePlacementCell, snapToSpot } from "./placement";
import { setPlaying } from "./playback";
import { playerTowerId, selectedPlayerId } from "./player-util";
import { fetchSnapshot, sendCommand } from "./session";
import { closeTowerMenu, openTowerMenu } from "./tower-menu";
import { renderToolbar } from "./toolbar";
import { setActivePlayer } from "./turns";
import { store } from "./state";

// User intents that become host commands: tile clicks, the tower placement shortcut and guide buttons.

// Touch placement is select, then confirm (spec/11). Compact layout or a coarse pointer means a finger.
const touchQuery = "(max-width: 1040px), (pointer: coarse)";
let selectedSpot: { x: number; y: number } | null = null;

function isTouchMode(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(touchQuery).matches;
}

function setSelectedSpot(spot: { x: number; y: number } | null): void {
  selectedSpot = spot;
  battlefieldMount.previewCell(spot?.x ?? null, spot?.y ?? null);
  const label = el.placeTowerBtn.querySelector(".tool-label");
  if (label) {
    label.textContent = spot ? "Place here" : "Place Tower";
  }
}

export function handleCellSelected(tappedX: number, tappedY: number): void {
  let x = tappedX;
  let y = tappedY;
  if (!store.current) {
    return;
  }

  // Tapping a tower opens its upgrade popover instead of touching the placement cursor. Move mode keeps priority:
  // there an occupied tile is simply not a valid target (handled below).
  const tappedTower = store.moveMode ? undefined : store.current.towers.find((tower) => tower.x === x && tower.y === y);
  if (tappedTower) {
    // Hot-seat: the owner becomes the active player so the popover and the toolbar show and spend their points.
    setActivePlayer(tappedTower.playerId);
    openTowerMenu(tappedTower, store.current.phase);
    renderToolbar(store.current);
    return;
  }
  closeTowerMenu();

  const placing = store.moveMode || (store.current.phase === "placement" && !store.current.towers.some((tower) => tower.playerId === selectedPlayerId()));
  const touch = placing && isTouchMode();
  if (touch && store.mapCache) {
    const current = store.current;
    const occupied = occupiedCellKeys(current);
    const snapped = snapToSpot(
      { x, y },
      store.mapCache.towerSpots,
      (cell) => store.mapCache?.towerSpotKeys.has(`${cell.x},${cell.y}`) === true && !occupied.has(`${cell.x},${cell.y}`)
    );
    if (snapped) {
      x = snapped.x;
      y = snapped.y;
    }
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

  if (touch && !isTouchConfirm(selectedSpot, { x, y })) {
    setSelectedSpot({ x, y });
    return;
  }
  setSelectedSpot(null);

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
  setSelectedSpot(null);
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
