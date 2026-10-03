import { MAX_TOWER_LEVEL, UPGRADE_TRACKS, getTowerStats, getTowerUpgradeCost } from "@tower-defense/shared";
import { battlefieldMount } from "./board";
import { el } from "./dom";
import { store } from "./state";
// Upgrade popover for a tapped tower. It is only a second face for the toolbar upgrade buttons: the buttons click
// the real ones, and the numbers come from the same toolbar state and shared cost functions.
const TRACK_LABELS = { range: "Range", damage: "Damage", accuracy: "Accuracy" };
let openTowerId = null;
let openPhase = null;
const trackButtons = new Map(UPGRADE_TRACKS.map((track) => [track, el.towerMenu.querySelector(`.tower-menu-btn[data-track="${track}"]`)]));
export function isTowerMenuOpen() {
    return openTowerId !== null;
}
export function openTowerMenu(tower, phase) {
    openTowerId = tower.id;
    openPhase = phase;
}
export function closeTowerMenu() {
    openTowerId = null;
    openPhase = null;
    el.towerMenu.hidden = true;
}
// Called from renderToolbar with the selected player's tower and state, so the popover can never disagree with the toolbar.
export function syncTowerMenu(snapshot, tower, state, points) {
    if (openTowerId === null) {
        return;
    }
    if (!tower || tower.id !== openTowerId || snapshot.phase !== openPhase) {
        closeTowerMenu();
        return;
    }
    const owner = snapshot.players.find((player) => player.id === tower.playerId);
    el.towerMenuTitle.textContent = `${owner?.name ?? tower.playerId} · Level ${getTowerStats(tower.upgrades).level}`;
    for (const track of UPGRADE_TRACKS) {
        const button = trackButtons.get(track);
        if (!button) {
            continue;
        }
        const level = tower.upgrades[track];
        const info = state.upgrades[track];
        const price = getTowerUpgradeCost(track, level);
        const cost = button.querySelector(".tower-menu-cost");
        button.querySelector(".tower-menu-name").textContent = TRACK_LABELS[track];
        button.querySelector(".tower-menu-level").textContent = `${level}/${MAX_TOWER_LEVEL}`;
        if (cost) {
            cost.textContent = info.maxed ? "MAX" : `${price}`;
            cost.classList.toggle("short", !info.maxed && points < price);
        }
        button.classList.toggle("dim", !info.enabled);
        button.setAttribute("aria-disabled", String(!info.enabled));
        button.disabled = snapshot.phase === "ended";
    }
    el.towerMenu.hidden = false;
    positionTowerMenu();
}
// Floats above the tower (below it near the top edge) on wide screens; narrow screens dock it with CSS.
export function positionTowerMenu() {
    const snapshot = store.current;
    const tower = snapshot?.towers.find((entry) => entry.id === openTowerId);
    const canvas = el.board.querySelector("canvas");
    if (!tower || !canvas || el.towerMenu.hidden) {
        return;
    }
    const anchor = battlefieldMount.cellToCss(tower.x, tower.y);
    const scale = canvas.width > 0 ? canvas.getBoundingClientRect().width / canvas.width : 1;
    const lift = battlefieldMount.cellSize() * battlefieldMount.zoom() * scale * 0.6;
    const menuWidth = el.towerMenu.offsetWidth;
    const menuHeight = el.towerMenu.offsetHeight;
    // Zoomed or panned until the tower is out of sight: hide a floating popover rather than pin it to empty space.
    // The docked (narrow) variant does not follow the tower, so it stays.
    const docked = window.matchMedia("(max-width: 1040px)").matches;
    const visible = anchor.x >= 0 && anchor.y >= 0 && anchor.x <= canvas.getBoundingClientRect().width && anchor.y <= canvas.getBoundingClientRect().height;
    el.towerMenu.style.visibility = docked || visible ? "" : "hidden";
    const left = Math.min(Math.max(canvas.offsetLeft + anchor.x, menuWidth / 2 + 4), el.board.clientWidth - menuWidth / 2 - 4);
    const above = canvas.offsetTop + anchor.y - lift - menuHeight >= 0;
    el.towerMenu.style.left = `${left}px`;
    el.towerMenu.style.top = `${canvas.offsetTop + anchor.y + (above ? -lift : lift)}px`;
    el.towerMenu.classList.toggle("below", !above);
}
export function installTowerMenu() {
    for (const [track, button] of trackButtons) {
        button.addEventListener("click", () => el.upgradeBtns[track].click());
    }
    el.towerMenuClose.addEventListener("click", closeTowerMenu);
}
