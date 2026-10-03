import { WIN_SCORE } from "@tower-defense/shared";
import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import { el } from "./dom";
import { playerNumber, towerColorClass } from "./player-util";
import { store } from "./state";
import type { PlayerChipRefs } from "./state";

// Active-player dropdown and the scoreboard chips.

// Clicking a chip switches the active player; that logic lives higher up and is plugged in at startup.
let chipSelectHandler: (playerId: string) => void = () => {};

export function setChipSelectHandler(handler: (playerId: string) => void): void {
  chipSelectHandler = handler;
}

export function pickDefaultPlayer(snapshot: MatchSnapshot | null): string {
  if (!snapshot || snapshot.players.length === 0) {
    return "";
  }
  // The first human; a bots-only match has nobody to act for, so the first seat is shown.
  return (snapshot.players.find((player) => !player.ai) ?? snapshot.players[0])?.id ?? "";
}

export function updatePlayerOptions(snapshot: MatchSnapshot | null): void {
  const players = snapshot?.players ?? [];
  const signature = players.map((player) => `${player.id}:${player.name}`).join("|");
  if (signature === store.playerSignature) {
    return;
  }
  store.playerSignature = signature;

  const previous = el.playerId.value;
  el.playerId.replaceChildren();
  for (const player of players) {
    const option = document.createElement("option");
    option.value = player.id;
    option.textContent = `${player.id} (${player.name})`;
    el.playerId.append(option);
  }
  if (players.some((player) => player.id === previous)) {
    el.playerId.value = previous;
  } else {
    el.playerId.value = pickDefaultPlayer(snapshot);
  }
}

export function buildPlayerChip(player: MatchSnapshot["players"][number], towerId: string | null): PlayerChipRefs {
  const root = document.createElement("div");
  root.className = "player-chip";
  // Mouse users can click anywhere on the chip; keyboard and assistive tech use the real button around the name.
  // The chip itself is not a button so the nested health progressbar keeps its accessibility semantics.
  root.addEventListener("click", () => chipSelectHandler(player.id));
  const swatch = document.createElement("div");
  swatch.className = "chip-swatch";
  swatch.textContent = String(playerNumber(player.id));
  swatch.setAttribute("aria-hidden", "true");
  const body = document.createElement("div");
  body.className = "chip-body";
  const top = document.createElement("div");
  top.className = "chip-top";
  const name = document.createElement("button");
  name.type = "button";
  name.className = "player-chip-name";
  const state = document.createElement("span");
  state.className = "chip-state";
  if (player.ai) {
    const badge = document.createElement("span");
    badge.className = "chip-bot";
    badge.textContent = "BOT";
    badge.title = `${player.ai} bot`;
    top.append(name, badge, state);
  } else {
    top.append(name, state);
  }
  const scoreRow = document.createElement("div");
  scoreRow.className = "chip-score";
  const points = document.createElement("span");
  points.className = "chip-points";
  const goal = document.createElement("div");
  goal.className = "goal-bar";
  goal.title = `Goal: ${WIN_SCORE} points`;
  const goalFill = document.createElement("i");
  goal.append(goalFill);
  scoreRow.append(points, goal);
  const meta = document.createElement("div");
  meta.className = "player-chip-meta";
  body.append(top, scoreRow, meta);
  root.append(swatch, body);
  let bar: HTMLElement | null = null;
  let barFill: HTMLElement | null = null;
  if (towerId) {
    bar = document.createElement("div");
    bar.className = "tower-hp-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${player.name} tower health`);
    bar.setAttribute("aria-valuemin", "0");
    barFill = document.createElement("i");
    bar.append(barFill);
    body.append(bar);
  }
  return { root, name, state, points, goalFill, meta, bar, barFill };
}

// Chips are created once per (player, tower) and updated in place so HP bar transitions and pulses survive snapshots.
export function renderPlayerCards(snapshot: MatchSnapshot | null, newEvents: MatchEvent[] = []): void {
  if (!snapshot) {
    store.playerChips = new Map();
    el.playerCards.textContent = "No active match";
    return;
  }

  const towersByPlayer = new Map(snapshot.towers.map((tower) => [tower.playerId, tower]));
  const repairedTowerIds = new Set(
    newEvents.filter((event) => event.type === "tower-repaired").map((event) => event.towerId)
  );
  const structure = snapshot.players.map((player) => `${player.id}:${towersByPlayer.has(player.id) ? 1 : 0}:${player.ai ?? ""}`).join("|");
  if (structure !== store.chipStructureSignature) {
    store.chipStructureSignature = structure;
    store.playerChips = new Map();
    el.playerCards.textContent = "";
    for (const player of snapshot.players) {
      const tower = towersByPlayer.get(player.id);
      const refs = buildPlayerChip(player, tower?.id ?? null);
      store.playerChips.set(player.id, refs);
      el.playerCards.append(refs.root);
    }
  }

  for (const player of snapshot.players) {
    const refs = store.playerChips.get(player.id);
    if (!refs) {
      continue;
    }
    const tower = towersByPlayer.get(player.id);
    const towerStatus = tower ? `Tower ${tower.health}/${tower.maxHealth}` : "Tower not placed";
    let status = "waiting";
    let label = "WAITING";
    if (player.eliminated) {
      status = "eliminated";
      label = "ELIMINATED";
    } else if (snapshot.phase === "wave") {
      status = "fighting";
      label = "FIGHTING";
    } else if (!player.hasPlacedTower) {
      label = "PLACING";
    } else if (player.readyForWave) {
      status = "ready";
      label = "READY";
    }

    const isActive = player.id === el.playerId.value;
    const className = `player-chip ${status} ${towerColorClass(player.id)}${isActive ? " active" : ""}`;
    if (isActive) {
      refs.name.setAttribute("aria-current", "true");
    } else {
      refs.name.removeAttribute("aria-current");
    }
    refs.root.title = player.ai ? `View ${player.name} (${playerNumber(player.id)}), a ${player.ai} bot` : `Switch to ${player.name} (${playerNumber(player.id)})`;
    if (refs.root.className !== className) {
      refs.root.className = className;
    }
    if (tower) {
      refs.root.dataset.towerId = tower.id;
    } else {
      delete refs.root.dataset.towerId;
    }
    if (refs.name.textContent !== player.name) {
      refs.name.textContent = player.name;
    }
    if (refs.state.textContent !== label) {
      refs.state.textContent = label;
    }
    const pointsText = `${player.points} pts`;
    if (refs.points.textContent !== pointsText) {
      refs.points.textContent = pointsText;
    }
    refs.goalFill.style.width = `${Math.min(100, (player.points / WIN_SCORE) * 100)}%`;
    if (refs.meta.textContent !== towerStatus) {
      refs.meta.textContent = towerStatus;
    }

    if (tower && refs.bar && refs.barFill) {
      const ratio = tower.maxHealth > 0 ? tower.health / tower.maxHealth : 0;
      refs.bar.setAttribute("aria-valuemax", String(tower.maxHealth));
      refs.bar.setAttribute("aria-valuenow", String(tower.health));
      refs.barFill.style.width = `${ratio * 100}%`;
      refs.bar.dataset.level = ratio > 0.6 ? "high" : ratio > 0.3 ? "mid" : "low";
      if (repairedTowerIds.has(tower.id)) {
        // Restart the animation if a previous pulse class is still present.
        refs.bar.classList.remove("repair-pulse");
        void refs.bar.offsetWidth;
        refs.bar.classList.add("repair-pulse");
      } else {
        refs.bar.classList.remove("repair-pulse");
      }
    }
  }
}
