import assert from "node:assert/strict";
import test from "node:test";
import { FIT_VIEW, GestureTracker, MAX_ZOOM, MIN_ZOOM, clampView, clampZoom, panBy, screenToWorld, stepZoom, wheelZoomFactor, worldToScreen, zoomAt } from "./viewport.js";
const WORLD = { width: 1000, height: 800 };
test("zoom is clamped to the allowed range", () => {
    assert.equal(clampZoom(0.2), MIN_ZOOM);
    assert.equal(clampZoom(9), MAX_ZOOM);
    assert.equal(clampZoom(Number.NaN), MIN_ZOOM);
    assert.equal(clampZoom(1.7), 1.7);
});
test("the view never leaves the map", () => {
    assert.deepEqual(clampView({ zoom: 1, x: 50, y: -20 }, WORLD), FIT_VIEW);
    const view = clampView({ zoom: 2, x: 9999, y: 9999 }, WORLD);
    assert.equal(view.x, 500);
    assert.equal(view.y, 400);
    assert.deepEqual(clampView({ zoom: 2, x: -5, y: -5 }, WORLD), { zoom: 2, x: 0, y: 0 });
});
test("screen and world conversion round trip at any view", () => {
    const view = { zoom: 2.5, x: 120, y: 80 };
    const world = screenToWorld(view, 333, 111);
    const screen = worldToScreen(view, world.x, world.y);
    assert.ok(Math.abs(screen.x - 333) < 1e-9);
    assert.ok(Math.abs(screen.y - 111) < 1e-9);
});
test("zooming keeps the world point under the anchor fixed", () => {
    const start = zoomAt(FIT_VIEW, 2, 400, 300, WORLD);
    const before = screenToWorld(FIT_VIEW, 400, 300);
    const after = screenToWorld(start, 400, 300);
    assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
    assert.equal(start.zoom, 2);
});
test("zooming out to fit resets the offset", () => {
    const zoomed = zoomAt(FIT_VIEW, 3, 900, 700, WORLD);
    assert.ok(zoomed.x > 0);
    assert.deepEqual(zoomAt(zoomed, 1, 450, 350, WORLD), FIT_VIEW);
});
test("panning moves the map with the finger and stops at the edges", () => {
    const zoomed = { zoom: 2, x: 250, y: 200 };
    const panned = panBy(zoomed, 100, 40, WORLD);
    assert.deepEqual(panned, { zoom: 2, x: 200, y: 180 });
    assert.deepEqual(panBy(zoomed, 99999, 99999, WORLD), { zoom: 2, x: 0, y: 0 });
    assert.deepEqual(panBy(FIT_VIEW, 50, 50, WORLD), FIT_VIEW);
});
test("zoom steps snap to the step grid within the limits", () => {
    assert.equal(stepZoom(1, 1), 1.25);
    assert.equal(stepZoom(1.3, 1), 1.5);
    assert.equal(stepZoom(1, -1), 1);
    assert.equal(stepZoom(3, 1), 3);
});
test("wheel up zooms in, wheel down zooms out, ctrl pinch is stronger", () => {
    assert.ok(wheelZoomFactor(-100, 0, false) > 1);
    assert.ok(wheelZoomFactor(100, 0, false) < 1);
    assert.ok(wheelZoomFactor(-5, 0, true) > wheelZoomFactor(-5, 0, false));
});
test("a short press is a tap, reported on release", () => {
    const tracker = new GestureTracker();
    tracker.down(1, 10, 10);
    assert.deepEqual(tracker.move(1, 13, 12), []);
    assert.deepEqual(tracker.up(1), [{ type: "tap", x: 13, y: 12 }]);
});
test("a press that moves past the slop is a drag and never a tap", () => {
    const tracker = new GestureTracker();
    tracker.down(1, 0, 0);
    assert.deepEqual(tracker.move(1, 20, 0), []);
    assert.deepEqual(tracker.move(1, 25, 5), [{ type: "pan", dx: 5, dy: 5 }]);
    assert.deepEqual(tracker.up(1), []);
});
test("two pointers pinch and pan, and the gesture never ends as a tap", () => {
    const tracker = new GestureTracker();
    tracker.down(1, 100, 100);
    tracker.down(2, 200, 100);
    const [action] = tracker.move(2, 300, 100);
    assert.equal(action?.type, "pinch");
    if (action?.type === "pinch") {
        assert.equal(action.factor, 2);
        assert.equal(action.x, 200);
        assert.equal(action.dx, 50);
    }
    assert.deepEqual(tracker.up(2), []);
    assert.deepEqual(tracker.up(1), []);
    // The next gesture starts clean.
    tracker.down(3, 5, 5);
    assert.deepEqual(tracker.up(3), [{ type: "tap", x: 5, y: 5 }]);
});
test("a cancelled gesture produces nothing", () => {
    const tracker = new GestureTracker();
    tracker.down(1, 0, 0);
    tracker.cancel();
    assert.deepEqual(tracker.up(1), []);
});
