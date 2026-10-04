import { expect, test } from "@playwright/test";
import { installCommonSetup, clickTowerSpot, clickCellNearSpawn, startMatch, showEndedOverlay } from "./helpers";

installCommonSetup();

test("completes the local setup flow, auto-plays combat, and rematches", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#menuScreen")).toBeVisible();
  await expect(page.locator("#menuAiPlayers")).toHaveValue("0");
  await expect(page.locator("#menuAiPlayers")).toBeEnabled();
  await expect(page.locator(".menu-hint")).toHaveCount(0);
  await page.locator("#menuSeed").fill("43");
  await expect(page.locator("#menuPlayerName1")).toHaveAttribute("maxlength", "24");
  await page.locator("#menuPlayerName1").fill("Alpha");
  await page.locator("#menuPlayerName2").fill("Bravo");
  await page.getByRole("button", { name: "Start Match" }).click();

  await expect(page.locator("#gameScreen")).toBeVisible();
  await expect(page.locator("#board canvas")).toBeVisible();

  // A new match goes straight to placement: nothing blocks the page and the place button has focus.
  await expect(page.locator("#gameScreen")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#placeTowerBtn")).toBeFocused();

  // Developer controls are hidden by default.
  await expect(page.locator("#snapshot")).toBeHidden();
  await expect(page.locator("#x")).toBeHidden();
  await expect(page.locator("#advanceBtn")).toBeHidden();

  // The coach mark is visible but must not overlap the battlefield canvas.
  await expect(page.locator("#guideCard")).toBeVisible();
  const guideBox = await page.locator("#guideCard").boundingBox();
  const canvasBox = await page.locator("#board canvas").boundingBox();
  expect(guideBox && canvasBox && guideBox.y + guideBox.height <= canvasBox.y).toBe(true);

  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#playerCards")).toContainText("Tower 175/175");

  await page.locator("#playerId").selectOption("p2");
  await clickCellNearSpawn(page, 1);
  await expect(page.locator("#playerCards")).toContainText("Alpha");
  await expect(page.locator("#playerCards")).toContainText("Bravo");
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE");

  await page.locator("#playerId").selectOption("p1");
  await page.locator("#readyBtn").click();
  await page.locator("#playerId").selectOption("p2");
  await page.locator("#readyBtn").click();

  // No tick button is pressed: combat advances on its own and the round ends by itself.
  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT");
  await expect(page.locator("#playbackControls")).toBeVisible();
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE", { timeout: 15_000 });
  await expect(page.locator("#phaseSub")).toContainText("Round 1 complete");
  // p2 readied last, but every wave hands the turn back to the first seat with a big banner.
  await expect(page.locator("#playerId")).toHaveValue("p1");
  await expect(page.locator("#turnBanner")).toContainText("Alpha");
  await expect(page.locator("#guideCard")).toContainText("Alpha, it's your turn");
  await expect(page.locator("#playbackControls")).toBeHidden();
  // The shorter range and spawn protection mean the tower now takes more damage in wave 1, so the exact
  // repair amount is no longer fixed; what matters is that the repair is announced.
  await expect(page.locator("#feedbackQueue")).toContainText(/Alpha tower repaired \+\d+ HP \(\d+\/175\)/);
  await expect(page.locator("#playerCards")).toContainText(/Tower \d+\/175/);
  await expect(page.locator('[data-tower-id="tower-p1"] .tower-hp-bar')).toHaveClass(/repair-pulse/);
  await expect(page.locator('[data-tower-id="tower-p1"] .tower-hp-bar')).toHaveAttribute("role", "progressbar");

  // Routine polling uses lite snapshots; a mocked ended snapshot proves the overlay and rematch flow.
  const liveSnapshot = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: Record<string, unknown> };
  const endedSnapshot = {
    ...liveSnapshot.snapshot,
    phase: "ended",
    winnerId: "p1",
    endReason: "score-win",
    players: (liveSnapshot.snapshot.players as Array<Record<string, unknown>>).map((player) => ({
      ...player,
      points: player.id === "p1" ? 1000 : 0
    }))
  };
  await page.route("**/api/snapshot*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, snapshot: endedSnapshot })
    });
  }, { times: 1 });
  await page.getByRole("button", { name: "Refresh Snapshot" }).click();
  await expect(page.locator("#matchEndOverlay")).toBeVisible();
  await expect(page.locator("#matchEndSummary")).toContainText("Alpha (p1) secured the win");

  const rematchRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/start") && request.method() === "POST"
  );
  await page.getByRole("button", { name: "Rematch" }).click();
  const rematchPayload = JSON.parse((await rematchRequest).postData() ?? "{}") as {
    seed: number;
    players: Array<{ id: string; name: string }>;
  };
  expect(rematchPayload.seed).toBe(44);
  expect(rematchPayload.players).toEqual([
    { id: "p1", name: "Alpha" },
    { id: "p2", name: "Bravo" }
  ]);
  await expect(page.locator("#matchEndOverlay")).toBeHidden();
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE");
  await expect(page.locator("#playerCards")).toContainText("100 pts");
  await expect(page.locator("#playerCards")).not.toContainText("1000 pts");
});

