import type { MatchEvent, MatchSnapshot } from "@tower-defense/shared";
import { BANNER_LIFETIME_MS, TURN_BANNER_LIFETIME_MS } from "./constants";
import { el } from "./dom";
import { startPlayback, stopPlayback } from "./playback";
import { towerColorClass } from "./player-util";
import { store } from "./state";
import { formatWavePreview } from "./wave-preview";

// Phase banner, wave/turn banners and the wave preview line.

export function showWaveBanner(title: string, sub: string): void {
  const strong = el.waveBanner.querySelector("strong");
  const span = el.waveBanner.querySelector("span");
  if (strong) strong.textContent = title;
  if (span) span.textContent = sub;
  el.waveBanner.classList.remove("show");
  void el.waveBanner.offsetWidth;
  el.waveBanner.classList.add("show");
  if (store.bannerTimer !== null) {
    clearTimeout(store.bannerTimer);
  }
  store.bannerTimer = setTimeout(() => el.waveBanner.classList.remove("show"), BANNER_LIFETIME_MS);
}

export function showTurnBanner(player: { id: string; name: string }): void {
  const strong = el.turnBanner.querySelector("strong");
  const span = el.turnBanner.querySelector("span");
  if (strong) strong.textContent = player.name;
  if (span) span.textContent = "it's your turn";
  el.turnBanner.style.setProperty("--turn-color", `var(--${towerColorClass(player.id)})`);
  el.turnBanner.classList.remove("show");
  void el.turnBanner.offsetWidth;
  el.turnBanner.classList.add("show");
  if (store.turnBannerTimer !== null) {
    clearTimeout(store.turnBannerTimer);
  }
  store.turnBannerTimer = setTimeout(() => el.turnBanner.classList.remove("show"), TURN_BANNER_LIFETIME_MS);
}

export function announceWaveEnd(events: MatchEvent[]): void {
  const end = events.find((event) => event.type === "wave-end");
  if (!end) {
    return;
  }
  const bonus = events.find((event) => event.type === "wave-clear-bonus");
  const sub = bonus && bonus.type === "wave-clear-bonus" ? `Full clear: +${bonus.bonus} points each` : "Towers repaired, prepare the next wave";
  showWaveBanner(`Wave ${end.wave} ${bonus ? "cleared" : "complete"}`, sub);
}

export function phaseSubText(snapshot: MatchSnapshot): string {
  if (snapshot.phase === "placement") {
    const repairEvents = snapshot.events.filter(
      (event) => event.type === "tower-repaired" || event.type === "path-repaired"
    );
    const latestRepairWave = repairEvents.at(-1)?.wave;
    if (latestRepairWave !== undefined && latestRepairWave === snapshot.wave - 1) {
      const repairCount = repairEvents.filter((event) => event.wave === latestRepairWave).length;
      return `Round ${latestRepairWave} complete. Automatic repairs applied (${repairCount} update${repairCount === 1 ? "" : "s"}).`;
    }

    const unplaced = snapshot.players.filter((player) => !player.hasPlacedTower);
    if (unplaced.length > 0) {
      const names = unplaced.map((player) => player.name).slice(0, 2).join(", ");
      const suffix = unplaced.length > 2 ? ", …" : "";
      return `Waiting on ${names}${suffix}. Place your tower to keep the setup moving.`;
    }

    return "All towers are set. Buy upgrades now, then lock in readiness to start the first wave.";
  }

  if (snapshot.phase === "wave") {
    return "Combat is live. Use target modes to hold the lane.";
  }

  if (snapshot.phase === "ended") {
    const winnerName = snapshot.players.find((player) => player.id === snapshot.winnerId)?.name ?? snapshot.winnerId;
    return winnerName
      ? `Winner ${winnerName} • ${snapshot.endReason ?? "match concluded"}`
      : "No winner • the match ended in a draw-like state.";
  }

  return "Prepare for the next round.";
}

export function renderPhase(snapshot: MatchSnapshot | null): void {
  if (!snapshot) {
    el.phaseBanner.className = "phase-banner";
    el.phaseLabel.textContent = "NO MATCH";
    el.phaseSub.textContent = "Start a local match to play.";
    el.wavePreview.textContent = "";
    el.shortcutBar.style.display = "flex";
    el.playbackControls.classList.add("hidden");
    stopPlayback();
    return;
  }

  let label = "PLACEMENT PHASE";
  const sub = phaseSubText(snapshot);
  el.phaseBanner.className = "phase-banner";

  if (snapshot.phase === "wave") {
    el.phaseBanner.classList.add("wave");
    label = `WAVE ${snapshot.wave} COMBAT`;
  }

  if (snapshot.phase === "ended") {
    el.phaseBanner.classList.add("ended");
    label = "MATCH ENDED";
  }

  el.phaseLabel.textContent = label;
  el.phaseSub.textContent = sub;
  // The element is an aria-live region: rewriting identical text can make screen readers announce it again.
  const preview = snapshot.phase === "placement" ? formatWavePreview(snapshot.wave) : "";
  if (el.wavePreview.textContent !== preview) {
    el.wavePreview.textContent = preview;
    // The row is one line with an ellipsis (fixed height, so the board never moves); the tooltip has the full text.
    el.wavePreview.title = preview;
  }
  el.shortcutBar.style.display = snapshot.phase === "ended" ? "none" : "flex";

  if (snapshot.phase === "wave") {
    el.playbackControls.classList.remove("hidden");
    startPlayback();
  } else {
    el.playbackControls.classList.add("hidden");
    stopPlayback();
  }
}
