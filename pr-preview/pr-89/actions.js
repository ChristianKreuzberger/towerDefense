import { isInSpawnProtection } from "@tower-defense/shared";
import { battlefieldMount, firstFreeTowerSpot, occupiedCellKeys } from "./board";
import { coordValue } from "./coord";
import { el, must } from "./dom";
import { addFeedback } from "./feedback";
import { resolvePlacementCell } from "./placement";
import { setPlaying } from "./playback";
import { playerTowerId, selectedPlayerId } from "./player-util";
import { fetchSnapshot, sendCommand } from "./session";
import { closeTowerMenu, openTowerMenu } from "./tower-menu";
import { renderToolbar } from "./toolbar";
import { setActivePlayer } from "./turns";
import { store } from "./state";
// User intents that become host commands: tile clicks, the tower placement shortcut and guide buttons.
export function handleCellSelected(x, y) {
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
export function placeTowerForSelectedPlayer() {
    const playerId = selectedPlayerId();
    const snapshot = store.current;
    const coords = snapshot
        ? resolvePlacementCell({
            cursor: { x: coordValue(el.x), y: coordValue(el.y) },
            cursorChosen: store.cursorChosen,
            isFreeSpot: (cell) => Boolean(store.mapCache?.towerSpotKeys.has(`${cell.x},${cell.y}`))
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
export function runGuideAction(action) {
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
        must("readyBtn").click();
        return;
    }
    setPlaying(!store.playing);
}
