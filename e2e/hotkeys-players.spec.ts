import { expect, test } from "@playwright/test";
import { installCommonSetup, clickTowerSpot, clickCellNearSpawn, startMatch } from "./helpers";

installCommonSetup();

test("scoreboard chips and hotkeys switch the active player", async ({ page }) => {
  await startMatch(page, "/");
  const select = page.locator("#playerId");
  const chips = page.locator("#playerCards .player-chip");
  const switchers = page.locator("#playerCards .player-chip-name");
  await expect(select).toHaveValue("p1");
  await expect(switchers.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(switchers.nth(1)).not.toHaveAttribute("aria-current", "true");

  await chips.nth(1).click();
  await expect(select).toHaveValue("p2");
  await expect(switchers.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(chips.nth(1)).toHaveClass(/active/);
  await expect(chips.nth(0)).not.toHaveClass(/active/);

  await switchers.nth(0).focus();
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("p1");
  await switchers.nth(1).focus();
  await page.keyboard.press("Space");
  await expect(select).toHaveValue("p2");

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("1");
  await expect(select).toHaveValue("p1");
  await page.keyboard.press("2");
  await expect(select).toHaveValue("p2");
  // Only two players exist, so 5 must not change anything.
  await page.keyboard.press("5");
  await expect(select).toHaveValue("p2");

  await select.selectOption("p1");
  await expect(switchers.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(switchers.nth(1)).not.toHaveAttribute("aria-current", "true");
});

test("typing in a form field does not switch players", async ({ page }) => {
  await startMatch(page, "/");
  await page.locator("#playerId").selectOption("p2");
  // Debug-only inputs are hidden, so use the focused select: digits typed there must not reach the hotkey.
  await page.locator("#playerId").focus();
  await page.keyboard.press("1");
  await expect(page.locator("#playerId")).toHaveValue("p2");
  await expect(page.locator("#playerCards .player-chip-name").nth(1)).toHaveAttribute("aria-current", "true");
});

test("a tower can be placed as a player switched to via hotkey", async ({ page }) => {
  await startMatch(page, "/");
  await page.locator("#playerId").selectOption("p1");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("2");
  await clickTowerSpot(page);
  await expect(page.locator("#playerCards .player-chip").nth(1)).toContainText("Tower 175/175");
  await expect(page.locator("#playerCards .player-chip").nth(0)).toContainText("Tower not placed");
});

test("hotkeys do nothing when the action is not available", async ({ page }) => {
  await startMatch(page, "/");
  const commands: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/command")) {
      commands.push(request.postData() ?? "");
    }
  });

  // No tower yet: ready and upgrades are not available.
  for (const key of ["r", "u", "i", "o"]) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(300);
  expect(commands).toEqual([]);

  // After placing, T (place tower) is no longer available either.
  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#playerCards")).toContainText("Tower 175/175");
  commands.length = 0;
  await page.keyboard.press("t");
  await page.waitForTimeout(300);
  expect(commands).toEqual([]);
});
