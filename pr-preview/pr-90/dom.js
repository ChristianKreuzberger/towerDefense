import { APP_TEMPLATE } from "./template";
const appRoot = document.querySelector("#app");
if (!appRoot) {
    throw new Error("Missing app root.");
}
appRoot.innerHTML = APP_TEMPLATE;
export const app = appRoot;
export function must(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing element: ${id}`);
    }
    return element;
}
export const el = {
    menuScreen: must("menuScreen"),
    gameScreen: must("gameScreen"),
    menuSeed: must("menuSeed"),
    menuPlayerCount: must("menuPlayerCount"),
    menuAiPlayers: must("menuAiPlayers"),
    menuPlayerNames: must("menuPlayerNames"),
    menuMessage: must("menuMessage"),
    menuSettingsBtn: must("menuSettingsBtn"),
    settingsBtn: must("settingsBtn"),
    menuTourBtn: must("menuTourBtn"),
    tourBtn: must("tourBtn"),
    menuStartBtn: must("menuStartBtn"),
    menuRefreshBtn: must("menuRefreshBtn"),
    menuResumeBtn: must("menuResumeBtn"),
    wavePreview: must("wavePreview"),
    playerId: must("playerId"),
    x: must("x"),
    y: must("y"),
    mode: must("mode"),
    damageType: must("damageType"),
    playerCards: must("playerCards"),
    phaseBanner: must("phaseBanner"),
    phaseLabel: must("phaseLabel"),
    phaseSub: must("phaseSub"),
    playbackControls: must("playbackControls"),
    playPauseBtn: must("playPauseBtn"),
    shortcutBar: must("shortcutBar"),
    overlay: must("matchEndOverlay"),
    overlaySummary: must("matchEndSummary"),
    overlayScores: must("matchEndScores"),
    rematchBtn: must("rematchBtn"),
    guideOverlay: must("guideOverlay"),
    guideCard: must("guideCard"),
    guideTitle: must("guideTitle"),
    guideBody: must("guideBody"),
    guideActionBtn: must("guideActionBtn"),
    guideCloseBtn: must("guideCloseBtn"),
    status: must("status"),
    placeTowerBtn: must("placeTowerBtn"),
    readyBtn: must("readyBtn"),
    moveTowerBtn: must("moveTowerBtn"),
    moveTowerCost: must("moveTowerCost"),
    upgradeBtns: {
        range: must("upgradeRangeBtn"),
        damage: must("upgradeDamageBtn"),
        accuracy: must("upgradeAccuracyBtn")
    },
    upgradeCosts: {
        range: must("upgradeRangeCost"),
        damage: must("upgradeDamageCost"),
        accuracy: must("upgradeAccuracyCost")
    },
    waveBanner: must("waveBanner"),
    turnBanner: must("turnBanner"),
    demoBtn: must("demoBtn"),
    feedbackQueue: must("feedbackQueue"),
    board: must("board"),
    snapshot: must("snapshot"),
    battlefieldMeta: must("battlefieldMeta"),
    towerMenu: must("towerMenu"),
    towerMenuTitle: must("towerMenuTitle"),
    towerMenuClose: must("towerMenuClose"),
    zoomInBtn: must("zoomInBtn"),
    zoomOutBtn: must("zoomOutBtn"),
    zoomFitBtn: must("zoomFitBtn"),
    mobileMoreBtn: must("mobileMoreBtn"),
    controlPanel: must("controlPanel")
};
