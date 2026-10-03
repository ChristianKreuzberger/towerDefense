import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __testBoard?: {
      findTowerSpot(index?: number): { x: number; y: number } | null;
      cellSize(): number;
      cellToPixel(x: number, y: number): { x: number; y: number };
      creaturePositions(): Array<{ id: string; x: number; y: number }>;
      playback(): { playing: boolean; speed: number };
      zoom(): number;
    };
  }
}

// Every fresh browser context would open its first match with the how-to-play tour, so tests mark it as seen up front.
// Tests whose title starts with "tour:" exercise the tour itself and start from a clean profile.
// Called from each spec file because hooks are registered per file.
export function installCommonSetup(): void {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!testInfo.title.startsWith("tour:")) {
      await page.addInitScript(() => {
        try {
          localStorage.setItem("towerDefense.tour.v1", JSON.stringify({ version: 1, seen: true }));
        } catch {
          // Storage unavailable: nothing to pre-seed.
        }
      });
    }
    // The host keeps the previous test's match alive and the client reconnects to it on load. Answer the first
    // snapshot request of every test as "no match yet" so each test starts from the menu regardless of test order.
    let firstSnapshot = true;
    await page.route(/\/api\/snapshot/, async (route) => {
      if (firstSnapshot && route.request().method() === "GET") {
        firstSnapshot = false;
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: "match-not-started", message: "Start a match first." }) });
        return;
      }
      await route.continue();
    });
  });
}

export async function cellPixel(page: Page, index = 0): Promise<{ x: number; y: number }> {
  const pixel = await page.evaluate((cellIndex) => {
    const board = window.__testBoard;
    const cell = board?.findTowerSpot(cellIndex);
    return board && cell ? board.cellToPixel(cell.x, cell.y) : null;
  }, index);
  if (!pixel) {
    throw new Error("No tower spot found via __testBoard hook");
  }
  return pixel;
}

// Deliberately a plain click (no force): the guide must never sit on top of the board.
export async function clickTowerSpot(page: Page, index = 0): Promise<void> {
  await page.locator("#board canvas").click({ position: await cellPixel(page, index) });
}

// Towers have a limited range, so tests that need combat use the tower spots closest to the monster cave. The spots
// come from the live map, so these tests keep working when generation changes.
export async function clickCellNearSpawn(page: Page, slot: 0 | 1, skipNearest = 0): Promise<void> {
  const { snapshot } = (await (await page.request.get("/api/snapshot")).json()) as {
    snapshot: { map: { spawn: { x: number; y: number }; towerSpots: Array<{ x: number; y: number }> } };
  };
  const { spawn, towerSpots } = snapshot.map;
  const byDistance = [...towerSpots].sort(
    (a, b) => Math.hypot(a.x - spawn.x, a.y - spawn.y) - Math.hypot(b.x - spawn.x, b.y - spawn.y) || a.y - b.y || a.x - b.x
  );
  const cell = byDistance[skipNearest + slot];
  expect(cell, `map has no tower spot number ${skipNearest + slot}`).toBeTruthy();
  const position = await page.evaluate(({ x, y }) => window.__testBoard?.cellToPixel(x, y) ?? null, cell);
  if (!position) {
    throw new Error("No board hook available to locate the tower cell");
  }
  await page.locator("#board canvas").click({ position });
}

// Opens the menu, leaving any match the host kept alive from the previous test.
export async function openMenu(page: Page, path: string): Promise<void> {
  // Starting over a running match asks for confirmation; the helper always agrees.
  page.on("dialog", (dialog) => void dialog.accept());
  // Register before goto so the load-time snapshot response can't be missed.
  const reconnect = page.waitForResponse((response) => response.url().includes("/api/snapshot"));
  await page.goto(path);
  const hasMatch = (await (await reconnect).json()).ok === true;
  // The host keeps the previous test's match alive, and the client reconnects to it on load.
  // Wait for that reconnect to show the game screen before leaving it; the client drops responses
  // still in flight after "Back To Menu", so the menu stays put once it is shown.
  if (hasMatch) {
    await expect(page.locator("#gameScreen")).toBeVisible();
    await page.getByRole("button", { name: "Back To Menu" }).click();
  }
  await expect(page.locator("#menuScreen")).toBeVisible();
}

export async function startMatch(page: Page, path: string): Promise<void> {
  await openMenu(page, path);
  await page.locator("#menuSeed").fill("777");
  await page.locator("#menuPlayerName1").fill("Alpha");
  await page.locator("#menuPlayerName2").fill("Bravo");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.locator("#gameScreen")).toBeVisible();
  await expect(page.locator("#board canvas")).toBeVisible();
  // Every new match opens with the map preview; the helper moves on to placement.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#mapPreviewRoot")).toBeHidden();
}

export async function showEndedOverlay(page: Page): Promise<void> {
  const live = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: Record<string, unknown> };
  const ended = {
    ...live.snapshot,
    phase: "ended",
    winnerId: "p1",
    endReason: "score-win",
    players: (live.snapshot.players as Array<Record<string, unknown>>).map((player) => ({ ...player, points: player.id === "p1" ? 1000 : 0 }))
  };
  await page.route("**/api/snapshot*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, snapshot: ended }) });
  });
  await page.getByRole("button", { name: "Refresh Snapshot" }).click();
  await expect(page.locator("#matchEndOverlay")).toBeVisible();
}
