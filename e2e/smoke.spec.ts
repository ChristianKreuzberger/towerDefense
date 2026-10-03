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

// Towers have a limited range, so tests that need combat place them just outside the protected area
// around seed 777's monster cave at (0, 0). They are isolated pads inside the maze walls, so they never cut the route.
const SEED_777_TOWER_CELLS = [{ x: 9, y: 6 }, { x: 6, y: 10 }];
// On seed 777 no tower ever takes damage in wave 1 (the maze keeps creatures away from every pad), but the repair
// flow needs a damaged tower. On seed 43 the first pad sits on a corridor corner that creatures reach in wave 1.
const SEED_43_TOWER_CELLS = [{ x: 5, y: 7 }, { x: 47, y: 46 }];

async function clickCellNearSpawn(
  page: Page,
  slot: 0 | 1,
  cells: ReadonlyArray<{ x: number; y: number }> = SEED_777_TOWER_CELLS
): Promise<void> {
  const cell = cells[slot]!;
  // Fail with a clear message if map generation changes, instead of a silent "tower never fires" later.
  const { snapshot } = (await (await page.request.get("/api/snapshot")).json()) as {
    snapshot: { map: { cells: Array<{ x: number; y: number; buildable: boolean }> } };
  };
  const buildable = snapshot.map.cells.some((entry) => entry.x === cell.x && entry.y === cell.y && entry.buildable);
  expect(buildable, `tower cell ${slot} (${cell.x},${cell.y}) is no longer buildable on this seed; update the cells`).toBe(true);
  const position = await page.evaluate(({ x, y }) => window.__testBoard?.cellToPixel(x, y) ?? null, cell);
  if (!position) {
    throw new Error("No board hook available to locate the tower cell");
  }
  await page.locator("#board canvas").click({ position });
}

// Opens the menu, leaving any match the host kept alive from the previous test.
async function openMenu(page: Page, path: string): Promise<void> {
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

async function startMatch(page: Page, path: string): Promise<void> {
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

test("completes the local setup flow, auto-plays combat, and rematches", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#menuScreen")).toBeVisible();
  await expect(page.locator("#menuAiPlayers")).toHaveValue("0");
  await expect(page.locator("#menuAiPlayers")).toBeDisabled();
  await expect(page.locator(".menu-hint")).toContainText("Coming later");
  await page.locator("#menuSeed").fill("43");
  await expect(page.locator("#menuPlayerName1")).toHaveAttribute("maxlength", "24");
  await page.locator("#menuPlayerName1").fill("Alpha");
  await page.locator("#menuPlayerName2").fill("Bravo");
  await page.getByRole("button", { name: "Start Match" }).click();

  await expect(page.locator("#gameScreen")).toBeVisible();
  await expect(page.locator("#board canvas")).toBeVisible();

  // A new match opens with the map preview: map overview, seed and the player list; nothing can be placed yet.
  const preview = page.locator("#mapPreviewRoot .map-preview-modal");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("role", "dialog");
  await expect(preview).toContainText("Seed 43");
  await expect(preview).toContainText("Player 1: Alpha");
  await expect(preview).toContainText("Player 2: Bravo");
  await expect(page.locator("#mapPreviewContinueBtn")).toBeFocused();
  await expect(page.locator("#gameScreen")).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(preview).toBeHidden();
  await expect(page.locator("#gameScreen")).not.toHaveAttribute("inert", "");

  // Developer controls are hidden by default.
  await expect(page.locator("#snapshot")).toBeHidden();
  await expect(page.locator("#x")).toBeHidden();
  await expect(page.locator("#advanceBtn")).toBeHidden();

  // The coach mark is visible but must not overlap the battlefield canvas.
  await expect(page.locator("#guideCard")).toBeVisible();
  const guideBox = await page.locator("#guideCard").boundingBox();
  const canvasBox = await page.locator("#board canvas").boundingBox();
  expect(guideBox && canvasBox && guideBox.y + guideBox.height <= canvasBox.y).toBe(true);

  await clickCellNearSpawn(page, 0, SEED_43_TOWER_CELLS);
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");

  await page.locator("#playerId").selectOption("p2");
  await clickCellNearSpawn(page, 1, SEED_43_TOWER_CELLS);
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
  await expect(page.locator("#feedbackQueue")).toContainText(/Alpha tower repaired \+\d+ HP \(\d+\/100\)/);
  await expect(page.locator("#playerCards")).toContainText(/Tower \d+\/100/);
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

test("tile clicks stay accurate when CSS scales the canvas down", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 600 });
  await startMatch(page, "/");

  const canvas = page.locator("#board canvas");
  const box = await canvas.boundingBox();
  const internalWidth = await canvas.evaluate((element) => (element as HTMLCanvasElement).width);
  expect(box).not.toBeNull();
  // The board must actually be scaled for this test to mean anything.
  expect(box && box.width < internalWidth - 50).toBe(true);

  // Computed from the on-screen rectangle only (not via the board hook) so scaling bugs cannot cancel out.
  const cell = await page.evaluate(() => window.__testBoard?.findBuildableCell(25) ?? null);
  const map = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: { map: { width: number; height: number } } };
  expect(cell).not.toBeNull();
  if (!box || !cell) {
    return;
  }
  await canvas.click({
    position: {
      x: ((cell.x + 0.5) / map.snapshot.map.width) * box.width,
      y: ((cell.y + 0.5) / map.snapshot.map.height) * box.height
    }
  });

  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
  const after = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: { towers: Array<{ x: number; y: number }> } };
  expect(after.snapshot.towers).toHaveLength(1);
  expect(after.snapshot.towers[0]).toMatchObject({ x: cell.x, y: cell.y });
});

