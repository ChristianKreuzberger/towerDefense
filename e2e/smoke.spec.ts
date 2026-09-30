import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __testBoard?: {
      findBuildableCell(index?: number): { x: number; y: number } | null;
      cellSize(): number;
      cellToPixel(x: number, y: number): { x: number; y: number };
      creaturePositions(): Array<{ id: string; x: number; y: number }>;
      playback(): { playing: boolean; speed: number };
    };
  }
}

async function cellPixel(page: Page, index = 0): Promise<{ x: number; y: number }> {
  const pixel = await page.evaluate((cellIndex) => {
    const board = window.__testBoard;
    const cell = board?.findBuildableCell(cellIndex);
    return board && cell ? board.cellToPixel(cell.x, cell.y) : null;
  }, index);
  if (!pixel) {
    throw new Error("No buildable cell found via __testBoard hook");
  }
  return pixel;
}

// Deliberately a plain click (no force): the guide must never sit on top of the board.
async function clickBuildableCell(page: Page, index = 0): Promise<void> {
  await page.locator("#board canvas").click({ position: await cellPixel(page, index) });
}

async function startMatch(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // The host keeps the previous test's match alive, and the client reconnects to it on load.
  const backToMenu = page.getByRole("button", { name: "Back To Menu" });
  if (await backToMenu.isVisible()) {
    await backToMenu.click();
  }
  await expect(page.locator("#menuScreen")).toBeVisible();
  await page.locator("#menuSeed").fill("777");
  await page.locator("#menuPlayerName1").fill("Alpha");
  await page.locator("#menuPlayerName2").fill("Bravo");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.locator("#gameScreen")).toBeVisible();
  await expect(page.locator("#board canvas")).toBeVisible();
}

test("completes the local setup flow, auto-plays combat, and rematches", async ({ page }) => {
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
  await expect(page.locator("#board canvas")).toBeVisible();

  // Developer controls are hidden by default.
  await expect(page.locator("#snapshot")).toBeHidden();
  await expect(page.locator("#x")).toBeHidden();
  await expect(page.locator("#advanceBtn")).toBeHidden();

  // The coach mark is visible but must not overlap the battlefield canvas.
  await expect(page.locator("#guideCard")).toBeVisible();
  const guideBox = await page.locator("#guideCard").boundingBox();
  const canvasBox = await page.locator("#board canvas").boundingBox();
  expect(guideBox && canvasBox && guideBox.y + guideBox.height <= canvasBox.y).toBe(true);

  await clickBuildableCell(page);
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");

  await page.locator("#playerId").selectOption("p2");
  await clickBuildableCell(page);
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
  await expect(page.locator("#playbackControls")).toBeHidden();
  await expect(page.locator("#feedbackQueue")).toContainText("Alpha tower repaired +2 HP (100/100)");
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
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
  expect(rematchPayload.seed).toBe(778);
  expect(rematchPayload.players).toEqual([
    { id: "p1", name: "Alpha" },
    { id: "p2", name: "Bravo" }
  ]);
  await expect(page.locator("#matchEndOverlay")).toBeHidden();
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE");
  await expect(page.locator("#playerCards")).toContainText("0 pts");
  await expect(page.locator("#playerCards")).not.toContainText("1000 pts");
});

test("debug mode: pause, manual ticks, wall mode, and snapshot panel", async ({ page }) => {
  await startMatch(page, "/?debug=1");
  await expect(page.locator("#snapshot")).toBeVisible();
  await expect(page.locator("#advanceBtn")).toBeVisible();

  await clickBuildableCell(page);
  await expect(page.locator("#snapshot")).toHaveValue(/"hasPlacedTower": true/);
  await page.locator("#playerId").selectOption("p2");
  await clickBuildableCell(page);

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

  // Wall mode sends place-wall for the clicked tile (rejected here: players start with 0 points).
  await page.getByRole("button", { name: "Place Wall" }).click();
  await expect(page.getByRole("button", { name: "Place Wall" })).toHaveAttribute("aria-pressed", "true");
  await clickBuildableCell(page, 5);
  await expect(page.locator("#feedbackQueue")).toContainText("Wall rejected: not enough points");

  await page.getByRole("button", { name: "Advance Wave (Auto)" }).click();
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE");
  await expect(page.locator("#phaseSub")).toContainText("Round 1 complete");
});

test("creatures glide between snapshots instead of jumping", async ({ page }) => {
  await startMatch(page, "/");
  await clickBuildableCell(page);
  await page.locator("#playerId").selectOption("p2");
  await clickBuildableCell(page);
  await page.locator("#readyBtn").click();
  await page.locator("#playerId").selectOption("p1");

  // Feed one creature that advances one cell per tick so interpolation is observable.
  let tick = 0;
  await page.route("**/api/advance-many", async (route) => {
    const live = (await (await page.request.get("/api/snapshot?lite=1")).json()) as { snapshot: Record<string, unknown> };
    tick += 1;
    const snapshot = {
      ...live.snapshot,
      phase: "wave",
      wave: 1,
      waveTick: tick,
      creatures: [
        {
          id: "mock-creature",
          archetype: "runner",
          hp: 2,
          x: 3 + tick,
          y: 8,
          pathIndex: tick,
          pathProgressUnits: 0,
          spawnTick: 1,
          targetTowerId: "tower-p1"
        }
      ]
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, acceptedTicks: 1, stoppedReason: "", snapshot })
    });
  });
  await page.locator("#readyBtn").click();
  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT");

  // Sample the drawn x position: a smooth glide yields values strictly between cell centers.
  const samples = await page.evaluate(async () => {
    const xs: number[] = [];
    const end = performance.now() + 1500;
    while (performance.now() < end) {
      const creature = window.__testBoard?.creaturePositions()[0];
      if (creature) {
        xs.push(creature.x);
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return xs;
  });
  expect(samples.length).toBeGreaterThan(10);
  expect(samples.some((x) => Math.abs(x - Math.round(x - 0.5) - 0.5) > 0.1)).toBe(true);
  expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(1);
});
