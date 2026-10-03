import { expect, test } from "@playwright/test";
import { installCommonSetup, clickTowerSpot, clickCellNearSpawn, startMatch } from "./helpers";

installCommonSetup();

test("debug mode: pause, manual ticks, and snapshot panel", async ({ page }) => {
  await startMatch(page, "/?debug=1");
  await expect(page.locator("#snapshot")).toBeVisible();
  await expect(page.locator("#advanceBtn")).toBeVisible();

  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#snapshot")).toHaveValue(/"hasPlacedTower": true/);
  await page.locator("#playerId").selectOption("p2");
  await clickCellNearSpawn(page, 1);

  // Pause (keyboard) before combat so manual ticks are deterministic.
  await page.keyboard.press("p");
  expect(await page.evaluate(() => window.__testBoard?.playback().playing)).toBe(false);
  await page.locator("#readyBtn").click();
  await page.locator("#playerId").selectOption("p1");
  await page.locator("#readyBtn").click();
  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT");
  await expect(page.locator("#playPauseBtn")).toHaveText("Play");

  await page.waitForTimeout(600);
  await expect(page.locator("#snapshot")).toHaveValue(/"waveTick": 0/);
  await page.getByRole("button", { name: "Advance Wave Tick" }).click();
  await expect(page.locator("#snapshot")).toHaveValue(/"waveTick": 1/);
  await expect(page.locator("#battlefieldMeta")).toContainText("Tick 1");

  await page.getByRole("button", { name: "Advance Wave (Auto)" }).click();
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE");
  await expect(page.locator("#phaseSub")).toContainText("Round 1 complete");
});

test("debug demo combat shows synthetic creatures and stops cleanly", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await startMatch(page, "/?debug=1");
  await clickTowerSpot(page, 5);
  await page.locator("#playerId").selectOption("p2");
  await clickTowerSpot(page, 8);

  await page.locator("#demoBtn").click();
  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT");
  await expect.poll(() => page.evaluate(() => window.__testBoard?.creaturePositions().length ?? 0), { timeout: 10_000 }).toBeGreaterThan(2);

  await page.locator("#demoBtn").click();
  await expect(page.locator("#demoBtn")).toHaveText("Demo Combat");
  expect(errors).toEqual([]);
});
