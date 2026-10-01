import test from "node:test";
import assert from "node:assert/strict";

import { MAX_TOWER_LEVEL } from "@tower-defense/shared";
import { getToolbarState, type ToolbarInput } from "./toolbar-state.js";

const prep: ToolbarInput = { phase: "placement", towerLevel: 1, eliminated: false, readyForWave: false };

test("prep: upgrades and target mode are enabled, walls are not", () => {
  assert.deepEqual(getToolbarState(prep), {
    upgradeEnabled: true,
    upgradeMaxed: false,
    wallEnabled: false,
    targetModeEnabled: true
  });
});

test("prep after readying: upgrades lock but target mode stays available", () => {
  const state = getToolbarState({ ...prep, readyForWave: true });
  assert.equal(state.upgradeEnabled, false);
  assert.equal(state.targetModeEnabled, true);
});

test("wave: walls and target mode are enabled, upgrades are not", () => {
  const state = getToolbarState({ ...prep, phase: "wave", readyForWave: true });
  assert.equal(state.wallEnabled, true);
  assert.equal(state.targetModeEnabled, true);
  assert.equal(state.upgradeEnabled, false);
});

test("a tower at max level disables upgrades and reports maxed", () => {
  const state = getToolbarState({ ...prep, towerLevel: MAX_TOWER_LEVEL });
  assert.equal(state.upgradeMaxed, true);
  assert.equal(state.upgradeEnabled, false);
});

test("without a tower, or when eliminated, tower controls are disabled", () => {
  assert.equal(getToolbarState({ ...prep, towerLevel: null }).targetModeEnabled, false);
  assert.equal(getToolbarState({ ...prep, towerLevel: null }).upgradeEnabled, false);
  const eliminated = getToolbarState({ ...prep, phase: "wave", eliminated: true });
  assert.deepEqual(eliminated, { upgradeEnabled: false, upgradeMaxed: false, wallEnabled: false, targetModeEnabled: false });
});

test("when the match ended nothing is enabled", () => {
  const state = getToolbarState({ ...prep, phase: "ended" });
  assert.deepEqual(state, { upgradeEnabled: false, upgradeMaxed: false, wallEnabled: false, targetModeEnabled: false });
});
