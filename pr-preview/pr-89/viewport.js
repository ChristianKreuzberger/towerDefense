// Pure zoom and pan math for the board, kept free of Phaser and the DOM so it can be unit tested.
// A view is the world-space (map pixel) point shown at the canvas top-left plus a zoom factor:
// canvasPx = (world - view.{x,y}) * zoom.
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 0.25;
// A press that moves further than this (CSS px) is a drag, not a tap.
export const TAP_SLOP_PX = 8;
export const FIT_VIEW = { zoom: MIN_ZOOM, x: 0, y: 0 };
export function clampZoom(zoom) {
    if (!Number.isFinite(zoom)) {
        return MIN_ZOOM;
    }
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}
// Keeps the visible window inside the map so the canvas is always filled.
export function clampView(view, world) {
    const zoom = clampZoom(view.zoom);
    const maxX = Math.max(0, world.width - world.width / zoom);
    const maxY = Math.max(0, world.height - world.height / zoom);
    return { zoom, x: Math.min(maxX, Math.max(0, view.x)), y: Math.min(maxY, Math.max(0, view.y)) };
}
export function screenToWorld(view, sx, sy) {
    return { x: sx / view.zoom + view.x, y: sy / view.zoom + view.y };
}
export function worldToScreen(view, wx, wy) {
    return { x: (wx - view.x) * view.zoom, y: (wy - view.y) * view.zoom };
}
// Changes the zoom while the world point under the screen anchor stays under it.
export function zoomAt(view, nextZoom, anchorX, anchorY, world) {
    const zoom = clampZoom(nextZoom);
    const anchor = screenToWorld(view, anchorX, anchorY);
    return clampView({ zoom, x: anchor.x - anchorX / zoom, y: anchor.y - anchorY / zoom }, world);
}
// A drag of (dx, dy) screen pixels moves the map with the finger.
export function panBy(view, dx, dy, world) {
    return clampView({ zoom: view.zoom, x: view.x - dx / view.zoom, y: view.y - dy / view.zoom }, world);
}
// One step of the +/- buttons and keys, snapped to the step grid.
export function stepZoom(zoom, direction) {
    const stepped = Math.round(zoom / ZOOM_STEP) * ZOOM_STEP + direction * ZOOM_STEP;
    return clampZoom(stepped);
}
// Smooth wheel zoom; browsers report a trackpad pinch as ctrl+wheel with small deltas, so it gets a larger gain.
export function wheelZoomFactor(deltaY, deltaMode, ctrlKey) {
    const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
    const gain = ctrlKey ? 0.01 : 0.0015;
    return Math.exp(-pixels * gain);
}
// Turns raw pointer events into taps, drags and pinches. A gesture that ever had a second pointer, or that moved
// past the slop, never ends as a tap, so zooming and panning cannot place or select anything.
export class GestureTracker {
    pointers = new Map();
    dragged = false;
    multi = false;
    down(id, x, y) {
        if (this.pointers.size === 0) {
            this.dragged = false;
            this.multi = false;
        }
        this.pointers.set(id, { x, y, startX: x, startY: y });
        if (this.pointers.size > 1) {
            this.multi = true;
        }
    }
    move(id, x, y) {
        const pointer = this.pointers.get(id);
        if (!pointer) {
            return [];
        }
        if (this.pointers.size >= 2) {
            const before = this.pair();
            pointer.x = x;
            pointer.y = y;
            const after = this.pair();
            if (!before || !after || before.dist === 0) {
                return [];
            }
            return [{ type: "pinch", factor: after.dist / before.dist, x: after.midX, y: after.midY, dx: after.midX - before.midX, dy: after.midY - before.midY }];
        }
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        pointer.x = x;
        pointer.y = y;
        if (!this.dragged && Math.hypot(x - pointer.startX, y - pointer.startY) > TAP_SLOP_PX) {
            this.dragged = true;
            // The slop distance itself is not applied, so the map does not jump when the drag starts.
            return [];
        }
        return this.dragged ? [{ type: "pan", dx, dy }] : [];
    }
    up(id) {
        const pointer = this.pointers.get(id);
        if (!pointer) {
            return [];
        }
        this.pointers.delete(id);
        if (this.pointers.size === 0 && !this.dragged && !this.multi) {
            return [{ type: "tap", x: pointer.x, y: pointer.y }];
        }
        return [];
    }
    cancel() {
        this.pointers.clear();
        this.dragged = false;
        this.multi = false;
    }
    pair() {
        const [a, b] = [...this.pointers.values()];
        if (!a || !b) {
            return null;
        }
        return { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
    }
}
