import type { UpgradeTrack } from "@tower-defense/shared";
import { APP_TEMPLATE } from "./template";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("Missing app root.");
}
appRoot.innerHTML = APP_TEMPLATE;
export const app: HTMLDivElement = appRoot;

export function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

export const el = {
  menuScreen: must<HTMLElement>("menuScreen"),
  gameScreen: must<HTMLElement>("gameScreen"),
  menuSeed: must<HTMLInputElement>("menuSeed"),
  menuPlayerCount: must<HTMLSelectElement>("menuPlayerCount"),
  menuAiPlayers: must<HTMLInputElement>("menuAiPlayers"),
  menuPlayerNames: must<HTMLElement>("menuPlayerNames"),
  menuMessage: must<HTMLElement>("menuMessage"),
  menuSettingsBtn: must<HTMLButtonElement>("menuSettingsBtn"),
  settingsBtn: must<HTMLButtonElement>("settingsBtn"),
  menuStartBtn: must<HTMLButtonElement>("menuStartBtn"),
  menuRefreshBtn: must<HTMLButtonElement>("menuRefreshBtn"),
  menuResumeBtn: must<HTMLButtonElement>("menuResumeBtn"),
  wavePreview: must<HTMLElement>("wavePreview"),
  playerId: must<HTMLSelectElement>("playerId"),
  x: must<HTMLInputElement>("x"),
  y: must<HTMLInputElement>("y"),
  mode: must<HTMLSelectElement>("mode"),
  damageType: must<HTMLSelectElement>("damageType"),
  playerCards: must<HTMLElement>("playerCards"),
  phaseBanner: must<HTMLElement>("phaseBanner"),
  phaseLabel: must<HTMLElement>("phaseLabel"),
  phaseSub: must<HTMLElement>("phaseSub"),
  playbackControls: must<HTMLElement>("playbackControls"),
  playPauseBtn: must<HTMLButtonElement>("playPauseBtn"),
  placeWallBtn: must<HTMLButtonElement>("placeWallBtn"),
  shortcutBar: must<HTMLElement>("shortcutBar"),
  overlay: must<HTMLElement>("matchEndOverlay"),
  overlaySummary: must<HTMLElement>("matchEndSummary"),
  overlayScores: must<HTMLElement>("matchEndScores"),
  rematchBtn: must<HTMLButtonElement>("rematchBtn"),
  guideOverlay: must<HTMLElement>("guideOverlay"),
  guideCard: must<HTMLElement>("guideCard"),
  guideTitle: must<HTMLElement>("guideTitle"),
  guideBody: must<HTMLElement>("guideBody"),
  guideActionBtn: must<HTMLButtonElement>("guideActionBtn"),
  guideCloseBtn: must<HTMLButtonElement>("guideCloseBtn"),
  status: must<HTMLElement>("status"),
  placeTowerBtn: must<HTMLButtonElement>("placeTowerBtn"),
  readyBtn: must<HTMLButtonElement>("readyBtn"),
  moveTowerBtn: must<HTMLButtonElement>("moveTowerBtn"),
  moveTowerCost: must<HTMLElement>("moveTowerCost"),
  upgradeBtns: {
    range: must<HTMLButtonElement>("upgradeRangeBtn"),
    damage: must<HTMLButtonElement>("upgradeDamageBtn"),
    accuracy: must<HTMLButtonElement>("upgradeAccuracyBtn")
  } as Record<UpgradeTrack, HTMLButtonElement>,
  wallCost: must<HTMLElement>("wallCost"),
  upgradeCosts: {
    range: must<HTMLElement>("upgradeRangeCost"),
    damage: must<HTMLElement>("upgradeDamageCost"),
    accuracy: must<HTMLElement>("upgradeAccuracyCost")
  } as Record<UpgradeTrack, HTMLElement>,
  waveBanner: must<HTMLElement>("waveBanner"),
  turnBanner: must<HTMLElement>("turnBanner"),
  demoBtn: must<HTMLButtonElement>("demoBtn"),
  feedbackQueue: must<HTMLElement>("feedbackQueue"),
  board: must<HTMLElement>("board"),
  snapshot: must<HTMLTextAreaElement>("snapshot"),
  battlefieldMeta: must<HTMLElement>("battlefieldMeta")
};
