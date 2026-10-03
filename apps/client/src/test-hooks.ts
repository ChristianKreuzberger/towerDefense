import { isInSpawnProtection } from "@tower-defense/shared";
import { battlefieldMount, occupiedCellKeys } from "./board";
import { DEBUG } from "./constants";
import { demo } from "./demo-instance";
import { store } from "./state";

interface TestBoardHook {
  findTowerSpot(index?: number): { x: number; y: number } | null;
  cellSize(): number;
  demo?: { start(): boolean; stop(): void; running(): boolean };
  cellToPixel(x: number, y: number): { x: number; y: number };
  creaturePositions(): Array<{ id: string; x: number; y: number }>;
  playback(): { playing: boolean; speed: number };
  zoom(): number;
}

declare global {
  interface Window {
    __testBoard?: TestBoardHook;
  }
}

// Read-only test hook so Playwright can locate free tower spots without DOM grid elements.
function findTowerSpotsInOrder(): Array<{ x: number; y: number }> {
  if (!store.current || !store.mapCache) {
    return [];
  }

  const occupied = occupiedCellKeys(store.current);
  const map = store.current.map;
  return store.mapCache.towerSpots
    .filter((cell) => !occupied.has(`${cell.x},${cell.y}`) && !isInSpawnProtection(map, cell.x, cell.y))
    .map((cell) => ({ x: cell.x, y: cell.y }));
}

export function installTestHooks(): void {
  window.__testBoard = {
    findTowerSpot(index = 0): { x: number; y: number } | null {
      return findTowerSpotsInOrder()[index] ?? null;
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
    zoom(): number {
      return battlefieldMount.zoom();
    },
    ...(DEBUG ? { demo } : {})
  };
}
