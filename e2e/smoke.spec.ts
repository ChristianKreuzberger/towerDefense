import { expect, test } from "@playwright/test";

test("completes the local setup flow and starts wave combat", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#menuScreen")).toBeVisible();
  await expect(page.locator("#menuAiPlayers")).toHaveValue("0");
  await expect(page.locator("#menuAiPlayers")).toBeDisabled();
  await expect(page.locator(".menu-hint")).toContainText("Coming later");
  await page.locator("#menuSeed").fill("777");
  await page.locator("#menuPlayerName1").fill("Alpha");
  await page.locator("#menuPlayerName2").fill("Bravo");
  await page.getByRole("button", { name: "Start Match" }).click();

  await expect(page.locator("#gameScreen")).toBeVisible();
  const guideClose = page.locator("#guideCloseBtn");
  if (await guideClose.isVisible()) {
    await guideClose.click();
  }

  await page.locator("#board .grid-cell.buildable").first().click();
  await expect(page.locator("#snapshot")).toHaveValue(/"hasPlacedTower": true/);

  await page.locator("#playerId").selectOption("p2");
  if (await guideClose.isVisible()) {
    await guideClose.click();
  }
  await page.locator("#board .grid-cell.buildable").nth(1).click();
  await expect(page.locator("#snapshot")).toHaveValue(/"phase": "placement"/);
  await expect(page.locator("#playerCards")).toContainText("Alpha");
  await expect(page.locator("#playerCards")).toContainText("Bravo");

  await page.locator("#playerId").selectOption("p1");
  if (await guideClose.isVisible()) {
    await guideClose.click();
  }
  await page.locator("#readyBtn").click();
  await page.locator("#playerId").selectOption("p2");
  if (await guideClose.isVisible()) {
    await guideClose.click();
  }
  await page.locator("#readyBtn").click();

  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT");
  await expect(page.locator("#snapshot")).toHaveValue(/"phase": "wave"/);

  if (await guideClose.isVisible()) {
    await guideClose.click();
  }
  await page.getByRole("button", { name: "Advance Wave Tick" }).click({ force: true });
  await expect(page.locator("#snapshot")).toHaveValue(/"waveTick": 1/);
  await expect(page.locator("#battlefieldMeta")).toContainText("Tick 1");

  if (await guideClose.isVisible()) {
    await guideClose.click();
  }
  await page.getByRole("button", { name: "Advance Wave (Auto)" }).click({ force: true });
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE");
  await expect(page.locator("#phaseSub")).toContainText("Round 1 complete");
  await expect(page.locator("#feedbackQueue")).toContainText("Alpha tower repaired +2 HP (100/100)");
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
  await expect(page.locator('[data-tower-id="tower-p1"] .tower-hp-bar')).toHaveClass(/repair-pulse/);
  await expect(page.locator('[data-tower-id="tower-p1"] .tower-hp-bar')).toHaveAttribute("role", "progressbar");

  const endedSnapshot = JSON.parse(await page.locator("#snapshot").inputValue()) as Record<string, unknown>;
  endedSnapshot.phase = "ended";
  endedSnapshot.winnerId = "p1";
  endedSnapshot.endReason = "score-win";
  endedSnapshot.players = (endedSnapshot.players as Array<Record<string, unknown>>).map((player) => ({
    ...player,
    points: player.id === "p1" ? 1000 : 0
  }));
  await page.route("**/api/snapshot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, snapshot: endedSnapshot })
    });
  }, { times: 1 });
  if (await guideClose.isVisible()) {
    await guideClose.click();
  }
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
  expect(rematchPayload.seed).toBe(778);
  expect(rematchPayload.players).toEqual([
    { id: "p1", name: "Alpha" },
    { id: "p2", name: "Bravo" }
  ]);
  await expect(page.locator("#matchEndOverlay")).toBeHidden();
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE");
  await expect(page.locator("#snapshot")).toHaveValue(/"wave": 1/);
  await expect(page.locator("#snapshot")).toHaveValue(/"points": 0/);
});