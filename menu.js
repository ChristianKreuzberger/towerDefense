import { AI_DIFFICULTIES, MAX_PLAYER_NAME_LENGTH, MAX_PLAYERS, isValidAiDifficulty } from "@tower-defense/shared";
import { botName, clampPlayerCounts, seatsToSetupPlayers } from "./bot-text";
import { el, must } from "./dom";
import { hideGuideOverlay } from "./guide";
import { stopPlayback } from "./playback";
import { store } from "./state";
// Menu and game screens, and the menu's player name inputs.
export function showMenuScreen() {
    // The match keeps running on the host; offer a way back unless it is already over.
    el.menuResumeBtn.classList.toggle("hidden", !store.current || store.current.phase === "ended");
    el.menuScreen.classList.remove("hidden");
    el.gameScreen.classList.add("hidden");
    stopPlayback();
    hideGuideOverlay();
    // Responses already in flight (playback ticks) must not pop the game screen back open over the menu.
    store.appliedSeq = ++store.requestSeq;
}
export function showGameScreen() {
    el.menuScreen.classList.add("hidden");
    el.gameScreen.classList.remove("hidden");
}
const DEFAULT_BOT_DIFFICULTY = "medium";
function difficultyLabel(difficulty) {
    return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}
// The two count selects share the 8-seat limit: options that would exceed it are disabled.
function syncCountOptions(humans, bots) {
    el.menuPlayerCount.value = String(humans);
    el.menuAiPlayers.value = String(bots);
    for (const option of el.menuPlayerCount.options) {
        option.disabled = Number(option.value) > MAX_PLAYERS - bots;
    }
    for (const option of el.menuAiPlayers.options) {
        option.disabled = Number(option.value) > MAX_PLAYERS - humans;
    }
}
export function renderMenuPlayerInputs() {
    // Re-rendering keeps what was already typed or chosen for the seats that stay.
    const kept = new Map();
    for (const player of store.menuPlayers) {
        const value = document.getElementById(player.botSelectId ?? player.inputId);
        if (value instanceof HTMLInputElement || value instanceof HTMLSelectElement) {
            kept.set(player.botSelectId ?? player.inputId, value.value);
        }
    }
    const { humans, bots } = clampPlayerCounts(Number(el.menuPlayerCount.value), Number(el.menuAiPlayers.value));
    syncCountOptions(humans, bots);
    store.menuPlayers = Array.from({ length: humans + bots }, (_, index) => {
        const isBot = index >= humans;
        return {
            id: `p${index + 1}`,
            inputId: `menuPlayerName${index + 1}`,
            defaultName: isBot ? botName(index - humans + 1) : `Player ${index + 1}`,
            ...(isBot ? { botSelectId: `menuBotDifficulty${index + 1}` } : {})
        };
    });
    el.menuPlayerNames.replaceChildren(...store.menuPlayers.map((player, index) => {
        const row = document.createElement("div");
        row.className = "menu-player";
        const swatch = document.createElement("span");
        swatch.className = `swatch ${player.id}`;
        swatch.setAttribute("aria-hidden", "true");
        swatch.textContent = String(index + 1);
        const label = document.createElement("label");
        label.className = "sr-only";
        if (player.botSelectId) {
            label.htmlFor = player.botSelectId;
            label.textContent = `${player.defaultName} difficulty`;
            const name = document.createElement("span");
            name.className = "menu-bot-name";
            name.textContent = player.defaultName;
            const select = document.createElement("select");
            select.id = player.botSelectId;
            for (const difficulty of AI_DIFFICULTIES) {
                const option = document.createElement("option");
                option.value = difficulty;
                option.textContent = difficultyLabel(difficulty);
                select.append(option);
            }
            const previous = kept.get(player.botSelectId);
            select.value = isValidAiDifficulty(previous) ? previous : DEFAULT_BOT_DIFFICULTY;
            row.append(swatch, label, name, select);
            return row;
        }
        label.htmlFor = player.inputId;
        label.textContent = `${player.id.toUpperCase()} Name`;
        const input = document.createElement("input");
        input.id = player.inputId;
        input.maxLength = MAX_PLAYER_NAME_LENGTH;
        input.value = kept.get(player.inputId) ?? player.defaultName;
        row.append(swatch, label, input);
        return row;
    }));
}
export function menuPlayersToSetupPlayers() {
    return seatsToSetupPlayers(store.menuPlayers.map((player) => {
        if (player.botSelectId) {
            const value = must(player.botSelectId).value;
            return { kind: "bot", ai: isValidAiDifficulty(value) ? value : DEFAULT_BOT_DIFFICULTY };
        }
        return { kind: "human", name: must(player.inputId).value, defaultName: player.defaultName };
    }));
}
