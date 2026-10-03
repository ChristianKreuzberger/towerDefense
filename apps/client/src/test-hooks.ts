import { isInSpawnProtection } from "@tower-defense/shared";
import { battlefieldMount, occupiedCellKeys } from "./board";
import { DEBUG } from "./constants";
import { demo } from "./demo-instance";
import { store } from "./state";

interface TestBoardHook {
  findBuildableCell(index?: number): { x: number; y: number } | null;
  cellSize(): number;
  demo?: { start(): boolean; stop(): void; running(): boolean };
  cellToPixel(x: number, y: number): { x: number; y: number };
  creaturePositions(): Array<{ id: string; x: number; y: number }>;
  playback(): { playing: boolean; speed: number };
}

declare global {
  interface Window {
    __testBoard?: TestBoardHook;
  }
}

// Read-only test hook so Playwright can locate buildable cells without DOM grid elements.
function findBuildableCellsInOrder(): Array<{ x: number; y: number }> {
  if (!store.current || !store.mapCache) {
    return [];
  }

  const occupied = occupiedCellKeys(store.current);
  const map = store.current.map;
  const open = new Set(store.mapCache.buildable.map((cell) => `${cell.x},${cell.y}`));
  // Maze corridors are the creatures' only route, so placements there are usually rejected.
  // Isolated pads (no walkable neighbour) are always legal spots for tests to click.
  const isPad = (cell: { x: number; y: number }): boolean =>
    [`${cell.x + 1},${cell.y}`, `${cell.x - 1},${cell.y}`, `${cell.x},${cell.y + 1}`, `${cell.x},${cell.y - 1}`].every(
      (key) => !open.has(key)
    );
  return store.mapCache.buildable
    .filter((cell) => !occupied.has(`${cell.x},${cell.y}`) && !isInSpawnProtection(map, cell.x, cell.y) && isPad(cell))
    .map((cell) => ({ x: cell.x, y: cell.y }));
}

export function installTestHooks(): void {
  window.__testBoard = {
    findBuildableCell(index = 0): { x: number; y: number } | null {
      return findBuildableCellsInOrder()[index] ?? null;
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
    ...(DEBUG ? { demo } : {})
  };
}
