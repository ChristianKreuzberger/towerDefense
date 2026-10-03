// The one place mutable client state lives. Modules import `store` and read or write fields, so there is
// no hidden module-level state to keep in sync.
export const store = {
    current: null,
    bannerTimer: null,
    turnBannerTimer: null,
    menuPlayers: [],
    guideDismissedKey: null,
    lastGuideKey: "",
    mapCache: null,
    eventLog: [],
    eventCursor: 0,
    requestSeq: 0,
    appliedSeq: 0,
    playing: true,
    playbackSpeed: 1,
    playbackTimer: null,
    playbackLastClock: 0,
    tickDebt: 0,
    playbackInFlight: false,
    playbackErrors: 0,
    // While on, the next tile click moves the player's tower (the one free move, spec/02).
    moveMode: false,
    // Whether the player picked a tile (click or arrows) since this match began; see resolvePlacementCell.
    cursorChosen: false,
    playerSignature: "",
    chipStructureSignature: "",
    playerChips: new Map(),
    // The match-end modal is dismissable; once dismissed it stays closed for this ended match.
    endOverlayDismissed: false,
    endOverlayRelease: null,
    endOverlayOpener: null
};
