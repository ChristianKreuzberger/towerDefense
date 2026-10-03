import { isInSpawnProtection } from "@tower-defense/shared";
import { battlefieldMount, occupiedCellKeys } from "./board";
import { DEBUG } from "./constants";
import { demo } from "./demo-instance";
import { store } from "./state";
// Read-only test hook so Playwright can locate free tower spots without DOM grid elements.
function findTowerSpotsInOrder() {
    if (!store.current || !store.mapCache) {
        return [];
    }
    const occupied = occupiedCellKeys(store.current);
    const map = store.current.map;
    return store.mapCache.towerSpots
        .filter((cell) => !occupied.has(`${cell.x},${cell.y}`) && !isInSpawnProtection(map, cell.x, cell.y))
        .map((cell) => ({ x: cell.x, y: cell.y }));
}
export function installTestHooks() {
    window.__testBoard = {
        findTowerSpot(index = 0) {
            return findTowerSpotsInOrder()[index] ?? null;
        },
        cellSize() {
            return battlefieldMount.cellSize();
        },
        // CSS pixels relative to the canvas element, so it stays right when CSS scales the canvas.
        cellToPixel(x, y) {
            return battlefieldMount.cellToCss(x, y);
        },
        creaturePositions() {
            return battlefieldMount.creaturePositions();
        },
        playback() {
            return { playing: store.playing, speed: store.playbackSpeed };
        },
        ...(DEBUG ? { demo } : {})
    };
}
