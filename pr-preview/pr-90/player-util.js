import { PLAYER_COLORS } from "./constants";
import { el } from "./dom";
import { store } from "./state";
// Small helpers that map the selected player and player ids to tower ids, colours and seat numbers.
export function playerTowerId(playerId) {
    return `tower-${playerId}`;
}
export function towerColorClass(playerId) {
    const index = Number(playerId.replace(/\D+/g, "")) - 1;
    return PLAYER_COLORS[Math.max(0, Math.min(PLAYER_COLORS.length - 1, index))] ?? "p1";
}
export function playerNumber(playerId) {
    return Number(playerId.replace(/\D+/g, "")) || 1;
}
export function selectedPlayerId() {
    const value = String(el.playerId.value || "").trim();
    if (!value) {
        const fallback = store.current?.players[0]?.id ?? "";
        if (fallback) {
            el.playerId.value = fallback;
            return fallback;
        }
    }
    return value;
}
