import { BASE_TICKS_PER_SECOND, MAX_TICKS_PER_REQUEST, PLAYBACK_CHECK_INTERVAL_MS } from "./constants";
import { el } from "./dom";
import { syncGuideOverlay } from "./guide";
import { store } from "./state";
const hooks = {
    advance: async () => { },
    blocked: () => false
};
export function configurePlayback(next) {
    hooks.advance = next.advance;
    hooks.blocked = next.blocked;
}
export function msPerTick() {
    return 1000 / (BASE_TICKS_PER_SECOND * store.playbackSpeed);
}
export function playbackShouldRun() {
    return store.playing && !hooks.blocked() && !document.hidden && store.current?.phase === "wave" && !el.gameScreen.classList.contains("hidden");
}
export function startPlayback() {
    if (store.playbackTimer !== null) {
        return;
    }
    store.playbackLastClock = performance.now();
    store.tickDebt = 0;
    store.playbackErrors = 0;
    store.playbackTimer = setInterval(playbackStep, PLAYBACK_CHECK_INTERVAL_MS);
}
export function stopPlayback() {
    if (store.playbackTimer !== null) {
        clearInterval(store.playbackTimer);
        store.playbackTimer = null;
    }
    store.tickDebt = 0;
}
// Fixed-rate tick accumulator: at most one request in flight, and stalls or hidden tabs never cause a catch-up burst.
export function playbackStep() {
    const now = performance.now();
    const elapsedMs = Math.min(now - store.playbackLastClock, 250);
    store.playbackLastClock = now;
    if (!playbackShouldRun()) {
        store.tickDebt = 0;
        return;
    }
    store.tickDebt = Math.min(store.tickDebt + (elapsedMs / 1000) * BASE_TICKS_PER_SECOND * store.playbackSpeed, MAX_TICKS_PER_REQUEST);
    const ticks = Math.floor(store.tickDebt);
    if (store.playbackInFlight || ticks < 1) {
        return;
    }
    store.tickDebt -= ticks;
    store.playbackInFlight = true;
    void hooks.advance(ticks).finally(() => {
        store.playbackInFlight = false;
    });
}
export function setPlaying(next) {
    store.playing = next;
    syncPlaybackControls();
    if (store.playing) {
        store.tickDebt = 0;
        // Otherwise a single failure after a failure-triggered pause would pause again immediately.
        store.playbackErrors = 0;
        store.playbackLastClock = performance.now();
    }
    // The wave guidance button label mirrors the current state.
    syncGuideOverlay(store.current);
}
export function setPlaybackSpeed(next) {
    store.playbackSpeed = next;
    syncPlaybackControls();
}
export function syncPlaybackControls() {
    el.playPauseBtn.textContent = store.playing ? "Pause" : "Play";
    el.playPauseBtn.setAttribute("aria-pressed", String(store.playing));
    for (const button of el.playbackControls.querySelectorAll(".speed-btn")) {
        button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === store.playbackSpeed));
    }
}
document.addEventListener("visibilitychange", () => {
    store.tickDebt = 0;
    store.playbackLastClock = performance.now();
});