test("debug demo combat shows synthetic creatures and stops cleanly", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await startMatch(page, "/?debug=1");
  await clickBuildableCell(page, 10);
  await page.locator("#playerId").selectOption("p2");
  await clickBuildableCell(page, 20);

  await page.locator("#demoBtn").click();
  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT");
  await expect.poll(() => page.evaluate(() => window.__testBoard?.creaturePositions().length ?? 0), { timeout: 10_000 }).toBeGreaterThan(2);

  await page.locator("#demoBtn").click();
  await expect(page.locator("#demoBtn")).toHaveText("Demo Combat");
  expect(errors).toEqual([]);
});

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
  await clickBuildableCell(page);
  await expect(page.locator("#playerCards .player-chip").nth(1)).toContainText("Tower 100/100");
  await expect(page.locator("#playerCards .player-chip").nth(0)).toContainText("Tower not placed");
});

test("board renders 20% larger by default and clicks stay accurate", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await startMatch(page, "/");

  const canvas = page.locator("#board canvas");
  const map = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: { map: { width: number; height: number } } };
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    return;
  }
  // Old cell sizes were 28 / 22 / 16 px by map width; the new ones must display at least 1.15x larger.
  const mapWidth = map.snapshot.map.width;
  const oldCell = mapWidth > 40 ? 16 : mapWidth > 24 ? 22 : 28;
  expect(box.width).toBeGreaterThanOrEqual(1.15 * oldCell * mapWidth);

  const cell = await page.evaluate(() => window.__testBoard?.findBuildableCell(25) ?? null);
  expect(cell).not.toBeNull();
  if (!cell) {
    return;
  }
  await canvas.click({
    position: {
      x: ((cell.x + 0.5) / map.snapshot.map.width) * box.width,
      y: ((cell.y + 0.5) / map.snapshot.map.height) * box.height
    }
  });
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
  const after = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: { towers: Array<{ x: number; y: number }> } };
  expect(after.snapshot.towers[0]).toMatchObject({ x: cell.x, y: cell.y });
});

test("settings from the menu persist volume and mute across reload", async ({ page }) => {
  await startMatch(page, "/");
  await page.getByRole("button", { name: "Back To Menu" }).click();
  const opener = page.locator("#menuSettingsBtn");
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("#settingsVolume")).toHaveValue("70");

  await page.locator("#settingsVolume").fill("35");
  await expect(page.locator("#settingsVolumeValue")).toHaveText("35%");
  await page.locator("#settingsMuteBtn").click();
  await expect(page.locator("#settingsMuteBtn")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  const stored = await page.evaluate(() => localStorage.getItem("towerDefense.settings.v1"));
  expect(JSON.parse(stored ?? "null")).toEqual({ version: 1, effectsVolume: 0.35, muted: true });

  await page.reload();
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#settingsVolume")).toHaveValue("35");
  await expect(page.locator("#settingsMuteBtn")).toHaveAttribute("aria-pressed", "true");
});

