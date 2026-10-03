import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import type { WireSnapshot } from "@tower-defense/transport/wire-types";
import { cuesForSnapshotChange } from "./audio/index";
import { renderSnapshot, syncCursorToTowerSpot, updateBattlefield } from "./board";
import { MANUAL_TRANSITION_MS, MAX_FX_EVENT_BACKLOG } from "./constants";
import { renderEndOverlay } from "./end-overlay";
import { addFeedback } from "./feedback";
import { syncGuideOverlay } from "./guide";
import { hydrateSnapshot } from "./hydrate";
import { showGameScreen } from "./menu";
import { perfTimeApply } from "./perf";
import { announceWaveEnd, renderPhase } from "./phase";
import { msPerTick } from "./playback";
import { renderPlayerCards, updatePlayerOptions } from "./scoreboard";
import { soundEngine } from "./services";
import { store } from "./state";
import { renderToolbar } from "./toolbar";
import { resetTurnAfterWave } from "./turns";

// Applies a host response unless a newer one was already applied. Returns false when a full refetch is needed.
export function applyWireSnapshot(wire: WireSnapshot, seq: number): boolean {
  if (seq < store.appliedSeq) {
    return true;
  }
  const hydrated = hydrateSnapshot(wire);
  if (!hydrated) {
    return false;
  }
  store.appliedSeq = seq;
  applySnapshot(hydrated.snapshot, hydrated.newEvents);
  return true;
}

export function applySnapshot(snapshot: MatchSnapshot, newEvents: MatchEvent[]): void {
  perfTimeApply(() => applySnapshotInner(snapshot, newEvents));
}

export function applySnapshotInner(snapshot: MatchSnapshot, newEvents: MatchEvent[]): void {
  const previous = store.current;
  store.current = snapshot;
  // Real ticks between snapshots set how long creatures glide; anything else (new wave, rewind) snaps quickly.
  const ticksElapsed = previous && previous.wave === snapshot.wave && previous.phase === "wave" && snapshot.phase === "wave"
    ? snapshot.waveTick - previous.waveTick
    : 0;
  const glideMs = ticksElapsed > 0 ? ticksElapsed * msPerTick() : MANUAL_TRANSITION_MS;

  // A fresh load or reconnect delivers the whole event history; replaying that as toasts or effects would be noise.
  const fxEvents = previous !== null && newEvents.length <= MAX_FX_EVENT_BACKLOG ? newEvents : [];
  announceRepairEvents(snapshot, fxEvents);
  soundEngine.playCues(
    cuesForSnapshotChange({ previous, next: snapshot, events: fxEvents, suppress: previous === null || newEvents.length > MAX_FX_EVENT_BACKLOG }),
    glideMs
  );
  showGameScreen();
  updatePlayerOptions(store.current);
  syncCursorToTowerSpot(store.current);
  updateBattlefield(store.current, glideMs, fxEvents);
  announceWaveEnd(fxEvents);
  resetTurnAfterWave(previous, snapshot);
  renderToolbar(store.current);
  renderPlayerCards(store.current, newEvents);
  renderPhase(store.current);
  renderEndOverlay(store.current);
  renderSnapshot(store.current);
  syncGuideOverlay(store.current);
}

export function announceRepairEvents(snapshot: MatchSnapshot, events: MatchSnapshot["events"]): void {
  const playerNames = new Map(snapshot.players.map((player) => [player.id, player.name]));
  for (const event of events) {
    if (event.type === "tower-repaired") {
      const playerName = playerNames.get(event.playerId) ?? event.playerId;
      const tower = snapshot.towers.find((entry) => entry.id === event.towerId);
      const maxHealth = tower?.maxHealth ?? event.remainingHp;
      addFeedback("info", `${playerName} tower repaired +${event.repairAmount} HP (${event.remainingHp}/${maxHealth})`);
      continue;
    }

    if (event.type === "path-repaired") {
      addFeedback("info", `Path wear repaired on ${event.repairs.length} cell${event.repairs.length === 1 ? "" : "s"}`);
      continue;
    }

    if (event.type === "wave-clear-bonus") {
      const playerName = playerNames.get(event.playerId) ?? event.playerId;
      const clearLabel = event.cleared ? "full clear" : "wave completed";
      addFeedback("accepted", `${playerName} earned wave-clear bonus +${event.bonus} pts (${clearLabel})`);
      continue;
    }

    if (event.type === "catch-up-bonus") {
      const playerName = playerNames.get(event.playerId) ?? event.playerId;
      addFeedback("accepted", `${playerName} earned catch-up bonus +${event.bonus} pts (${event.gap} behind the leader)`);
    }
  }
}
