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

export function generateMap(
  seed: number,
  width: number = DEFAULT_MAP_WIDTH,
  height: number = DEFAULT_MAP_HEIGHT
): GameMap {
  const cells: MapCell[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const hash = hashCoordinates(seed, x, y);
      const normalized = hash / 0xffffffff;
      cells.push({ x, y, buildable: normalized < BUILDABLE_CELL_THRESHOLD });
    }
  }

  return {
    width,
    height,
    seed,
    cells
  };
}
