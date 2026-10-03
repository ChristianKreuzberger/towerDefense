import test from "node:test";
import assert from "node:assert/strict";
import { MAX_TOWER_LEVEL } from "@tower-defense/shared";
import { getToolbarState } from "./toolbar-state.js";
const base = { range: 1, damage: 1, accuracy: 1 };
const prep = { phase: "placement", upgrades: base, eliminated: false, readyForWave: false, towerMoveAvailable: false, wave: 1 };
const none = { enabled: false, maxed: false };
test("prep: every upgrade track and target mode are enabled", () => {
    const state = getToolbarState(prep);
    assert.deepEqual(state.upgrades, {
        range: { enabled: true, maxed: false },
        damage: { enabled: true, maxed: false },
        accuracy: { enabled: true, maxed: false }
    });
    assert.equal(state.targetModeEnabled, true);
});
test("prep after readying: upgrades lock but target mode stays available", () => {
    const state = getToolbarState({ ...prep, readyForWave: true });
    assert.deepEqual(state.upgrades, { range: none, damage: none, accuracy: none });
    assert.equal(state.targetModeEnabled, true);
});
test("wave: target mode is enabled, upgrades are not", () => {
    const state = getToolbarState({ ...prep, phase: "wave", readyForWave: true });
    assert.equal(state.targetModeEnabled, true);
    assert.deepEqual(state.upgrades, { range: none, damage: none, accuracy: none });
});
test("only the maxed track is disabled and reported as maxed", () => {
    const state = getToolbarState({ ...prep, upgrades: { ...base, damage: MAX_TOWER_LEVEL } });
    assert.deepEqual(state.upgrades.damage, { enabled: false, maxed: true });
    assert.equal(state.upgrades.range.enabled, true);
    assert.equal(state.upgrades.accuracy.enabled, true);
});
test("without a tower, or when eliminated, tower controls are disabled", () => {
    const noTower = getToolbarState({ ...prep, upgrades: null });
    assert.equal(noTower.targetModeEnabled, false);
    assert.deepEqual(noTower.upgrades, { range: none, damage: none, accuracy: none });
    const eliminated = getToolbarState({ ...prep, phase: "wave", eliminated: true });
    assert.equal(eliminated.targetModeEnabled, false);
});
test("when the match ended nothing is enabled", () => {
    const state = getToolbarState({ ...prep, phase: "ended" });
    assert.equal(state.targetModeEnabled, false);
    assert.deepEqual(state.upgrades, { range: none, damage: none, accuracy: none });
});
test("ready needs a tower and prep; placing needs prep and no tower yet", () => {
    assert.equal(getToolbarState(prep).readyEnabled, true);
    assert.equal(getToolbarState(prep).placeTowerEnabled, false);
    assert.equal(getToolbarState({ ...prep, upgrades: null }).readyEnabled, false);
    assert.equal(getToolbarState({ ...prep, upgrades: null }).placeTowerEnabled, true);
    assert.equal(getToolbarState({ ...prep, readyForWave: true }).readyEnabled, false);
    assert.equal(getToolbarState({ ...prep, phase: "wave" }).readyEnabled, false);
    assert.equal(getToolbarState({ ...prep, phase: "ended" }).readyEnabled, false);
    assert.equal(getToolbarState({ ...prep, phase: "ended", upgrades: null }).placeTowerEnabled, false);
});
test("the move button follows the token: locked early, free when unlocked, used after, dimmed once ready", () => {
    assert.deepEqual([getToolbarState(prep).moveEnabled, getToolbarState(prep).moveLabel], [false, "after R5"]);
    const unlocked = { ...prep, wave: 6, towerMoveAvailable: true };
    assert.deepEqual([getToolbarState(unlocked).moveEnabled, getToolbarState(unlocked).moveLabel], [true, "free"]);
    assert.equal(getToolbarState({ ...unlocked, towerMoveAvailable: false, readyForWave: true }).moveEnabled, false);
    const used = { ...prep, wave: 7, towerMoveAvailable: false };
    assert.deepEqual([getToolbarState(used).moveEnabled, getToolbarState(used).moveLabel], [false, "used"]);
    assert.equal(getToolbarState({ ...unlocked, phase: "wave" }).moveLabel, "-");
    assert.equal(getToolbarState({ ...unlocked, upgrades: null }).moveLabel, "-");
});
test("damage type is selectable only in prep, before ready, with a living tower", () => {
    assert.equal(getToolbarState(prep).damageTypeEnabled, true);
    assert.equal(getToolbarState({ ...prep, readyForWave: true }).damageTypeEnabled, false);
    assert.equal(getToolbarState({ ...prep, phase: "wave", readyForWave: true }).damageTypeEnabled, false);
    assert.equal(getToolbarState({ ...prep, phase: "ended" }).damageTypeEnabled, false);
    assert.equal(getToolbarState({ ...prep, upgrades: null }).damageTypeEnabled, false);
    assert.equal(getToolbarState({ ...prep, eliminated: true }).damageTypeEnabled, false);
});
test("the move button explains why it is off, from state", () => {
    assert.match(getToolbarState(prep).moveHint, /unlocks after round 5/);
    // The simulation reports towerMoveAvailable: false for a ready player, so that is the input to test.
    const ready = getToolbarState({ ...prep, wave: 6, towerMoveAvailable: false, readyForWave: true });
    assert.equal(ready.moveLabel, "ready");
    assert.match(ready.moveHint, /before you ready/);
    assert.equal(getToolbarState({ ...prep, wave: 3, towerMoveAvailable: false, readyForWave: true }).moveLabel, "after R5");
    assert.match(getToolbarState({ ...prep, wave: 8 }).moveHint, /already used/);
    assert.equal(getToolbarState({ ...prep, wave: 6, towerMoveAvailable: true }).moveHint, "");
    assert.match(getToolbarState({ ...prep, phase: "wave" }).moveHint, /during prep/);
});
test("a bot's controls are all off", () => {
    const state = getToolbarState({ ...prep, bot: true });
    assert.deepEqual(state.upgrades, { range: none, damage: none, accuracy: none });
    assert.equal(state.targetModeEnabled, false);
    assert.equal(state.damageTypeEnabled, false);
    assert.equal(state.readyEnabled, false);
    assert.equal(state.moveEnabled, false);
    assert.equal(getToolbarState({ ...prep, upgrades: null, bot: true }).placeTowerEnabled, false);
});
