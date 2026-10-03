import { battlefieldMount } from "./board";
import { el } from "./dom";
import { MAX_ZOOM, MIN_ZOOM } from "./viewport";
// On-screen zoom buttons; the wheel and touch gestures live in the scene. The buttons follow the view so a
// control that cannot do anything looks off.
export function syncZoomButtons() {
    const zoom = battlefieldMount.zoom();
    el.zoomInBtn.disabled = zoom >= MAX_ZOOM;
    el.zoomOutBtn.disabled = zoom <= MIN_ZOOM;
    el.zoomFitBtn.disabled = zoom <= MIN_ZOOM;
}
export function installZoomControls() {
    el.zoomInBtn.addEventListener("click", () => battlefieldMount.zoomStep(1));
    el.zoomOutBtn.addEventListener("click", () => battlefieldMount.zoomStep(-1));
    el.zoomFitBtn.addEventListener("click", () => battlefieldMount.resetView());
    syncZoomButtons();
}
