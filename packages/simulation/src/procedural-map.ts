import {
  BUILDABLE_CELL_THRESHOLD,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  type GameMap,
  type MapCell,
} from "@tower-defense/shared";

function hashCoordinates(seed: number, x: number, y: number): number {
  let value = seed ^ (x * 374761393) ^ (y * 668265263);
  value = (value ^ (value >>> 13)) * 1274126177;
  value ^= value >>> 16;
  return value >>> 0;
}

// Corridors sit on a coarse grid every MAZE_PITCH cells, leaving walls MAZE_PITCH - 1 cells thick between them.
// Thick walls leave room for tower pads that stay out of the creatures' way.
const MAZE_PITCH = 4;
// Share of the walls between neighbouring corridors that are knocked through, so the maze has a few loops.
const MAZE_LOOP_CHANCE = 0.08;

// Carves a maze (seeded randomized depth-first search) and returns the corridor cells.
// Hash inputs with negative coordinates keep the maze independent of the noise layer.
// Creatures enter on the left edge and leave on the right edge, at the pair of rooms furthest apart, so the route is long.
function carveLane(
  seed: number,
  width: number,
  height: number,
): { lane: Set<string>; startY: number } {
  const columns = Math.floor((width - 1) / MAZE_PITCH) + 1;
  const rows = Math.floor((height - 1) / MAZE_PITCH) + 1;
  const lane = new Set<string>();
  const neighbours = new Map<string, string[]>();

  const link = (ax: number, ay: number, bx: number, by: number): void => {
    for (
      let x = Math.min(ax, bx) * MAZE_PITCH;
      x <= Math.max(ax, bx) * MAZE_PITCH;
      x += 1
    ) {
      for (
        let y = Math.min(ay, by) * MAZE_PITCH;
        y <= Math.max(ay, by) * MAZE_PITCH;
        y += 1
      ) {
        lane.add(`${x},${y}`);
      }
    }
    const from = `${ax},${ay}`;
    const to = `${bx},${by}`;
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  };

  const visited = new Set<string>(["0,0"]);
  const stack = [{ x: 0, y: 0 }];
  let step = 0;
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    if (!current) {
      break;
    }
    step += 1;
    const options = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ].filter(
      (next) =>
        next.x >= 0 &&
        next.x < columns &&
        next.y >= 0 &&
        next.y < rows &&
        !visited.has(`${next.x},${next.y}`),
    );
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const next =
      options[
        hashCoordinates(seed, -2 - step, current.x * rows + current.y) %
          options.length
      ];
    if (!next) {
      continue;
    }
    link(current.x, current.y, next.x, next.y);
    visited.add(`${next.x},${next.y}`);
    stack.push(next);
  }

  for (let x = 0; x < columns; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      for (const next of [
        { x: x + 1, y },
        { x, y: y + 1 },
      ]) {
        const loop =
          hashCoordinates(seed, -100 - x * rows - y, next.x - x) / 0xffffffff <
          MAZE_LOOP_CHANCE;
        if (next.x < columns && next.y < rows && loop) {
          link(x, y, next.x, next.y);
        }
      }
    }
  }

  let startRow = 0;
  let exitRow = 0;
  let longest = -1;
  for (let row = 0; row < rows; row += 1) {
    const distance = new Map<string, number>([[`0,${row}`, 0]]);
    const queue = [`0,${row}`];
    for (let index = 0; index < queue.length; index += 1) {
      const key = queue[index] ?? "";
      for (const next of neighbours.get(key) ?? []) {
        if (!distance.has(next)) {
          distance.set(next, (distance.get(key) ?? 0) + 1);
          queue.push(next);
        }
      }
    }
    for (let y = 0; y < rows; y += 1) {
      const steps = distance.get(`${columns - 1},${y}`) ?? -1;
      if (steps > longest) {
        longest = steps;
        startRow = row;
        exitRow = y;
      }
    }
  }
  // The last corridor column may stop short of the right edge when the width is not a multiple of the pitch.
  for (let x = (columns - 1) * MAZE_PITCH; x < width; x += 1) {
    lane.add(`${x},${exitRow * MAZE_PITCH}`);
  }

  return { lane, startY: startRow * MAZE_PITCH };
}

export function generateMap(
  seed: number,
  width: number = DEFAULT_MAP_WIDTH,
  height: number = DEFAULT_MAP_HEIGHT,
): GameMap {
  const cells: MapCell[] = [];
  const { lane, startY } = carveLane(seed, width, height);

  // Noise cells next to the maze would open shortcuts through its walls, so they only appear away from the lane.
  const touchesLane = (x: number, y: number): boolean =>
    [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`].some(
      (key) => lane.has(key),
    );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const hash = hashCoordinates(seed, x, y);
      const normalized = hash / 0xffffffff;
      const buildable =
        lane.has(`${x},${y}`) ||
        (normalized < BUILDABLE_CELL_THRESHOLD && !touchesLane(x, y));
      cells.push({ x, y, buildable, pathWear: 0 });
    }
  }

  return {
    width,
    height,
    seed,
    cells,
    spawn: { x: 0, y: startY },
  };
}