test("in-match settings dialog closes with Esc and blocks hotkeys while open", async ({ page }) => {
  await startMatch(page, "/");
  const select = page.locator("#playerId");
  await expect(select).toHaveValue("p1");
  await page.locator("#settingsBtn").click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

  await expect(page.locator("#gameScreen")).toHaveAttribute("inert", "");
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => {
      const active = document.activeElement;
      // With the page inert, Tab can only land in the dialog or leave the document (body).
      return active === document.body || active?.closest("#settingsRoot") != null;
    })).toBe(true);
  }

  await page.locator("#settingsCloseBtn").focus();
  await page.keyboard.press("2");
  await page.keyboard.press("m");
  await expect(select).toHaveValue("p1");
  await expect(page.locator("#settingsMuteBtn")).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
  await expect(page.locator("#gameScreen")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#settingsBtn")).toBeFocused();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("m");
  const stored = await page.evaluate(() => localStorage.getItem("towerDefense.settings.v1"));
  expect(JSON.parse(stored ?? "null").muted).toBe(true);
});

test("the game runs without Web Audio", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const scope = window as unknown as Record<string, unknown>;
    delete scope.AudioContext;
    delete scope.webkitAudioContext;
  });
  await startMatch(page, "/");
  await clickBuildableCell(page);
  await page.locator("#settingsBtn").click();
  await page.locator("#settingsVolume").fill("20");
  await page.keyboard.press("Escape");
  await expect(page.locator("#gameScreen")).toBeVisible();
  expect(errors).toEqual([]);
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

test("hovering a tower shows its level and combat stats", async ({ page }) => {
  await startMatch(page, "/");
  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");

  const tooltip = page.locator(".tower-tooltip");
  await expect(tooltip).toBeHidden();
  const position = await page.evaluate(() => window.__testBoard?.cellToPixel(9, 6) ?? null);
  await page.locator("#board canvas").hover({ position: position! });
  await expect(tooltip).toBeVisible();
  for (const label of ["Level", "Range", "Damage", "DPS", "Accuracy"]) {
    await expect(tooltip).toContainText(label);
  }

  await page.locator("#board canvas").hover({ position: { x: 2, y: 2 } });
  await expect(tooltip).toBeHidden();
});

test("player names are shown as text on the match-end overlay, never parsed as HTML", async ({ page }) => {
  const hostile = "<img src=x onerror=window.__xss=1>";
  const tricky = "Tom & <b>Jerry</b>";
  await startMatch(page, "/");

  const liveSnapshot = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: Record<string, unknown> };
  const players = liveSnapshot.snapshot.players as Array<Record<string, unknown>>;
  const endedSnapshot = {
    ...liveSnapshot.snapshot,
    phase: "ended",
    winnerId: "p1",
    endReason: "score-win",
    players: [
      { ...players[0], name: hostile, points: 1000 },
      { ...players[0], id: "p2", name: tricky, points: 10 }
    ]
  };
  await page.route("**/api/snapshot*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, snapshot: endedSnapshot }) });
  }, { times: 1 });
  await page.getByRole("button", { name: "Refresh Snapshot" }).click();

  const scores = page.locator("#matchEndScores");
  await expect(page.locator("#matchEndOverlay")).toBeVisible();
  await expect(scores).toContainText(hostile);
  await expect(scores).toContainText(tricky);
  await expect(scores.locator("img, b")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("changing the target mode sends a command", async ({ page }) => {
  await startMatch(page, "/");
  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");

  // Target mode is available in prep.
  await expect(page.locator("#mode")).toBeEnabled();
  const commands: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/command")) {
      commands.push(request.postData() ?? "");
    }
  });
  await page.locator("#mode").selectOption("nearest");
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toContain("set-target-mode");
  await expect(page.locator("#feedbackQueue")).not.toContainText("rejected");
  await expect(page.locator("#mode")).toHaveValue("nearest");
});

