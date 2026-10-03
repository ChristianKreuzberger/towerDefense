import { placeTowerForSelectedPlayer } from "./actions";
import { adjustCoord, battlefieldMount, setMoveMode } from "./board";
import { DEBUG } from "./constants";
import { el, must } from "./dom";
import { closeOverlay, isEndOverlayOpen } from "./end-overlay";
import { hideGuideOverlay } from "./guide";
import { isMoreOpen, setMoreOpen } from "./mobile-menu";
import { playerNumber } from "./player-util";
import { mapPreview, settingsDialog, settingsStore, tour } from "./services";
import { store } from "./state";
import { isActionAvailable } from "./toolbar";
import { closeTowerMenu, isTowerMenuOpen } from "./tower-menu";
import { setActivePlayer } from "./turns";
function isFormField(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
}
// Returns a function that removes the listener again.
export function installHotkeys() {
    const onKeyDown = (event) => {
        if (tour.isOpen()) {
            // The dialog handles Esc itself, but not after a backdrop click moved focus out of it.
            if (event.key === "Escape") {
                event.preventDefault();
                tour.close();
            }
            return;
        }
        if (mapPreview.isOpen()) {
            // Game hotkeys stay off while it is open. Esc also works after a backdrop click moved focus out of the dialog.
            if (event.key === "Escape") {
                event.preventDefault();
                mapPreview.close();
            }
            return;
        }
        if (settingsDialog.isOpen()) {
            if (event.key === "Escape") {
                event.preventDefault();
                settingsDialog.close();
            }
            return;
        }
        if (isEndOverlayOpen()) {
            if (event.key === "Escape") {
                event.preventDefault();
                closeOverlay();
            }
            else if (event.key === "Tab") {
                // Wrap inside the modal; with the page inert Tab would otherwise leave for the browser chrome.
                const buttons = [...el.overlay.querySelectorAll("button")];
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (first && last && event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                }
                else if (first && last && !event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
            return;
        }
        if (isFormField(event.target)) {
            return;
        }
        if (event.key.toLowerCase() === "m" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            settingsStore.set({ muted: !settingsStore.get().muted });
            return;
        }
        // `current` is not cleared when returning to the menu, so check the screen and end overlay explicitly.
        const inMatch = store.current && !el.gameScreen.classList.contains("hidden") && el.overlay.style.display !== "flex";
        if (inMatch && store.current && !event.ctrlKey && !event.metaKey && !event.altKey && /^[1-8]$/.test(event.key)) {
            const target = store.current.players.find((player) => playerNumber(player.id) === Number(event.key));
            if (target) {
                event.preventDefault();
                setActivePlayer(target.id);
            }
            return;
        }
        // Game hotkeys only make sense inside a running match, and only for actions that are available right now.
        if (!inMatch) {
            return;
        }
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                battlefieldMount.zoomStep(1);
                return;
            }
            if (event.key === "-" || event.key === "_") {
                event.preventDefault();
                battlefieldMount.zoomStep(-1);
                return;
            }
            if (event.key === "0") {
                event.preventDefault();
                battlefieldMount.resetView();
                return;
            }
        }
        const key = event.key.toLowerCase();
        if (key === "r") {
            event.preventDefault();
            if (isActionAvailable(el.readyBtn)) {
                el.readyBtn.click();
            }
            return;
        }
        if (key === "t") {
            event.preventDefault();
            if (isActionAvailable(el.placeTowerBtn)) {
                placeTowerForSelectedPlayer();
            }
            return;
        }
        if (key === "v") {
            event.preventDefault();
            if (isActionAvailable(el.moveTowerBtn)) {
                el.moveTowerBtn.click();
            }
            return;
        }
        if (key === "p") {
            event.preventDefault();
            el.playPauseBtn.click();
            return;
        }
        if (event.key === "Escape" && isMoreOpen()) {
            setMoreOpen(false);
            return;
        }
        if (event.key === "Escape" && isTowerMenuOpen()) {
            closeTowerMenu();
            return;
        }
        if (event.key === "Escape" && store.moveMode) {
            setMoveMode(false);
            return;
        }
        if (event.key === "Escape" && !el.guideOverlay.classList.contains("guide-idle")) {
            store.guideDismissedKey = store.lastGuideKey;
            hideGuideOverlay();
            return;
        }
        const hotkeyTrack = { u: "range", i: "damage", o: "accuracy" }[key];
        if (hotkeyTrack) {
            event.preventDefault();
            if (isActionAvailable(el.upgradeBtns[hotkeyTrack])) {
                el.upgradeBtns[hotkeyTrack].click();
            }
            return;
        }
        if (key === "a" && DEBUG) {
            event.preventDefault();
            must("advanceBtn").click();
            return;
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            adjustCoord(-1, 0);
            return;
        }
        if (event.key === "ArrowRight") {
            event.preventDefault();
            adjustCoord(1, 0);
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            adjustCoord(0, -1);
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            adjustCoord(0, 1);
        }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
}
