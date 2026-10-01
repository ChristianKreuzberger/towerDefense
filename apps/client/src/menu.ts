import { MAX_PLAYER_NAME_LENGTH } from "@tower-defense/shared";
import type { MatchSetup } from "@tower-defense/shared";
import { el, must } from "./dom";
import { hideGuideOverlay } from "./guide";
import { stopPlayback } from "./playback";
import { store } from "./state";

// Menu and game screens, and the menu's player name inputs.

export function showMenuScreen(): void {
  // The match keeps running on the host; offer a way back unless it is already over.
  el.menuResumeBtn.classList.toggle("hidden", !store.current || store.current.phase === "ended");
  el.menuScreen.classList.remove("hidden");
  el.gameScreen.classList.add("hidden");
  stopPlayback();
  hideGuideOverlay();
  // Responses already in flight (playback ticks) must not pop the game screen back open over the menu.
  store.appliedSeq = ++store.requestSeq;
}

export function showGameScreen(): void {
  el.menuScreen.classList.add("hidden");
  el.gameScreen.classList.remove("hidden");
}

export function renderMenuPlayerInputs(): void {
  const count = Number(el.menuPlayerCount.value);
  store.menuPlayers = Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    inputId: `menuPlayerName${index + 1}`,
    defaultName: `Player ${index + 1}`
  }));

  el.menuPlayerNames.replaceChildren(...store.menuPlayers.map((player, index) => {
    const row = document.createElement("div");
    row.className = "menu-player";
    const swatch = document.createElement("span");
    swatch.className = `swatch ${player.id}`;
    swatch.setAttribute("aria-hidden", "true");
    swatch.textContent = String(index + 1);
    const label = document.createElement("label");
    label.className = "sr-only";
    label.htmlFor = player.inputId;
    label.textContent = `${player.id.toUpperCase()} Name`;
    const input = document.createElement("input");
    input.id = player.inputId;
    input.maxLength = MAX_PLAYER_NAME_LENGTH;
    input.value = player.defaultName;
    row.append(swatch, label, input);
    return row;
  }));
}

export function menuPlayersToSetupPlayers(): MatchSetup["players"] {
  return store.menuPlayers.map((player, index) => {
    const element = must<HTMLInputElement>(player.inputId);
    const name = element.value.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    return {
      id: `p${index + 1}`,
      name: name.length > 0 ? name : player.defaultName
    };
  });
}
