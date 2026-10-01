import {
  BUILDABLE_CELL_THRESHOLD,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  type GameMap,
  type MapCell
} from "@tower-defense/shared";

function hashCoordinates(seed: number, x: number, y: number): number {
  let value = seed ^ (x * 374761393) ^ (y * 668265263);
  value = (value ^ (value >>> 13)) * 1274126177;
  value ^= value >>> 16;
  return value >>> 0;
}

// Carves a 4-connected left-to-right route so creatures always have somewhere to walk.
// Out-of-map hash inputs (y = -1 for the start row, y = -2 for the drift) keep the lane independent of the noise layer.
function carveLane(seed: number, width: number, height: number): { lane: Set<string>; startY: number } {
  const lane = new Set<string>();
  let y = hashCoordinates(seed, -1, -1) % height;
  const startY = y;
  for (let x = 0; x < width; x += 1) {
    lane.add(`${x},${y}`);
    const drift = (hashCoordinates(seed, x, -2) % 3) - 1;
    const nextY = Math.max(0, Math.min(height - 1, y + drift));
    if (nextY !== y) {
      lane.add(`${x},${nextY}`);
      y = nextY;
    }
  }
  return { lane, startY };
}

export function generateMap(
  seed: number,
  width: number = DEFAULT_MAP_WIDTH,
  height: number = DEFAULT_MAP_HEIGHT
): GameMap {
  const cells: MapCell[] = [];
  const { lane, startY } = carveLane(seed, width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const hash = hashCoordinates(seed, x, y);
      const normalized = hash / 0xffffffff;
      cells.push({ x, y, buildable: lane.has(`${x},${y}`) || normalized < BUILDABLE_CELL_THRESHOLD, pathWear: 0 });
    }
  }

  return {
    width,
    height,
    seed,
    cells,
    spawn: { x: 0, y: startY }
  };
}
