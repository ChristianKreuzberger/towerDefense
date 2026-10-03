import { el } from "./dom";
// On narrow screens the secondary controls (target mode, damage type, session buttons) live in a sheet above the
// action bar. On wide screens the same elements are plain panel content and none of this is visible.
export function isMoreOpen() {
    return el.controlPanel.classList.contains("more-open");
}
export function setMoreOpen(open) {
    el.controlPanel.classList.toggle("more-open", open);
    el.mobileMoreBtn.setAttribute("aria-expanded", String(open));
}
export function installMobileMenu() {
    el.mobileMoreBtn.addEventListener("click", () => setMoreOpen(!isMoreOpen()));
    // A tap on the board (or anywhere outside the panel) puts the sheet away so it never hides the map.
    document.addEventListener("pointerdown", (event) => {
        if (isMoreOpen() && event.target instanceof Node && !el.controlPanel.contains(event.target)) {
            setMoreOpen(false);
        }
    });
    // Picking a session action (settings, tour, menu...) also closes it; the dialogs open over the page.
    el.controlPanel.querySelector(".session-row")?.addEventListener("click", () => setMoreOpen(false));
}
