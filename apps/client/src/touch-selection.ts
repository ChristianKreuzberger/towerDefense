import { battlefieldMount } from "./board";
import { el } from "./dom";

// Touch placement is select, then confirm (spec/11). Compact layout or a coarse pointer means a finger.
const touchQuery = "(max-width: 1040px), (pointer: coarse)";
let selectedSpot: { x: number; y: number } | null = null;

export function isTouchMode(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(touchQuery).matches;
}

export function getSelectedSpot(): { x: number; y: number } | null {
  return selectedSpot;
}

export function setSelectedSpot(spot: { x: number; y: number } | null): void {
  selectedSpot = spot;
  battlefieldMount.previewCell(spot?.x ?? null, spot?.y ?? null);
  const label = el.placeTowerBtn.querySelector(".tool-label");
  if (label) {
    label.textContent = spot ? "Place here" : "Place Tower";
  }
}

// A selection belongs to one player on one match: drop it when either changes.
export function resetTouchSelection(): void {
  setSelectedSpot(null);
}
