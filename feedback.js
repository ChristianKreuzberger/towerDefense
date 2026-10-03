import { TOAST_CAPACITY, TOAST_LIFETIME_MS } from "./constants";
import { el } from "./dom";
export function setStatus(text) {
    el.status.textContent = text;
}
export function setMenuMessage(text) {
    el.menuMessage.textContent = text;
}
export const REJECT_REASON_TEXT = {
    "insufficient-points": "not enough points",
    "not-tower-spot": "towers go on the marked spots, not on the road",
    "tower-overlap": "a tower is already there",
    "path-blocked": "that would block the path",
    "spawn-protected": "too close to the monster cave",
    "upgrade-phase-not-active": "upgrades can only be bought during prep, before you ready",
    "tower-move-locked": "moving your tower unlocks after round 5",
    "tower-move-used": "you already used your free move",
    "move-phase-not-active": "you can only move your tower during prep, before you ready",
    "invalid-move-target": "you can only move your own tower",
    "tower-max-level": "your tower is already at max level",
    "invalid-target-mode-target": "you can only change your own tower",
    "invalid-target-mode": "unknown target mode",
    "damage-type-phase-not-active": "damage type can only be changed during prep, before you ready",
    "invalid-damage-type-target": "you can only change your own tower",
    "invalid-damage-type": "unknown damage type",
    "match-already-ended": "the match is over",
    "player-eliminated": "your tower was destroyed",
    "unknown-player": "unknown player",
    "player-already-ready-for-wave": "you are already ready",
    "placement-phase-not-active": "towers can only be placed during placement",
    "tower-already-placed": "you already placed your tower",
    "tower-not-placed": "place your tower first",
    "out-of-bounds": "outside the map"
};
export const COMMAND_LABEL = {
    "place-tower": "Tower",
    "upgrade-tower": "Upgrade",
    "move-tower": "Move",
    "set-target-mode": "Target mode",
    "set-damage-type": "Damage type",
    "ready-for-wave": "Ready"
};
// Toasts replace the old persistent feedback log: short-lived, stacked, and announced via aria-live.
export function addFeedback(type, message, commandType, reason) {
    let text = message;
    if (commandType && type === "rejected") {
        text = `${COMMAND_LABEL[commandType] ?? commandType} rejected: ${REJECT_REASON_TEXT[reason ?? ""] ?? reason ?? "unknown reason"}`;
    }
    else if (commandType && type === "accepted") {
        text = `${COMMAND_LABEL[commandType] ?? commandType} done`;
    }
    else if (reason) {
        text = `${message}: ${reason}`;
    }
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = text;
    el.feedbackQueue.append(toast);
    while (el.feedbackQueue.children.length > TOAST_CAPACITY) {
        el.feedbackQueue.firstElementChild?.remove();
    }
    setTimeout(() => toast.remove(), TOAST_LIFETIME_MS);
}
