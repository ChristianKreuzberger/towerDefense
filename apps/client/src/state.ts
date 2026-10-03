import type { MapCell, MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { PLAYBACK_SPEEDS } from "./constants";

export interface MapCache {
  key: string;
  cells: MapCell[];
  byKey: Map<string, MapCell>;
  buildable: MapCell[];
  worn: MapCell[];
}

export interface MenuPlayerInput {
  id: string;
  inputId: string;
  defaultName: string;
}

export interface PlayerChipRefs {
  root: HTMLElement;
  name: HTMLElement;
  state: HTMLElement;
  points: HTMLElement;
  goalFill: HTMLElement;
  meta: HTMLElement;
  bar: HTMLElement | null;
  barFill: HTMLElement | null;
}

// The one place mutable client state lives. Modules import `store` and read or write fields, so there is
// no hidden module-level state to keep in sync.
export const store = {
  current: null as MatchSnapshot | null,
  bannerTimer: null as ReturnType<typeof setTimeout> | null,
  turnBannerTimer: null as ReturnType<typeof setTimeout> | null,
  menuPlayers: [] as MenuPlayerInput[],
  guideDismissedKey: null as string | null,
  lastGuideKey: "",
  mapCache: null as MapCache | null,
  eventLog: [] as MatchEvent[],
  eventCursor: 0,
  requestSeq: 0,
  appliedSeq: 0,
  playing: true,
  playbackSpeed: 1 as (typeof PLAYBACK_SPEEDS)[number],
  playbackTimer: null as ReturnType<typeof setInterval> | null,
  playbackLastClock: 0,
  tickDebt: 0,
  playbackInFlight: false,
  playbackErrors: 0,
  wallMode: false,
  // While on, the next tile click moves the player's tower (the one free move, spec/02).
  moveMode: false,
  // Whether the player picked a tile (click or arrows) since this match began; see resolvePlacementCell.
  cursorChosen: false,
  playerSignature: "",
  chipStructureSignature: "",
  playerChips: new Map<string, PlayerChipRefs>(),
  // The match-end modal is dismissable; once dismissed it stays closed for this ended match.
  endOverlayDismissed: false,
  endOverlayRelease: null as (() => void) | null,
  endOverlayOpener: null as HTMLElement | null
};
