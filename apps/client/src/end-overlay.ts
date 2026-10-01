import type { MatchSnapshot } from "@tower-defense/shared";
import { el, must } from "./dom";
import { store } from "./state";

// Match-end modal: scores, focus handling and making the page behind it inert.

export function isEndOverlayOpen(): boolean {
  return el.overlay.style.display === "flex";
}

// aria-modal alone does not stop Tab or screen readers reaching the page behind, so the siblings are made inert.
export function setEndOverlayBackgroundInert(on: boolean): void {
  if (on) {
    store.endOverlayInerted = [...(el.overlay.parentElement?.children ?? [])].filter((node) => node !== el.overlay && !node.hasAttribute("inert"));
    store.endOverlayInerted.forEach((node) => node.setAttribute("inert", ""));
  } else {
    store.endOverlayInerted.forEach((node) => node.removeAttribute("inert"));
    store.endOverlayInerted = [];
  }
}

export function hideEndOverlay(): void {
  if (!isEndOverlayOpen()) {
    return;
  }
  el.overlay.style.display = "none";
  setEndOverlayBackgroundInert(false);
  const target = store.endOverlayOpener && store.endOverlayOpener.isConnected ? store.endOverlayOpener : el.settingsBtn;
  store.endOverlayOpener = null;
  target.focus();
}

export function renderEndOverlay(snapshot: MatchSnapshot | null): void {
  if (!snapshot || snapshot.phase !== "ended") {
    store.endOverlayDismissed = false;
    hideEndOverlay();
    el.overlay.style.display = "none";
    return;
  }

  const winner = snapshot.players.find((player) => player.id === snapshot.winnerId);
  const winnerText = winner
    ? `${winner.name} (${winner.id})`
    : (snapshot.winnerId ?? "none");

  el.overlaySummary.textContent = `${winnerText} secured the win${snapshot.endReason ? ` • ${snapshot.endReason}` : ""}.`;

  const ranked = [...snapshot.players].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  // Names are user input: build text nodes, never parse them as HTML.
  el.overlayScores.replaceChildren(...ranked.flatMap((player) => {
    const name = document.createElement("div");
    name.textContent = player.name;
    const points = document.createElement("div");
    points.textContent = `${player.points} pts`;
    return [name, points];
  }));

  if (store.endOverlayDismissed || isEndOverlayOpen()) {
    return;
  }
  store.endOverlayOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  el.overlay.style.display = "flex";
  setEndOverlayBackgroundInert(true);
  must<HTMLButtonElement>("rematchBtn").focus();
}

export function closeOverlay(): void {
  store.endOverlayDismissed = true;
  hideEndOverlay();
  el.overlay.style.display = "none";
}
