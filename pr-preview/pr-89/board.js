import { isInSpawnProtection } from "@tower-defense/shared";
import { createBattlefieldMount } from "./battlefield-scene";
import { DEBUG } from "./constants";
import { clampCoord, coordValue } from "./coord";
import { el } from "./dom";
import { store } from "./state";
// Battlefield (Phaser) wiring: map rendering, placement cursor, move mode.
// Tile clicks are routed to a handler that is plugged in at startup, so the board never imports the command code.
let cellClickHandler = () => { };
export function setCellClickHandler(handler) {
    cellClickHandler = handler;
}
let viewChangeHandler = () => { };
export function setViewChangeHandler(handler) {
    viewChangeHandler = handler;
}
function mountBattlefield() {
    return createBattlefieldMount(el.board, {
        onCellClick: (x, y) => cellClickHandler(x, y),
        onViewChange: () => viewChangeHandler()
    });
}
let mount = mountBattlefield();
// Callers keep this stable object while the Phaser game behind it is replaced for every new match.
export const battlefieldMount = {
    renderMap: (snapshot, transitionMs, events) => mount.renderMap(snapshot, transitionMs, events),
    creaturePositions: () => mount.creaturePositions(),
    cellToCss: (x, y) => mount.cellToCss(x, y),
    cellSize: () => mount.cellSize(),
    setCursor: (x, y) => mount.setCursor(x, y),
    setPlacementContext: (context) => mount.setPlacementContext(context),
    zoomStep: (direction) => mount.zoomStep(direction),
    resetView: () => mount.resetView(),
    zoom: () => mount.zoom(),
    destroy: () => mount.destroy()
};
// A new match or rematch starts on a fresh Phaser game, so no scene state, listener or canvas outlives the match.
export function rebuildBattlefield() {
    // Build the new game first: if Phaser fails to start, the old mount stays the (working) current one.
    const next = mountBattlefield();
    const previous = mount;
    mount = next;
    previous.destroy();
}
export function updateBattlefield(snapshot, transitionMs = 0, events = []) {
    battlefieldMount.renderMap(snapshot, transitionMs, events);
    battlefieldMount.setCursor(coordValue(el.x), coordValue(el.y));
    syncPlacementContext(snapshot);
    if (!snapshot) {
        el.battlefieldMeta.textContent = "Click a marked tower spot to place your tower.";
        return;
    }
    const creatureLabel = snapshot.creatures.length === 1 ? "creature" : "creatures";
    const toSpawn = snapshot.phase === "wave" ? ` • ${snapshot.creaturesToSpawn} still to spawn` : "";
    el.battlefieldMeta.textContent = `Wave ${snapshot.wave} • Tick ${snapshot.waveTick} • ${snapshot.creatures.length} ${creatureLabel} active${toSpawn}`;
}
export function syncPlacementContext(snapshot) {
    if (!snapshot) {
        return;
    }
    const playerId = el.playerId.value;
    battlefieldMount.setPlacementContext({
        phase: snapshot.phase,
        playerId,
        hasTowerAlready: snapshot.towers.some((tower) => tower.playerId === playerId),
        moveMode: store.moveMode
    });
}
export function renderSnapshot(snapshot) {
    if (!DEBUG) {
        return;
    }
    // The static cell list is elided; it is 2500 entries of noise in a debugging view.
    const view = snapshot ? { ...snapshot, map: { ...snapshot.map, cells: `[${snapshot.map.cells.length} cells]` } } : null;
    el.snapshot.value = JSON.stringify(view, null, 2);
}
export function occupiedCellKeys(snapshot) {
    const occupied = new Set();
    for (const tower of snapshot.towers) {
        occupied.add(`${tower.x},${tower.y}`);
    }
    return occupied;
}
export function firstFreeTowerSpot(snapshot) {
    if (!snapshot || !store.mapCache) {
        return null;
    }
    const occupied = occupiedCellKeys(snapshot);
    const currentX = coordValue(el.x);
    const currentY = coordValue(el.y);
    const currentCell = store.mapCache.byKey.get(`${currentX},${currentY}`);
    const isFree = (x, y) => !occupied.has(`${x},${y}`) && !isInSpawnProtection(snapshot.map, x, y);
    if (currentCell && store.mapCache.towerSpotKeys.has(`${currentX},${currentY}`) && isFree(currentX, currentY)) {
        return { x: currentX, y: currentY };
    }
    const cell = store.mapCache.towerSpots.find((entry) => isFree(entry.x, entry.y));
    return cell ? { x: cell.x, y: cell.y } : null;
}
export function syncCursorToTowerSpot(snapshot) {
    const nextCell = firstFreeTowerSpot(snapshot);
    if (!nextCell) {
        return;
    }
    el.x.value = String(nextCell.x);
    el.y.value = String(nextCell.y);
}
export function adjustCoord(dx, dy) {
    store.cursorChosen = true;
    const width = store.current?.map?.width ?? 64;
    const height = store.current?.map?.height ?? 64;
    const nextX = clampCoord(coordValue(el.x) + dx, width);
    const nextY = clampCoord(coordValue(el.y) + dy, height);
    el.x.value = String(nextX);
    el.y.value = String(nextY);
    if (store.current) {
        battlefieldMount.setCursor(coordValue(el.x), coordValue(el.y));
    }
}
export function setMoveMode(next) {
    store.moveMode = next;
    el.moveTowerBtn.setAttribute("aria-pressed", String(next));
    el.moveTowerBtn.classList.toggle("active", next);
    if (store.current) {
        syncPlacementContext(store.current);
        updateBattlefield(store.current);
    }
}
