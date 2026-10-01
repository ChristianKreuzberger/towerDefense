import test from "node:test";
import assert from "node:assert/strict";

import { MAX_TOWER_LEVEL, type TowerUpgrades } from "@tower-defense/shared";
import { getToolbarState, type ToolbarInput } from "./toolbar-state.js";

const base: TowerUpgrades = { range: 1, damage: 1, accuracy: 1 };
const prep: ToolbarInput = { phase: "placement", upgrades: base, eliminated: false, readyForWave: false };
const none = { enabled: false, maxed: false };

test("prep: every upgrade track and target mode are enabled, walls are not", () => {
  const state = getToolbarState(prep);
  assert.deepEqual(state.upgrades, {
    range: { enabled: true, maxed: false },
    damage: { enabled: true, maxed: false },
    accuracy: { enabled: true, maxed: false }
  });
  assert.equal(state.wallEnabled, false);
  assert.equal(state.targetModeEnabled, true);
});

test("prep after readying: upgrades lock but target mode stays available", () => {
  const state = getToolbarState({ ...prep, readyForWave: true });
  assert.deepEqual(state.upgrades, { range: none, damage: none, accuracy: none });
  assert.equal(state.targetModeEnabled, true);
});

test("wave: walls and target mode are enabled, upgrades are not", () => {
  const state = getToolbarState({ ...prep, phase: "wave", readyForWave: true });
  assert.equal(state.wallEnabled, true);
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
  assert.equal(eliminated.wallEnabled, false);
  assert.equal(eliminated.targetModeEnabled, false);
});

test("when the match ended nothing is enabled", () => {
  const state = getToolbarState({ ...prep, phase: "ended" });
  assert.equal(state.wallEnabled, false);
  assert.equal(state.targetModeEnabled, false);
  assert.deepEqual(state.upgrades, { range: none, damage: none, accuracy: none });
});
