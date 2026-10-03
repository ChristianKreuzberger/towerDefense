import type { GameMap, Tower } from "@tower-defense/shared";

export function toCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

// One shared lane: every live tower is an obstacle, so the route cannot depend on the order of the towers.
export function getOpenPathForCreatures(map: GameMap, towers: Tower[]): Array<{ x: number; y: number }> {
  const blocked = new Set<string>();
  for (const tower of towers) {
    blocked.add(toCellKey(tower.x, tower.y));
  }

  const buildable = new Set<string>();
  for (const cell of map.cells) {
    if (cell.buildable) {
      buildable.add(toCellKey(cell.x, cell.y));
    }
  }

  const queue: Array<{ x: number; y: number }> = [];
  const parent = new Map<string, string | undefined>();
  const starts: string[] = [];

  // Creatures only enter through the monster cave when the map has one.
  const startRows = map.spawn ? [map.spawn.y] : Array.from({ length: map.height }, (_, y) => y);
  for (const y of startRows) {
    const key = toCellKey(0, y);
    if (buildable.has(key) && !blocked.has(key)) {
      starts.push(key);
      queue.push({ x: 0, y });
      parent.set(key, undefined);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) {
      continue;
    }

    if (current.x === map.width - 1) {
      const pathKeys: string[] = [];
      let cursor: string | undefined = toCellKey(current.x, current.y);
      while (cursor) {
        pathKeys.push(cursor);
        cursor = parent.get(cursor);
      }
      pathKeys.reverse();
      return pathKeys.map((key) => {
        const [xText, yText] = key.split(",");
        return {
          x: Number(xText),
          y: Number(yText)
        };
      });
    }

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
      { x: current.x - 1, y: current.y }
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x < 0 || neighbor.x >= map.width || neighbor.y < 0 || neighbor.y >= map.height) {
        continue;
      }

      const key = toCellKey(neighbor.x, neighbor.y);
      if (parent.has(key) || !buildable.has(key) || blocked.has(key)) {
        continue;
      }

      parent.set(key, toCellKey(current.x, current.y));
      queue.push(neighbor);
    }
  }

  for (const key of starts) {
    const [xText, yText] = key.split(",");
    return [{ x: Number(xText), y: Number(yText) }];
  }

  for (const cell of map.cells) {
    const key = toCellKey(cell.x, cell.y);
    if (cell.buildable && !blocked.has(key)) {
      return [{ x: cell.x, y: cell.y }];
    }
  }

  return [];
}