test("the damage type selector follows the tower, is sent as a command and locks once the player is ready", async ({ page }) => {
  await startMatch(page, "/");
  // Nothing to change before a tower exists.
  await expect(page.locator("#damageType")).toBeDisabled();
  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
  await expect(page.locator("#damageType")).toBeEnabled();
  await expect(page.locator("#damageType")).toHaveValue("physical");

  const commands: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/command")) {
      commands.push(request.postData() ?? "");
    }
  });
  await page.locator("#damageType").selectOption("magic");
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toContain("set-damage-type");
  expect(commands[0]).toContain("magic");
  await expect(page.locator("#feedbackQueue")).not.toContainText("rejected");
  const live = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: { towers: Array<{ playerId: string; damageType: string }> } };
  expect(live.snapshot.towers.find((tower) => tower.playerId === "p1")?.damageType).toBe("magic");

  // Readying commits the type: the control locks, like the upgrade buttons.
  await page.locator("#readyBtn").click();
  await expect(page.locator("#damageType")).toBeDisabled();
  await expect(page.locator("#damageType")).toHaveValue("magic");
});

async function showEndedOverlay(page: Page): Promise<void> {
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

test("match-end modal is a real dialog: focus moves in, Tab stays inside, Escape closes it for good", async ({ page }) => {
  await startMatch(page, "/");
  const modal = page.locator(".match-end-modal");
  await showEndedOverlay(page);

  await expect(modal).toHaveAttribute("role", "dialog");
  await expect(modal).toHaveAttribute("aria-modal", "true");
  await expect(modal).toHaveAttribute("aria-labelledby", "matchEndTitle");
  await expect(page.locator("#matchEndTitle")).toHaveText("Match Ended");
  await expect(page.locator("#rematchBtn")).toBeFocused();
  await expect(page.locator("#gameScreen")).toHaveAttribute("inert", "");

  for (let press = 0; press < 8; press += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => Boolean(document.activeElement?.closest(".match-end-modal")));
    expect(inside, `focus escaped the modal on Tab press ${press + 1}`).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(page.locator("#matchEndOverlay")).toBeHidden();
  await expect(page.locator("#gameScreen")).not.toHaveAttribute("inert", "");
  // Focus goes back to the button that was focused when the modal opened.
  await expect(page.getByRole("button", { name: "Refresh Snapshot" })).toBeFocused();

  // Refreshing the same ended match must not pop the dismissed modal open again.
  await page.getByRole("button", { name: "Refresh Snapshot" }).click();
  await page.waitForTimeout(500);
  await expect(page.locator("#matchEndOverlay")).toBeHidden();
});

test("the guide close button has an accessible name and the shortcut bar matches real hotkeys", async ({ page }) => {
  await startMatch(page, "/");
  await expect(page.locator("#guideCloseBtn")).toHaveAttribute("aria-label", "Dismiss guidance");
  await expect(page.locator("#guideCloseBtn")).toHaveAttribute("title", "Dismiss guidance");
  const bar = page.locator("#shortcutBar");
  for (const text of ["ready", "tower", "upgrade", "switch player", "pause", "mute", "move cursor"]) {
    await expect(bar).toContainText(text);
  }
});

test("the prep banner previews the next wave and combat shows creatures still to spawn", async ({ page }) => {
  await startMatch(page, "/");
  await expect(page.locator("#wavePreview")).toHaveText("Next wave 1: 1x Runner (weak: physical), 1x Swarm (weak: explosive), 1x Armored (weak: magic)");

  await clickCellNearSpawn(page, 0);
  await page.locator("#playerId").selectOption("p2");
  await clickCellNearSpawn(page, 1);
  await page.locator("#readyBtn").click();
  await page.locator("#playerId").selectOption("p1");
  await page.locator("#readyBtn").click();

  await expect(page.locator("#phaseLabel")).toHaveText("WAVE 1 COMBAT");
  await expect(page.locator("#wavePreview")).toHaveText("");
  await expect(page.locator("#battlefieldMeta")).toContainText("still to spawn");
  await expect(page.locator("#phaseLabel")).toHaveText("PLACEMENT PHASE", { timeout: 20_000 });
  await expect(page.locator("#wavePreview")).toHaveText(/^Next wave 2: .*Tank/);
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
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
  commands.length = 0;
  await page.keyboard.press("t");
  await page.waitForTimeout(300);
  expect(commands).toEqual([]);
});

test("starting a match over a running one asks first, and the menu offers to resume", async ({ page }) => {
  await startMatch(page, "/");
  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");

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
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
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

test("the move button explains itself while locked and, once unlocked, sends a move on the next tile click", async ({ page }) => {
  await startMatch(page, "/");
  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");

  const commands: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/command")) {
      commands.push(request.postData() ?? "");
    }
  });

  // Locked before round 5 is done: dimmed, labelled, and a press only explains.
  await expect(page.locator("#moveTowerBtn")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#moveTowerCost")).toHaveText("after R5");
  await page.locator("#moveTowerBtn").click({ force: true });
  await expect(page.locator("#feedbackQueue")).toContainText("unlocks after round 5");
  await expect(page.locator("#moveTowerBtn")).toHaveAttribute("aria-pressed", "false");
  expect(commands).toEqual([]);

  // A snapshot from round 6 where the player still holds the token enables it.
  const live = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: Record<string, unknown> };
  const unlocked = {
    ...live.snapshot,
    wave: 6,
    players: (live.snapshot.players as Array<Record<string, unknown>>).map((player) => ({ ...player, towerMoveAvailable: player.id === "p1" }))
  };
  await page.route("**/api/snapshot*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, snapshot: unlocked }) });
  }, { times: 1 });
  await page.getByRole("button", { name: "Refresh Snapshot" }).click();
  await expect(page.locator("#moveTowerBtn")).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator("#moveTowerCost")).toHaveText("free");

  await page.keyboard.press("v");
  await expect(page.locator("#moveTowerBtn")).toHaveAttribute("aria-pressed", "true");
  await clickBuildableCell(page, 3);
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toContain('"type":"move-tower"');
  expect(commands[0]).toContain('"towerId":"tower-p1"');
});

