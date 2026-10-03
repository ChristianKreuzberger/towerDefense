import { MAX_TOWER_LEVEL, STARTING_POINTS, TOWER_MOVE_AFTER_WAVES, WAVE_CLEAR_BONUS, WIN_SCORE } from "@tower-defense/shared";
import type { StorageLike } from "./settings/settings.js";

// Content and "seen" flag of the how-to-play tour (spec/11, spec/08). No DOM here so it stays unit-testable.

export interface TourStep {
  title: string;
  body: string[];
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    title: "The goal",
    body: [
      `Be the first player to reach ${WIN_SCORE} points. You earn points by killing creatures with your tower.`,
      "If every tower is destroyed before anyone gets there, everybody loses."
    ]
  },
  {
    title: "Prep: place and upgrade",
    body: [
      "Each player places exactly one tower. It can't be sold, and it must stay clear of the monster cave and the creatures' route.",
      `You start with ${STARTING_POINTS} points to spend on upgrades: range (U), damage (I) and accuracy (O), each up to level ${MAX_TOWER_LEVEL}. You can't afford everything, so choose a specialty.`,
      "Pick a target mode and a damage type. The banner shows the next wave and what it is weak against.",
      "Press Ready (R) when you're done. With several players, the turn passes to the next one."
    ]
  },
  {
    title: "Combat",
    body: [
      "Waves play out on their own. Wave N brings N + 2 creatures: runners, swarms, armored and tanks, all walking one lane.",
      "Towers shoot creatures, never each other. Creatures only hurt a tower that is within their short attack range.",
      "You can pause, or run at 2x or 4x speed."
    ]
  },
  {
    title: "Between waves",
    body: [
      "Towers repair themselves automatically after every wave.",
      `Clear a wave without a single leak and every surviving player gets +${WAVE_CLEAR_BONUS} points. Players far behind the leader get a catch-up bonus.`,
      `After round ${TOWER_MOVE_AFTER_WAVES} you get one free tower move (V).`
    ]
  },
  {
    title: "Handy keys",
    body: [
      "1-8 switch player, P plays or pauses, M mutes, Esc closes dialogs.",
      "Hover a tower to see its range and stats. You can reopen this tour any time with the How to play button."
    ]
  }
];

export const TOUR_STORAGE_KEY = "towerDefense.tour.v1";

export function parseTourSeen(raw: string | null): boolean {
  if (raw === null) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && (parsed as Record<string, unknown>).seen === true;
  } catch {
    return false;
  }
}

export interface TourStore {
  hasSeen(): boolean;
  markSeen(): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Accessing localStorage itself throws when site data is blocked.
    return null;
  }
}

export function createTourStore(storage: StorageLike | null = defaultStorage()): TourStore {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(TOUR_STORAGE_KEY) ?? null;
  } catch {
    raw = null;
  }
  let seen = parseTourSeen(raw);
  return {
    hasSeen: () => seen,
    markSeen() {
      seen = true;
      try {
        storage?.setItem(TOUR_STORAGE_KEY, JSON.stringify({ version: 1, seen: true }));
      } catch {
        // The tour may show again next load; nothing else depends on it.
      }
    }
  };
}
