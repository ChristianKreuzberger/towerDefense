import { expect, test } from "@playwright/test";
import { installCommonSetup, clickTowerSpot, clickCellNearSpawn, startMatch } from "./helpers";

installCommonSetup();

test("clicking the road is refused with a hint, and a tower spot accepts the tower", async ({ page }) => {
  await startMatch(page, "/");
  const { snapshot } = (await (await page.request.get("/api/snapshot")).json()) as {
    snapshot: {
      map: {
        spawn: { x: number; y: number };
        cells: Array<{ x: number; y: number; buildable: boolean }>;
        towerSpots: Array<{ x: number; y: number }>;
      };
    };
  };
  const { spawn, cells, towerSpots } = snapshot.map;
  // A road cell well outside the cave's protected area, so only "not a tower spot" can reject it.
  const road = cells.find((cell) => cell.buildable && Math.hypot(cell.x - spawn.x, cell.y - spawn.y) > 10);
  expect(road).toBeTruthy();
  expect(towerSpots.some((spot) => spot.x === road?.x && spot.y === road?.y)).toBe(false);

  const roadPixel = await page.evaluate(({ x, y }) => window.__testBoard?.cellToPixel(x, y) ?? null, road!);
  expect(roadPixel).not.toBeNull();
  await page.locator("#board canvas").click({ position: roadPixel! });
  await expect(page.locator("#feedbackQueue")).toContainText("towers go on the marked spots");
  const afterRoad = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: { towers: unknown[] } };
  expect(afterRoad.snapshot.towers).toHaveLength(0);

  await clickTowerSpot(page);
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
});

test("creatures glide between snapshots instead of jumping", async ({ page }) => {
  await startMatch(page, "/");
  await clickTowerSpot(page);
  await page.locator("#playerId").selectOption("p2");
  await clickTowerSpot(page);
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
          targetTowerId: "tower-p1",
          lane: 0
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
    const start = performance.now();
    // At least 1.5 s, and keep going (up to 10 s) until enough frames were seen: a slow CI runner renders far
    // fewer frames per second, which must not fail the test as long as the glide itself is observable.
    while (performance.now() - start < 1500 || (xs.length <= 10 && performance.now() - start < 10_000)) {
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
  const cell = await page.evaluate(() => window.__testBoard?.findTowerSpot(5) ?? null);
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

test("board renders 20% larger by default and clicks stay accurate", async ({ page }) => {
  // The page no longer scrolls (spec 11, Mobile layout), so the board is only shown at full size when the viewport
  // is tall enough to hold it beside the HUD rows.
  await page.setViewportSize({ width: 1600, height: 1400 });
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

  const cell = await page.evaluate(() => window.__testBoard?.findTowerSpot(5) ?? null);
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

test("hovering a tower shows its level and combat stats", async ({ page }) => {
  await startMatch(page, "/");
  await clickCellNearSpawn(page, 0);
  await expect(page.locator("#playerCards")).toContainText("Tower 100/100");

  const tooltip = page.locator(".tower-tooltip");
  await expect(tooltip).toBeHidden();
  const towers = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: { towers: Array<{ x: number; y: number }> } };
  const tower = towers.snapshot.towers[0]!;
  const position = await page.evaluate(({ x, y }) => window.__testBoard?.cellToPixel(x, y) ?? null, tower);
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

test("the prep banner previews the next wave and combat shows creatures still to spawn", async ({ page }) => {
  await startMatch(page, "/");
  await expect(page.locator("#wavePreview")).toHaveText("Next wave 1: 2x Runner (weak: physical), 1x Swarm (weak: explosive), 1x Armored (weak: magic), 1x Tank (weak: physical)");

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
  await clickTowerSpot(page, 3);
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toContain('"type":"move-tower"');
  expect(commands[0]).toContain('"towerId":"tower-p1"');
});
