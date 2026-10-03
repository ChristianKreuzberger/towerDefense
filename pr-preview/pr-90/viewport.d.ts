export declare const MIN_ZOOM = 1;
export declare const MAX_ZOOM = 3;
export declare const ZOOM_STEP = 0.25;
export declare const TAP_SLOP_PX = 8;
export interface View {
    zoom: number;
    x: number;
    y: number;
}
export interface WorldSize {
    width: number;
    height: number;
}
export declare const FIT_VIEW: View;
export declare function clampZoom(zoom: number): number;
export declare function clampView(view: View, world: WorldSize): View;
export declare function screenToWorld(view: View, sx: number, sy: number): {
    x: number;
    y: number;
};
export declare function worldToScreen(view: View, wx: number, wy: number): {
    x: number;
    y: number;
};
export declare function zoomAt(view: View, nextZoom: number, anchorX: number, anchorY: number, world: WorldSize): View;
export declare function panBy(view: View, dx: number, dy: number, world: WorldSize): View;
export declare function stepZoom(zoom: number, direction: 1 | -1): number;
export declare function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number;
export type GestureAction = {
    type: "tap";
    x: number;
    y: number;
} | {
    type: "pan";
    dx: number;
    dy: number;
} | {
    type: "pinch";
    factor: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
};
export declare class GestureTracker {
    private pointers;
    private dragged;
    private multi;
    down(id: number, x: number, y: number): void;
    move(id: number, x: number, y: number): GestureAction[];
    up(id: number): GestureAction[];
    cancel(): void;
    private pair;
}
//# sourceMappingURL=viewport.d.ts.map