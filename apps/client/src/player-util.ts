import { PLAYER_COLORS } from "./constants";
import { el } from "./dom";
import { store } from "./state";
// Small helpers that map the selected player and player ids to tower ids, colours and seat numbers.

export function playerTowerId(playerId: string): string {
  return `tower-${playerId}`;
}

export function towerColorClass(playerId: string): string {
  const index = Number(playerId.replace(/\D+/g, "")) - 1;
  return PLAYER_COLORS[Math.max(0, Math.min(PLAYER_COLORS.length - 1, index))] ?? "p1";
}

export function playerNumber(playerId: string): number {
  return Number(playerId.replace(/\D+/g, "")) || 1;
}

export function selectedPlayerId(): string {
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