test("the map preview blocks placement, closes with Esc, and does not reappear on reconnect", async ({ page }) => {
  await openMenu(page, "/");
  await page.locator("#menuSeed").fill("777");
  await page.getByRole("button", { name: "Start Match" }).click();
  const dialog = page.locator("#mapPreviewRoot");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#mapPreviewCanvas")).toBeVisible();
  await expect(dialog).toContainText("Protected area");

  // Hotkeys are off while it is open, and Tab stays on the Continue button.
  await page.keyboard.press("t");
  await page.keyboard.press("Tab");
  await expect(page.locator("#mapPreviewContinueBtn")).toBeFocused();
  const snapshot = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: { towers: unknown[] } };
  expect(snapshot.snapshot.towers).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Reloading reconnects to the running match without the preview.
  await page.reload();
  await expect(page.locator("#gameScreen")).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("starting further matches replaces the board instead of leaking canvases and tooltips", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await startMatch(page, "/");
  for (let round = 0; round < 3; round += 1) {
    await page.getByRole("button", { name: "Back To Menu" }).click();
    await page.getByRole("button", { name: "Start Match" }).click();
    await expect(page.locator("#gameScreen")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("#mapPreviewRoot")).toBeHidden();
    await expect(page.locator("#board canvas")).toHaveCount(1);
    await expect(page.locator("#board .tower-tooltip")).toHaveCount(1);
  }

  // The fresh board still takes clicks: placing a tower works after the replacements.
  await clickBuildableCell(page);
  await expect(page.locator("#status")).toHaveText("accepted");
  expect(pageErrors).toEqual([]);
});

test("the map preview still closes with Esc after a click on its backdrop moved focus away", async ({ page }) => {
  await openMenu(page, "/");
  await page.getByRole("button", { name: "Start Match" }).click();
  const dialog = page.locator("#mapPreviewRoot");
  await expect(dialog).toBeVisible();
  await dialog.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#gameScreen")).not.toHaveAttribute("inert", "");
});
