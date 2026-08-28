import { expect, test } from "@playwright/test";

test("completes the local setup flow and starts wave combat", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#menuScreen")).toBeVisible();
  await page.locator("#menuSeed").fill("777");
  await page.locator("#menuPlayerName1").fill("Alpha");
  await page.locator("#menuPlayerName2").fill("Bravo");
  await page.getByRole("button", { name: "Start Match" }).click();

  await expect(page.locator("#gameScreen")).toBeVisible();
  const guideClose = page.locator("#guideCloseBtn");
  if (await guideClose.isVisible()) {
    await guideClose.click();
  }

  await page.getByRole("button", { name: "Place Tower" }).click();
  await expect(page.locator("#snapshot")).toHaveValue(/"hasPlacedTower": true/);

  await page.locator("#playerId").selectOption("p2");
  await page.getByRole("button", { name: "Place Tower" }).click();
  await expect(page.locator("#snapshot")).toHaveValue(/"phase": "placement"/);
  await expect(page.locator("#playerCards")).toContainText("Alpha");
  await expect(page.locator("#playerCards")).toContainText("Bravo");

  await page.locator("#playerId").selectOption("p1");
  await page.getByRole("button", { name: "Ready For Wave" }).click();
  await page.locator("#playerId").selectOption("p2");
  await page.getByRole("button", { name: "Ready For Wave" }).click();

  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT");
  await expect(page.locator("#snapshot")).toHaveValue(/"phase": "wave"/);

  if (await guideClose.isVisible()) {
    await guideClose.click();
  }
  await page.getByRole("button", { name: "Advance Wave Tick" }).click();
  await expect(page.locator("#snapshot")).toHaveValue(/"waveTick": 1/);
  await expect(page.locator("#battlefieldMeta")).toContainText("Tick 1");

  await page.getByRole("button", { name: "Advance 30 Ticks" }).click();
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE");
  await expect(page.locator("#phaseSub")).toContainText("Round 1 complete");
  await expect(page.locator("#feedbackQueue")).toContainText("Alpha tower repaired +2 HP (100/100)");
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
});