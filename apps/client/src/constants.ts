import { TICKS_PER_SECOND } from "@tower-defense/shared";
import type { DamageType, MatchEvent, TowerTargetMode } from "@tower-defense/shared";

export const TARGET_MODES: TowerTargetMode[] = ["first", "last", "strongest", "nearest"];
export const DAMAGE_TYPE_OPTIONS: DamageType[] = ["physical", "explosive", "magic"];
export const PLAYER_COLORS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"] as const;

export const TOAST_CAPACITY = 5;
export const TOAST_LIFETIME_MS = 4500;
export const BANNER_LIFETIME_MS = 2600;
// Longer than the wave banner: the player has to notice whose turn it is and hand over the screen.
export const TURN_BANNER_LIFETIME_MS = 3500;
// 5 ticks/s at 1x: creatures cover up to 5 cells/s, slow enough to follow and fast enough that a wave is over in seconds.
export const BASE_TICKS_PER_SECOND = TICKS_PER_SECOND;
export const PLAYBACK_SPEEDS = [1, 2, 4] as const;
export const PLAYBACK_CHECK_INTERVAL_MS = 50;
export const MAX_TICKS_PER_REQUEST = 4;
export const MAX_PLAYBACK_ERRORS = 3;
export const MANUAL_TRANSITION_MS = 120;
// Only these events drive presentation; the rest (movement, targeting, telemetry) would bloat the retained log.
export const RETAINED_EVENT_TYPES: ReadonlySet<MatchEvent["type"]> = new Set([
  "tower-repaired",
  "wall-repaired",
  "path-repaired",
  "wave-clear-bonus",
  "catch-up-bonus"
]);
export const EVENT_LOG_CAPACITY = 200;
export const MAX_FX_EVENT_BACKLOG = 300;

export const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";
