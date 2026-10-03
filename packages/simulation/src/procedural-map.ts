import {
  BASE_TOWER_RANGE,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  MAP_SCHEMA_VERSION,
  MIN_TOWER_SITES,
  PATH_WIDTH,
  TOWER_SPOT_COUNT,
  TOWER_SPOT_TOTAL,
  TOWER_SPOT_MAX_LANE_DISTANCE,
  TOWER_SPOT_MIN_SPACING,
  isInSpawnProtection,
  type GameMap,
  type MapCell,
} from "@tower-defense/shared";

function hashCoordinates(seed: number, x: number, y: number): number {
  let value = seed ^ (x * 374761393) ^ (y * 668265263);
  value = (value ^ (value >>> 13)) * 1274126177;
  value ^= value >>> 16;
  return value >>> 0;
}

// Corridors sit on a coarse grid every MAZE_PITCH cells and are PATH_WIDTH cells wide, so the walls between them are
// MAZE_PITCH - PATH_WIDTH cells thick. That leaves room for tower spots beside the road without touching it.
const MAZE_PITCH = 6;
// Share of the walls between neighbouring corridors that are knocked through, so the maze has a few loops.
const MAZE_LOOP_CHANCE = 0.08;

// Carves a maze (seeded randomized depth-first search) and returns the corridor cells.
// Hash inputs with negative coordinates keep the maze independent of the noise layer.
// Creatures enter on the left edge and leave on the right edge, at the pair of rooms furthest apart, so the route is long.
function carveLane(
  seed: number,
  width: number,
  height: number,
): { lane: Set<string>; startY: number; exitY: number } {
  // The last room's band must still fit inside the map.
  const columns = Math.floor((width - PATH_WIDTH) / MAZE_PITCH) + 1;
  const rows = Math.floor((height - PATH_WIDTH) / MAZE_PITCH) + 1;
  const lane = new Set<string>();
  const neighbours = new Map<string, string[]>();

  const link = (ax: number, ay: number, bx: number, by: number): void => {
    // The rectangle covers both rooms' PATH_WIDTH-wide bands and the corridor between them.
    for (
      let x = Math.min(ax, bx) * MAZE_PITCH;
      x <= Math.max(ax, bx) * MAZE_PITCH + PATH_WIDTH - 1;
      x += 1
    ) {
      for (
        let y = Math.min(ay, by) * MAZE_PITCH;
        y <= Math.max(ay, by) * MAZE_PITCH + PATH_WIDTH - 1;
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
    for (let y = exitRow * MAZE_PITCH; y < exitRow * MAZE_PITCH + PATH_WIDTH; y += 1) {
      lane.add(`${x},${y}`);
    }
  }

  return { lane, startY: startRow * MAZE_PITCH, exitY: exitRow * MAZE_PITCH };
}

export function generateMap(
  seed: number,
  width: number = DEFAULT_MAP_WIDTH,
  height: number = DEFAULT_MAP_HEIGHT,
): GameMap {
  const cells: MapCell[] = [];
  const { lane, startY, exitY } = carveLane(seed, width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push({ x, y, buildable: lane.has(`${x},${y}`), pathWear: 0 });
    }
  }

  const map: GameMap = {
    schemaVersion: MAP_SCHEMA_VERSION,
    width,
    height,
    seed,
    cells,
    towerSpots: [],
    spawn: { x: 0, y: startY },
    goal: { x: width - 1, y: exitY },
  };
  map.towerSpots = generateTowerSpots(map, seed);
  return map;
}

// Route cells a tower spot must have within the base tower range, so no spot is useless. Measured over 300 default
// seeds (see map-generation.test.ts): the lowest coverage generated is 6, so this is the tightest floor that holds.
export const TOWER_SPOT_MIN_ROUTE_COVERAGE = 6;

type Point = { x: number; y: number };

// The longest creature attack range (armored and tank), in cells.
const CREATURE_REACH = 1.5;

// Picks the tower spots for a map whose road (buildable cells) is already carved. Deterministic per seed.
// Spots are spread along the creatures' route: its cells are cut into one segment per spot, and each segment gets the candidate with the best hash that stays clear of earlier spots.
export function generateTowerSpots(map: GameMap, seed: number): Point[] {
  const road = new Set<string>();
  for (const cell of map.cells) {
    if (cell.buildable) {
      road.add(`${cell.x},${cell.y}`);
    }
  }

  // The route creatures walk (same breadth-first search and neighbour order as the simulation, so the two agree).
  // Spots are spread along it and measured against it; dead-end branches of the road never see a creature.
  const order = new Map<string, number>();
  if (map.spawn && road.has(`${map.spawn.x},${map.spawn.y}`)) {
    const parent = new Map<string, string | undefined>([[`${map.spawn.x},${map.spawn.y}`, undefined]]);
    const queue: Point[] = [map.spawn];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (!current) {
        continue;
      }
      if (current.x === map.width - 1) {
        const route: string[] = [];
        for (let cursor: string | undefined = `${current.x},${current.y}`; cursor; cursor = parent.get(cursor)) {
          route.unshift(cursor);
        }
        route.forEach((key, routeIndex) => order.set(key, routeIndex));
        break;
      }
      for (const next of [
        { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
        { x: current.x - 1, y: current.y },
      ]) {
        const nextKey = `${next.x},${next.y}`;
        if (road.has(nextKey) && !parent.has(nextKey)) {
          parent.set(nextKey, `${current.x},${current.y}`);
          queue.push(next);
        }
      }
    }
  }
  const routeLength = order.size;
  const segmentSize = Math.max(1, Math.ceil(routeLength / TOWER_SPOT_COUNT));

  interface Candidate extends Point {
    hash: number;
    distance: number;
    segment: number;
    coverage: number;
    // Within reach of creatures walking the route (they attack up to 1.5 cells away).
    exposed: boolean;
  }
  const scan = Math.ceil(Math.max(BASE_TOWER_RANGE, TOWER_SPOT_MAX_LANE_DISTANCE));
  const candidates: Candidate[] = [];
  for (const cell of map.cells) {
    const key = `${cell.x},${cell.y}`;
    if (road.has(key) || isInSpawnProtection(map, cell.x, cell.y)) {
      continue;
    }
    // Spots may sit right beside the road: creatures only attack towers within about one cell (spec/06), so a
    // spot that is never within reach would make tower health, repair and ruins irrelevant.
    let distance = Infinity;
    let nearest = Infinity;
    let coverage = 0;
    for (let dy = -scan; dy <= scan; dy += 1) {
      for (let dx = -scan; dx <= scan; dx += 1) {
        const index = order.get(`${cell.x + dx},${cell.y + dy}`);
        if (index === undefined) {
          continue;
        }
        const d = Math.hypot(dx, dy);
        if (d <= BASE_TOWER_RANGE) {
          coverage += 1;
        }
        if (d < distance || (d === distance && index < nearest)) {
          distance = d;
          nearest = index;
        }
      }
    }
    if (nearest === Infinity || coverage < TOWER_SPOT_MIN_ROUTE_COVERAGE) {
      continue;
    }
    candidates.push({
      x: cell.x,
      y: cell.y,
      hash: hashCoordinates(seed, cell.x, cell.y),
      distance,
      segment: Math.floor(nearest / segmentSize),
      coverage,
      exposed: distance <= CREATURE_REACH,
    });
  }
  candidates.sort((a, b) => a.hash - b.hash || a.y - b.y || a.x - b.x);

  const chosen: Candidate[] = [];
  const clear = (c: Point, spacing: number): boolean =>
    chosen.every((spot) => Math.max(Math.abs(spot.x - c.x), Math.abs(spot.y - c.y)) >= spacing);
  const pick = (pool: Candidate[], spacing: number): void => {
    const segments = new Set(pool.map((c) => c.segment));
    for (const segment of [...segments].sort((a, b) => a - b)) {
      // Every other segment prefers a spot creatures can reach, so tower damage and repair stay in play.
      const inSegment = (c: Candidate): boolean => c.segment === segment && clear(c, spacing);
      const best = (segment % 2 === 0 ? pool.find((c) => inSegment(c) && c.exposed) : undefined) ?? pool.find(inSegment);
      if (best) {
        chosen.push(best);
      }
    }
    // Fallback and top-up: global hash order.
    for (const c of pool) {
      if (chosen.length >= TOWER_SPOT_COUNT) {
        return;
      }
      if (clear(c, spacing)) {
        chosen.push(c);
      }
    }
  };

  // Small maps may not fit 8 spots at the usual spacing and distance, so relax spacing first, then the distance cap.
  const attempts: Array<{ spacing: number; maxDistance: number }> = [
    { spacing: TOWER_SPOT_MIN_SPACING, maxDistance: TOWER_SPOT_MAX_LANE_DISTANCE },
    { spacing: TOWER_SPOT_MIN_SPACING - 1, maxDistance: TOWER_SPOT_MAX_LANE_DISTANCE },
    { spacing: 1, maxDistance: TOWER_SPOT_MAX_LANE_DISTANCE },
    { spacing: 1, maxDistance: scan },
  ];
  let usedAttempt = attempts[attempts.length - 1]!;
  for (const [attempt, { spacing, maxDistance }] of attempts.entries()) {
    chosen.length = 0;
    pick(candidates.filter((c) => c.distance <= maxDistance), spacing);
    if (chosen.length >= MIN_TOWER_SITES || attempt === attempts.length - 1) {
      usedAttempt = attempts[attempt]!;
      break;
    }
  }

  const byRow = (a: Point, b: Point): number => a.y - b.y || a.x - b.x;
  const base = chosen.map(({ x, y }) => ({ x, y })).sort(byRow);

  // Second pass: extra spots under the same rules, always in the least-populated route segment that still has a
  // clear candidate. They are listed after the base spots so the base order, and what depends on it, never changes.
  const perSegment = new Map<number, number>();
  for (const spot of chosen) {
    perSegment.set(spot.segment, (perSegment.get(spot.segment) ?? 0) + 1);
  }
  const extraPool = candidates.filter((c) => c.distance <= usedAttempt.maxDistance && !chosen.includes(c));
  const extras: Point[] = [];
  while (base.length + extras.length < TOWER_SPOT_TOTAL) {
    let best: Candidate | undefined;
    for (const c of extraPool) {
      if (chosen.includes(c) || !clear(c, usedAttempt.spacing)) {
        continue;
      }
      const load = perSegment.get(c.segment) ?? 0;
      // The pool is in hash order, so the first candidate wins ties.
      if (!best || load < (perSegment.get(best.segment) ?? 0)) {
        best = c;
      }
    }
    if (!best) {
      break;
    }
    chosen.push(best);
    extras.push({ x: best.x, y: best.y });
    perSegment.set(best.segment, (perSegment.get(best.segment) ?? 0) + 1);
  }

  return [...base, ...extras.sort(byRow)];
}
