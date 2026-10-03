const enabled = new URLSearchParams(window.location.search).get("perf") === "1";
let applyTotalMs = 0;
let overlay = null;
let frames = 0;
let windowStart = performance.now();
const stats = {
    enabled,
    snapshotCount: 0,
    applyLastMs: 0,
    applyAvgMs: 0,
    applyMaxMs: 0,
    lastSnapshotBytes: 0,
    totalSnapshotBytes: 0,
    fps: 0,
    minFps: Number.POSITIVE_INFINITY,
    reset() {
        stats.snapshotCount = 0;
        stats.applyLastMs = 0;
        stats.applyAvgMs = 0;
        stats.applyMaxMs = 0;
        stats.lastSnapshotBytes = 0;
        stats.totalSnapshotBytes = 0;
        stats.minFps = Number.POSITIVE_INFINITY;
        applyTotalMs = 0;
    }
};
function renderOverlay() {
    if (!overlay) {
        return;
    }
    overlay.textContent =
        `apply ${stats.applyLastMs.toFixed(2)}ms (avg ${stats.applyAvgMs.toFixed(2)}, max ${stats.applyMaxMs.toFixed(2)})\n` +
            `fps ${stats.fps.toFixed(0)}  snapshot ${(stats.lastSnapshotBytes / 1024).toFixed(1)} KiB  n=${stats.snapshotCount}`;
}
function frame(now) {
    frames += 1;
    if (now - windowStart >= 1000) {
        stats.fps = (frames * 1000) / (now - windowStart);
        stats.minFps = Math.min(stats.minFps, stats.fps);
        frames = 0;
        windowStart = now;
        renderOverlay();
    }
    requestAnimationFrame(frame);
}
if (enabled) {
    window.__perf = stats;
    overlay = document.createElement("pre");
    overlay.id = "perfOverlay";
    overlay.style.cssText =
        "position:fixed;top:4px;right:4px;z-index:100;margin:0;padding:4px 6px;background:rgba(0,0,0,.75);color:#9f9;font:11px monospace;pointer-events:none";
    document.body.append(overlay);
    requestAnimationFrame(frame);
}
export function perfTimeApply(run) {
    if (!enabled) {
        return run();
    }
    const start = performance.now();
    const result = run();
    const elapsed = performance.now() - start;
    stats.snapshotCount += 1;
    stats.applyLastMs = elapsed;
    stats.applyMaxMs = Math.max(stats.applyMaxMs, elapsed);
    applyTotalMs += elapsed;
    stats.applyAvgMs = applyTotalMs / stats.snapshotCount;
    renderOverlay();
    return result;
}
export function perfRecordBytes(bytes) {
    if (!enabled) {
        return;
    }
    stats.lastSnapshotBytes = bytes;
    stats.totalSnapshotBytes += bytes;
}
