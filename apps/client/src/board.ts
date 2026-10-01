import { isInSpawnProtection } from "@tower-defense/shared";
import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import { createBattlefieldMount } from "./battlefield-scene";
import type { BattlefieldMount } from "./battlefield-scene";
import { DEBUG } from "./constants";
import { clampCoord, coordValue } from "./coord";
import { el } from "./dom";
import { store } from "./state";

// Battlefield (Phaser) wiring: map rendering, placement cursor, wall and move modes.

// Tile clicks are routed to a handler that is plugged in at startup, so the board never imports the command code.
let cellClickHandler: (x: number, y: number) => void = () => {};

export function setCellClickHandler(handler: (x: number, y: number) => void): void {
  cellClickHandler = handler;
}

function mountBattlefield(): BattlefieldMount {
  return createBattlefieldMount(el.board, {
    onCellClick: (x, y) => cellClickHandler(x, y)
  });
}

let mount = mountBattlefield();

// Callers keep this stable object while the Phaser game behind it is replaced for every new match.
export const battlefieldMount: BattlefieldMount = {
  renderMap: (snapshot, transitionMs, events) => mount.renderMap(snapshot, transitionMs, events),
  creaturePositions: () => mount.creaturePositions(),
  cellToCss: (x, y) => mount.cellToCss(x, y),
  cellSize: () => mount.cellSize(),
  setCursor: (x, y) => mount.setCursor(x, y),
  setPlacementContext: (context) => mount.setPlacementContext(context),
  destroy: () => mount.destroy()
};

// A new match or rematch starts on a fresh Phaser game, so no scene state, listener or canvas outlives the match.
export function rebuildBattlefield(): void {
  mount.destroy();
  mount = mountBattlefield();
}

export function updateBattlefield(snapshot: MatchSnapshot | null, transitionMs = 0, events: MatchEvent[] = []): void {
  battlefieldMount.renderMap(snapshot, transitionMs, events);
  battlefieldMount.setCursor(coordValue(el.x), coordValue(el.y));
  syncPlacementContext(snapshot);

  if (!snapshot) {
    el.battlefieldMeta.textContent = "Click a buildable tile to place your tower.";
    return;
  }

  const creatureLabel = snapshot.creatures.length === 1 ? "creature" : "creatures";
  const wallHint = store.wallMode ? " • Wall mode: click a buildable tile (Esc to leave)" : "";
  const toSpawn = snapshot.phase === "wave" ? ` • ${snapshot.creaturesToSpawn} still to spawn` : "";
  el.battlefieldMeta.textContent = `Wave ${snapshot.wave} • Tick ${snapshot.waveTick} • ${snapshot.creatures.length} ${creatureLabel} active${toSpawn}${wallHint}`;
}

export function syncPlacementContext(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    return;
  }
  const playerId = el.playerId.value;
  battlefieldMount.setPlacementContext({
    phase: snapshot.phase,
    playerId,
    hasTowerAlready: snapshot.towers.some((tower) => tower.playerId === playerId),
    wallMode: store.wallMode,
    moveMode: store.moveMode
  });
}

export function renderSnapshot(snapshot: MatchSnapshot | null): void {
  if (!DEBUG) {
    return;
  }
  // The static cell list is elided; it is 2500 entries of noise in a debugging view.
  const view = snapshot ? { ...snapshot, map: { ...snapshot.map, cells: `[${snapshot.map.cells.length} cells]` } } : null;
  el.snapshot.value = JSON.stringify(view, null, 2);
}

export function occupiedCellKeys(snapshot: MatchSnapshot): Set<string> {
  const occupied = new Set<string>();
  for (const tower of snapshot.towers) {
    occupied.add(`${tower.x},${tower.y}`);
  }
  for (const wall of snapshot.walls) {
    occupied.add(`${wall.x},${wall.y}`);
  }
  return occupied;
}

export function firstFreeBuildableCoord(snapshot: MatchSnapshot | null): { x: number; y: number } | null {
  if (!snapshot || !store.mapCache) {
    return null;
  }

  const occupied = occupiedCellKeys(snapshot);
  const currentX = coordValue(el.x);
  const currentY = coordValue(el.y);
  const currentCell = store.mapCache.byKey.get(`${currentX},${currentY}`);
  const isFree = (x: number, y: number): boolean => !occupied.has(`${x},${y}`) && !isInSpawnProtection(snapshot.map, x, y);
  if (currentCell?.buildable && isFree(currentX, currentY)) {
    return { x: currentX, y: currentY };
  }

  const cell = store.mapCache.buildable.find((entry) => isFree(entry.x, entry.y));
  return cell ? { x: cell.x, y: cell.y } : null;
}

export function syncCursorToBuildableCell(snapshot: MatchSnapshot | null): void {
  const nextCell = firstFreeBuildableCoord(snapshot);
  if (!nextCell) {
    return;
  }

  el.x.value = String(nextCell.x);
  el.y.value = String(nextCell.y);
}

export function adjustCoord(dx: number, dy: number): void {
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

export function setMoveMode(next: boolean): void {
  if (next && store.wallMode) {
    setWallMode(false);
  }
  store.moveMode = next;
  el.moveTowerBtn.setAttribute("aria-pressed", String(next));
  el.moveTowerBtn.classList.toggle("active", next);
  if (store.current) {
    syncPlacementContext(store.current);
    updateBattlefield(store.current);
  }
}

export function setWallMode(next: boolean): void {
  if (next && store.moveMode) {
    setMoveMode(false);
  }
  store.wallMode = next;
  el.placeWallBtn.setAttribute("aria-pressed", String(next));
  el.placeWallBtn.classList.toggle("active", next);
  el.battlefieldMeta.classList.toggle("wall-mode", next);
  if (store.current) {
    updateBattlefield(store.current);
  }
}
