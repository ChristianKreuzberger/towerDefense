import { MAX_TOWER_LEVEL, TOWER_MOVE_AFTER_WAVES, UPGRADE_TRACKS } from "@tower-defense/shared";
// Label in the cost slot plus the sentence a press explains when the button is off, both from state (never from DOM text).
function moveInfo(input) {
    if (input.phase !== "placement" || input.upgrades === null || input.eliminated) {
        return { label: "-", hint: "You can only move your tower during prep" };
    }
    // Before the token check: the simulation reports no move for a ready player, so the snapshot cannot tell used from ready.
    if (input.readyForWave && input.wave > TOWER_MOVE_AFTER_WAVES) {
        return { label: "ready", hint: "You can only move your tower before you ready up (if you have not used your free move yet)" };
    }
    if (input.towerMoveAvailable) {
        return { label: "free", hint: "" };
    }
    return input.wave <= TOWER_MOVE_AFTER_WAVES
        ? { label: `after R${TOWER_MOVE_AFTER_WAVES}`, hint: `Moving your tower unlocks after round ${TOWER_MOVE_AFTER_WAVES}` }
        : { label: "used", hint: "You already used your free tower move" };
}
// Mirrors what the simulation accepts, so a control looks usable only when its command would be accepted.
export function getToolbarState(input) {
    const hasLivingTower = input.upgrades !== null && !input.eliminated && !input.bot;
    const canBuyNow = hasLivingTower && input.phase === "placement" && !input.readyForWave;
    const upgrades = {};
    for (const track of UPGRADE_TRACKS) {
        const maxed = input.upgrades !== null && input.upgrades[track] >= MAX_TOWER_LEVEL;
        upgrades[track] = { maxed, enabled: canBuyNow && !maxed };
    }
    return {
        upgrades,
        targetModeEnabled: hasLivingTower && input.phase !== "ended",
        // Same window as upgrades: the simulation only accepts set-damage-type in prep before the player is ready.
        damageTypeEnabled: canBuyNow,
        readyEnabled: canBuyNow,
        placeTowerEnabled: input.upgrades === null && !input.eliminated && !input.bot && input.phase === "placement",
        moveEnabled: input.towerMoveAvailable && canBuyNow,
        moveLabel: moveInfo(input).label,
        moveHint: moveInfo(input).hint
    };
}
