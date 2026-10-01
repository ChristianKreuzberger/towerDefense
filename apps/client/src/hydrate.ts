import type { MapCell, MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { WireSnapshot } from "./api";
import { EVENT_LOG_CAPACITY, RETAINED_EVENT_TYPES } from "./constants";
import { store } from "./state";
import type { MapCache } from "./state";

// Turns wire snapshots (possibly lite) into full snapshots, keeping the map cache and retained event log.

export function mapKeyOf(map: { seed: number; width: number; height: number }): string {
  return `${map.seed}:${map.width}x${map.height}`;
}

export function resetMatchCaches(): void {
  store.eventLog = [];
  store.eventCursor = 0;
}

export function buildMapCache(key: string, cells: MapCell[]): MapCache {
  const byKey = new Map<string, MapCell>();
  const buildable: MapCell[] = [];
  const worn: MapCell[] = [];
  for (const cell of cells) {
    byKey.set(`${cell.x},${cell.y}`, cell);
    if (cell.buildable) {
      buildable.push(cell);
    }
    if (cell.pathWear > 0) {
      worn.push(cell);
    }
  }
  return { key, cells, byKey, buildable, worn };
}

// Turns a wire snapshot (possibly lite) into a full MatchSnapshot. Returns null when a lite snapshot
// arrives for a map whose cells we do not have, so the caller can fall back to a full fetch.
export function hydrateSnapshot(wire: WireSnapshot): { snapshot: MatchSnapshot; newEvents: MatchEvent[] } | null {
  const key = mapKeyOf(wire.map);
  let cache: MapCache;
  if (wire.map.cells) {
    cache = buildMapCache(key, wire.map.cells);
    store.mapCache = cache;
  } else if (!store.mapCache || store.mapCache.key !== key) {
    return null;
  } else {
    cache = store.mapCache;
    // The cached cell objects are mutated in place so the scene and lookups always see current wear.
    for (const cell of cache.worn) {
      cell.pathWear = 0;
    }
    cache.worn = [];
    for (const entry of wire.map.wornCells ?? []) {
      const cell = cache.byKey.get(`${entry.x},${entry.y}`);
      if (cell) {
        cell.pathWear = entry.pathWear;
        cache.worn.push(cell);
      }
    }
  }

  const offset = wire.eventsOffset ?? 0;
  const tail = wire.events;
  const total = wire.eventsTotal ?? offset + tail.length;
  let newEvents: MatchEvent[];
  if (total < store.eventCursor) {
    // The host restarted its match behind our back; drop history rather than replaying it.
    store.eventLog = [];
    newEvents = [];
  } else {
    newEvents = tail.slice(Math.max(0, store.eventCursor - offset));
  }
  store.eventCursor = total;
  const retained = newEvents.filter((event) => RETAINED_EVENT_TYPES.has(event.type));
  if (retained.length > 0) {
    store.eventLog = [...store.eventLog, ...retained].slice(-EVENT_LOG_CAPACITY);
  }

  const snapshot: MatchSnapshot = {
    ...wire,
    map: {
      schemaVersion: wire.map.schemaVersion,
      width: wire.map.width,
      height: wire.map.height,
      seed: wire.map.seed,
      cells: cache.cells,
      ...(wire.map.spawn ? { spawn: wire.map.spawn } : {}),
      ...(wire.map.goal ? { goal: wire.map.goal } : {})
    },
    events: store.eventLog
  };
  return { snapshot, newEvents };
}
