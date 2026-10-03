import type { MapCell, MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { PLAYBACK_SPEEDS } from "./constants";
export interface MapCache {
    key: string;
    cells: MapCell[];
    byKey: Map<string, MapCell>;
    towerSpots: MapCell[];
    towerSpotKeys: Set<string>;
    worn: MapCell[];
}
export interface MenuPlayerInput {
    id: string;
    inputId: string;
    defaultName: string;
    botSelectId?: string;
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
export declare const store: {
    current: MatchSnapshot | null;
    bannerTimer: ReturnType<typeof setTimeout> | null;
    turnBannerTimer: ReturnType<typeof setTimeout> | null;
    menuPlayers: MenuPlayerInput[];
    guideDismissedKey: string | null;
    lastGuideKey: string;
    mapCache: MapCache | null;
    eventLog: MatchEvent[];
    eventCursor: number;
    requestSeq: number;
    appliedSeq: number;
    playing: boolean;
    playbackSpeed: (typeof PLAYBACK_SPEEDS)[number];
    playbackTimer: ReturnType<typeof setInterval> | null;
    playbackLastClock: number;
    tickDebt: number;
    playbackInFlight: boolean;
    playbackErrors: number;
    moveMode: boolean;
    cursorChosen: boolean;
    playerSignature: string;
    chipStructureSignature: string;
    playerChips: Map<string, PlayerChipRefs>;
    endOverlayDismissed: boolean;
    endOverlayRelease: (() => void) | null;
    endOverlayOpener: HTMLElement | null;
};
//# sourceMappingURL=state.d.ts.map