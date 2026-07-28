export interface MapCell {
  x: number;
  y: number;
  buildable: boolean;
  pathWear: number;
}

export interface GameMap {
  width: number;
  height: number;
  seed: number;
  cells: MapCell[];
}

export function getMapCell(map: GameMap, x: number, y: number): MapCell | undefined {
  return map.cells.find((cell) => cell.x === x && cell.y === y);
}
