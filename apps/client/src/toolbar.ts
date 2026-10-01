import { UPGRADE_TRACKS, getTowerUpgradeCost, getWallCost } from "@tower-defense/shared";
import type { MatchSnapshot } from "@tower-defense/shared";
import { setMoveMode, setWallMode } from "./board";
import { el } from "./dom";
import { store } from "./state";
import { getToolbarState } from "./toolbar-state";

// Costs come from the shared cost functions so the UI can never drift from what the simulation charges.
// Dimmed and aria-disabled: still clickable (so a press explains itself), but hotkeys skip it. After the match
// ended the button is really disabled, so closing the end modal never leaves live controls behind.
export function setAvailability(button: HTMLButtonElement, enabled: boolean, ended: boolean): void {
  button.classList.toggle("dim", !enabled);
  button.setAttribute("aria-disabled", String(!enabled));
  button.disabled = ended;
}

export function isActionAvailable(button: HTMLButtonElement): boolean {
  return !button.disabled && button.getAttribute("aria-disabled") !== "true";
}

export function renderToolbar(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    return;
  }
  const playerId = el.playerId.value;
  const player = snapshot.players.find((entry) => entry.id === playerId);
  const tower = snapshot.towers.find((entry) => entry.playerId === playerId);
  const points = player?.points ?? 0;
  const wallCost = getWallCost(snapshot.walls.length);
  el.wallCost.textContent = `${wallCost}`;
  el.wallCost.classList.toggle("short", points < wallCost);
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
  // The wall button stays clickable so a press explains why it is off (see the click handler) instead of failing silently.
  el.placeWallBtn.classList.toggle("dim", !state.wallEnabled);
  el.placeWallBtn.setAttribute("aria-disabled", String(!state.wallEnabled));
  if (!state.wallEnabled && store.wallMode) {
    setWallMode(false);
  }
  setAvailability(el.placeTowerBtn, state.placeTowerEnabled, snapshot.phase === "ended");
  setAvailability(el.readyBtn, state.readyEnabled, snapshot.phase === "ended");
  // Stays clickable like the wall button, so a press can explain why it is off.
  el.moveTowerBtn.classList.toggle("dim", !state.moveEnabled);
  el.moveTowerBtn.setAttribute("aria-disabled", String(!state.moveEnabled));
  el.moveTowerCost.textContent = state.moveLabel;
  if (!state.moveEnabled && store.moveMode) {
    setMoveMode(false);
  }
  el.mode.disabled = !state.targetModeEnabled;
  el.damageType.disabled = !state.damageTypeEnabled;
  if (tower) {
    el.mode.value = tower.targetMode;
    el.damageType.value = tower.damageType;
  }
}