test("readying up hands the turn to the next player who is not ready", async ({ page }) => {
  await startMatch(page, "/");
  await clickCellNearSpawn(page, 0);
  await page.locator("#playerId").selectOption("p2");
  await clickCellNearSpawn(page, 1);

  await page.locator("#playerId").selectOption("p1");
  await page.locator("#readyBtn").click();

  await expect(page.locator("#playerId")).toHaveValue("p2");
  await expect(page.locator("#guideCard")).toContainText("Bravo, it's your turn");
  await expect(page.locator("#turnBanner")).toBeVisible();
  await expect(page.locator("#turnBanner")).toContainText("Bravo");
  const bannerFontSize = await page.locator("#turnBanner strong").evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(bannerFontSize).toBeGreaterThanOrEqual(40);
  // The handoff must refresh the toolbar: p2 is not ready, so the upgrade buttons must not stay dimmed from p1.
  await expect(page.locator(".upgrade-btn")).toHaveCount(3);
  for (const id of ["#upgradeRangeBtn", "#upgradeDamageBtn", "#upgradeAccuracyBtn"]) {
    await expect(page.locator(id)).not.toHaveClass(/dim/);
  }
});

test("starting a match over a running one asks first, and the menu offers to resume", async ({ page }) => {
  await startMatch(page, "/");
  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#playerCards")).toContainText("Tower 175/175");

  await page.getByRole("button", { name: "Back To Menu" }).click();
  await expect(page.locator("#menuScreen")).toBeVisible();
  await expect(page.locator("#menuResumeBtn")).toBeVisible();

  // Cancelling the confirmation leaves the running match untouched.
  let asked = "";
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect.poll(() => asked).toBe("Replace the running match?");
  await expect(page.locator("#menuScreen")).toBeVisible();

  await page.locator("#menuResumeBtn").click();
  await expect(page.locator("#gameScreen")).toBeVisible();
  await expect(page.locator("#playerCards")).toContainText("Tower 175/175");
});

test("after the match ended the ready and place-tower buttons are disabled and the status names the winner", async ({ page }) => {
  await startMatch(page, "/");
  await showEndedOverlay(page);
  await expect(page.locator("#phaseSub")).toContainText("Winner Alpha");
  await expect(page.locator("#readyBtn")).toBeDisabled();
  await expect(page.locator("#placeTowerBtn")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator("#matchEndOverlay")).toBeHidden();
  await expect(page.locator("#readyBtn")).toBeDisabled();
});

test("starting further matches replaces the board instead of leaking canvases and tooltips", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await startMatch(page, "/");
  for (let round = 0; round < 3; round += 1) {
    await page.getByRole("button", { name: "Back To Menu" }).click();
    await page.getByRole("button", { name: "Start Match" }).click();
    await expect(page.locator("#gameScreen")).toBeVisible();
    await expect(page.locator("#board canvas")).toHaveCount(1);
    await expect(page.locator("#board .tower-tooltip")).toHaveCount(1);
  }

  // The fresh board still takes clicks: placing a tower works after the replacements.
  await clickTowerSpot(page);
  await expect(page.locator("#status")).toHaveText("accepted");
  expect(pageErrors).toEqual([]);
});
