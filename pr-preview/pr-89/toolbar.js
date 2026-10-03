import { UPGRADE_TRACKS, getTowerUpgradeCost } from "@tower-defense/shared";
import { setMoveMode } from "./board";
import { el } from "./dom";
import { store } from "./state";
import { getToolbarState } from "./toolbar-state";
import { syncTowerMenu } from "./tower-menu";
// Costs come from the shared cost functions so the UI can never drift from what the simulation charges.
// Dimmed and aria-disabled: still clickable (so a press explains itself), but hotkeys skip it. After the match
// ended the button is really disabled, so closing the end modal never leaves live controls behind.
export function setAvailability(button, enabled, ended) {
    button.classList.toggle("dim", !enabled);
    button.setAttribute("aria-disabled", String(!enabled));
    button.disabled = ended;
}
export function isActionAvailable(button) {
    return !button.disabled && button.getAttribute("aria-disabled") !== "true";
}
export function renderToolbar(snapshot) {
    if (!snapshot) {
        return;
    }
    const playerId = el.playerId.value;
    const player = snapshot.players.find((entry) => entry.id === playerId);
    const tower = snapshot.towers.find((entry) => entry.playerId === playerId);
    const points = player?.points ?? 0;
    const state = getToolbarState({
        phase: snapshot.phase,
        upgrades: tower?.upgrades ?? null,
        eliminated: Boolean(player?.eliminated),
        readyForWave: Boolean(player?.readyForWave),
        towerMoveAvailable: Boolean(player?.towerMoveAvailable),
        wave: snapshot.wave
    });
    for (const track of UPGRADE_TRACKS) {
        const button = el.upgradeBtns[track];
        const cost = el.upgradeCosts[track];
        const level = tower?.upgrades[track] ?? null;
        const price = level === null ? null : getTowerUpgradeCost(track, level);
        cost.textContent = state.upgrades[track].maxed ? "MAX" : price === null ? "-" : `${price}`;
        cost.classList.toggle("short", !state.upgrades[track].maxed && price !== null && points < price);
        button.classList.toggle("dim", !state.upgrades[track].enabled);
        button.setAttribute("aria-disabled", String(!state.upgrades[track].enabled));
    }
    setAvailability(el.placeTowerBtn, state.placeTowerEnabled, snapshot.phase === "ended");
    setAvailability(el.readyBtn, state.readyEnabled, snapshot.phase === "ended");
    // Stays clickable so a press can explain why it is off (see the click handler).
    el.moveTowerBtn.classList.toggle("dim", !state.moveEnabled);
    el.moveTowerBtn.setAttribute("aria-disabled", String(!state.moveEnabled));
    el.moveTowerCost.textContent = state.moveLabel;
    el.moveTowerBtn.dataset.hint = state.moveHint;
    if (!state.moveEnabled && store.moveMode) {
        setMoveMode(false);
    }
    el.mode.disabled = !state.targetModeEnabled;
    el.damageType.disabled = !state.damageTypeEnabled;
    if (tower) {
        el.mode.value = tower.targetMode;
        el.damageType.value = tower.damageType;
    }
    syncTowerMenu(snapshot, tower, state, points);
}
