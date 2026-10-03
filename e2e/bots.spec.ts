import { expect, test } from "@playwright/test";
import { clickCellNearSpawn, installCommonSetup, openMenu, showEndedOverlay } from "./helpers";

installCommonSetup();

// ?botDelay=0 removes the pause between bot actions so tests do not wait on pacing.
const PATH = "/?botDelay=0";

test("a bot places after the human, readies by itself and keeps readying every prep", async ({ page }) => {
  await openMenu(page, PATH);
  await page.locator("#menuSeed").fill("777");
  await page.locator("#menuPlayerCount").selectOption("1");
  await page.locator("#menuAiPlayers").selectOption("1");
  await expect(page.locator("#menuPlayerCount option[value='8']")).toBeDisabled();
  await page.locator("#menuBotDifficulty2").selectOption("hard");
  await page.getByRole("button", { name: "Start Match" }).click();

  const preview = page.locator("#mapPreviewRoot .map-preview-modal");
  await expect(preview).toContainText("Player 2: Bot 1 (hard bot)");
  await page.getByRole("button", { name: "Continue" }).click();

  // The bot waits for the human's tower.
  await expect(page.locator('[data-tower-id="tower-p2"]')).toHaveCount(0);
  await clickCellNearSpawn(page, 0);
  await expect(page.locator('[data-tower-id="tower-p2"]')).toBeVisible();
  await expect(page.locator(".player-chip.p2")).toContainText("BOT");
  await expect(page.locator(".player-chip.p2")).toContainText("READY");
  await expect(page.locator("#feedbackQueue")).toContainText("Bot 1 placed a tower");

  // A bot's seat is view-only.
  await page.locator("#playerId").selectOption("p2");
  await expect(page.locator("#readyBtn")).toHaveAttribute("aria-disabled", "true");
  await page.locator("#playerId").selectOption("p1");

  await page.locator("#readyBtn").click();
  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT");
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE", { timeout: 20_000 });
  await expect(page.locator(".player-chip.p2")).toContainText("READY");
  await expect(page.locator("#playerId")).toHaveValue("p1");
});

test("a bots-only match plays on its own and a rematch keeps the bots", async ({ page }) => {
  await openMenu(page, PATH);
  await page.locator("#menuPlayerCount").selectOption("0");
  await page.locator("#menuAiPlayers").selectOption("2");
  await expect(page.locator("#menuPlayerName1")).toHaveCount(0);
  await page.locator("#menuBotDifficulty1").selectOption("easy");
  await page.locator("#menuBotDifficulty2").selectOption("medium");
  await page.getByRole("button", { name: "Start Match" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.locator("#guideCard")).toContainText("is a bot");
  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT", { timeout: 15_000 });

  // Pause so the running wave does not replace the mocked end snapshot.
  await page.locator("#playPauseBtn").click();
  await showEndedOverlay(page);
  const rematchRequest = page.waitForRequest((request) => request.url().endsWith("/api/start") && request.method() === "POST");
  await page.getByRole("button", { name: "Rematch" }).click();
  const payload = JSON.parse((await rematchRequest).postData() ?? "{}") as { players: unknown };
  expect(payload.players).toEqual([
    { id: "p1", name: "Bot 1", ai: "easy" },
    { id: "p2", name: "Bot 2", ai: "medium" }
  ]);
});
