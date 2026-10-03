import { expect, test, type Page } from "@playwright/test";
import { installCommonSetup, cellPixel, clickTowerSpot, startMatch } from "./helpers";

installCommonSetup();

interface TowerView {
  x: number;
  y: number;
  playerId: string;
  upgrades: Record<string, number>;
}

async function towers(page: Page): Promise<TowerView[]> {
  const { snapshot } = (await (await page.request.get("/api/snapshot")).json()) as { snapshot: { towers: TowerView[] } };
  return snapshot.towers;
}

// The page is overflow:hidden, so the root alone would hide an overflowing layout: check the game screen's content too.
async function pageOverflow(page: Page): Promise<{ vertical: number; horizontal: number }> {
  return page.evaluate(() => {
    const root = document.scrollingElement!;
    const game = document.getElementById("gameScreen")!;
    const gameVisible = !game.classList.contains("hidden");
    return {
      vertical: Math.max(root.scrollHeight - window.innerHeight, gameVisible ? game.scrollHeight - game.clientHeight : 0),
      horizontal: Math.max(root.scrollWidth - window.innerWidth, gameVisible ? game.scrollWidth - game.clientWidth : 0)
    };
  });
}

async function boardBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await page.locator("#board canvas").boundingBox())!;
}

for (const size of [
  { name: "phone", viewport: { width: 390, height: 844 } },
  { name: "desktop", viewport: { width: 1280, height: 720 } }
]) {
  test.describe(`${size.name} shell`, () => {
    test.use({ viewport: size.viewport, hasTouch: size.name === "phone" });

    test("the page never scrolls and the board does not move when text appears", async ({ page }) => {
      await startMatch(page, "/");
      expect(await pageOverflow(page)).toEqual({ vertical: 0, horizontal: 0 });
      const before = await boardBox(page);
      expect(before.y + before.height).toBeLessThanOrEqual(size.viewport.height);

      // Placement rewrites the guide, the next-wave line, the meta line and shows toasts and the turn banner.
      await clickTowerSpot(page);
      if (size.name === "phone") {
        // Compact layout: the first tap only selects the spot, the second confirms.
        await clickTowerSpot(page);
      }
      await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
      expect(await boardBox(page)).toEqual(before);
      await page.locator("#readyBtn").click();
      await expect(page.locator("#turnBanner")).toHaveClass(/show/);
      expect(await boardBox(page)).toEqual(before);
      await page.locator("#guideCloseBtn").click();
      expect(await boardBox(page)).toEqual(before);
      expect(await pageOverflow(page)).toEqual({ vertical: 0, horizontal: 0 });
    });

    test("the menu fits the page too", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("#menuScreen")).toBeVisible();
      expect(await pageOverflow(page)).toEqual({ vertical: 0, horizontal: 0 });
    });
  });
}

test.describe("compact layout", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("secondary controls live in a sheet opened by More", async ({ page }) => {
    await startMatch(page, "/");
    await expect(page.locator("#shortcutBar")).toBeHidden();
    await expect(page.locator("#mobileMoreBtn")).toBeVisible();
    await expect(page.locator("#upgradeRangeBtn")).toBeHidden();
    await expect(page.locator("#mode")).toBeHidden();
    await page.locator("#mobileMoreBtn").click();
    await expect(page.locator("#mobileMoreBtn")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#mode")).toBeVisible();
    await expect(page.locator("#damageType")).toBeVisible();
    for (const name of ["How to play", "Settings", "Back To Menu"]) {
      await expect(page.locator("#panelMore").getByRole("button", { name })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(page.locator("#mode")).toBeHidden();
    await page.locator("#mobileMoreBtn").click();
    await page.locator("#board canvas").tap({ position: { x: 4, y: 4 } });
    await expect(page.locator("#mode")).toBeHidden();
  });

  test("placing a tower is select, then confirm; a near miss snaps to the spot", async ({ page }) => {
    await startMatch(page, "/");
    const canvas = page.locator("#board canvas");
    const spot = await page.evaluate(() => window.__testBoard!.findTowerSpot(0)!);
    const exact = await cellPixel(page);
    const cell = await page.evaluate(() => window.__testBoard!.cellToPixel(1, 0).x - window.__testBoard!.cellToPixel(0, 0).x);

    // First tap, one cell beside the spot: snaps to it and only selects it.
    await canvas.tap({ position: { x: exact.x + cell, y: exact.y } });
    await expect(page.locator("#placeTowerBtn .tool-label")).toHaveText("Place here");
    expect(await towers(page)).toHaveLength(0);

    const box = (await page.locator("#placeTowerBtn").boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);

    // A second tap on the selected spot (not on the near miss) places the tower there.
    await canvas.tap({ position: exact });
    await expect.poll(async () => (await towers(page)).length).toBe(1);
    expect((await towers(page))[0]).toMatchObject({ x: spot.x, y: spot.y });
    await expect(page.locator("#placeTowerBtn .tool-label")).toHaveText("Place Tower");
  });

  test("a new match drops the touch selection", async ({ page }) => {
    await startMatch(page, "/");
    await page.locator("#board canvas").tap({ position: await cellPixel(page) });
    await expect(page.locator("#placeTowerBtn .tool-label")).toHaveText("Place here");
    await page.locator("#mobileMoreBtn").click();
    await page.getByRole("button", { name: "Back To Menu" }).click();
    await page.getByRole("button", { name: "Start Match" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("#mapPreviewRoot")).toBeHidden();
    await expect(page.locator("#placeTowerBtn .tool-label")).toHaveText("Place Tower");
    // The first tap only selects again, so nothing is placed.
    await page.locator("#board canvas").tap({ position: await cellPixel(page) });
    expect(await towers(page)).toHaveLength(0);
  });

  test("the Place button confirms the selected spot", async ({ page }) => {
    await startMatch(page, "/");
    await page.locator("#board canvas").tap({ position: await cellPixel(page) });
    expect(await towers(page)).toHaveLength(0);
    await page.locator("#placeTowerBtn").tap();
    await expect.poll(async () => (await towers(page)).length).toBe(1);
  });

  test("tapping a tower opens the upgrade popover and a purchase raises its level", async ({ page }) => {
    await startMatch(page, "/");
    await page.locator("#board canvas").tap({ position: await cellPixel(page) });
    await page.locator("#board canvas").tap({ position: await cellPixel(page) });
    await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
    const [tower] = await towers(page);
    await expect(page.locator("#towerMenu")).toBeHidden();

    const position = await page.evaluate(({ x, y }) => window.__testBoard!.cellToPixel(x, y), tower!);
    await page.locator("#board canvas").tap({ position });
    const menu = page.locator("#towerMenu");
    await expect(menu).toBeVisible();
    // Docked to the bottom of the board on narrow screens.
    const box = (await menu.boundingBox())!;
    const board = (await page.locator("#board").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(board.y + board.height + 1);
    expect(box.y).toBeGreaterThan(board.y + board.height / 2);

    await menu.locator('[data-track="damage"]').tap();
    await expect.poll(async () => (await towers(page))[0]!.upgrades.damage).toBe(tower!.upgrades.damage! + 1);
    // Stays open for the next purchase; Esc closes it.
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
});

test.describe("tower popover on desktop", () => {
  test("the desktop panel keeps its toolbar and has no More button", async ({ page }) => {
    await startMatch(page, "/");
    await expect(page.locator("#mobileMoreBtn")).toBeHidden();
    await expect(page.locator("#upgradeRangeBtn")).toBeVisible();
    await expect(page.locator("#shortcutBar")).toBeVisible();
  });

  test("a click opens it next to the tower, hot-seat switches to the owner, and a free cell closes it", async ({ page }) => {
    await startMatch(page, "/");
    await clickTowerSpot(page, 0);
    await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
    await page.locator("#readyBtn").click();
    await expect(page.locator("#playerId")).toHaveValue("p2");
    const [first] = await towers(page);
    const position = await page.evaluate(({ x, y }) => window.__testBoard!.cellToPixel(x, y), first!);

    // Player 2 clicks player 1's tower: the popover opens for its owner.
    await page.locator("#board canvas").click({ position });
    await expect(page.locator("#towerMenu")).toBeVisible();
    await expect(page.locator("#playerId")).toHaveValue("p1");
    await expect(page.locator("#towerMenuTitle")).toContainText("Alpha");

    await page.locator("#board canvas").click({ position: { x: 3, y: 3 } });
    await expect(page.locator("#towerMenu")).toBeHidden();
  });
});

test.describe("zoom and pan", () => {
  test("wheel, buttons and keys zoom within limits and clicks still hit the right cell", async ({ page }) => {
    await startMatch(page, "/");
    const canvas = page.locator("#board canvas");
    const spot = (await page.evaluate(() => window.__testBoard!.findTowerSpot(4)))!;
    const at = await page.evaluate(({ x, y }) => window.__testBoard!.cellToPixel(x, y), spot);
    const box = (await boardBox(page))!;
    expect(await page.evaluate(() => window.__testBoard!.zoom())).toBe(1);
    await expect(page.locator("#zoomFitBtn")).toBeDisabled();

    await page.mouse.move(box.x + at.x, box.y + at.y);
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, -200);
    }
    await expect.poll(() => page.evaluate(() => window.__testBoard!.zoom())).toBeGreaterThan(1.5);
    await page.mouse.wheel(0, -20000);
    await expect.poll(() => page.evaluate(() => window.__testBoard!.zoom())).toBe(3);
    await expect(page.locator("#zoomInBtn")).toBeDisabled();

    // The wheel anchored on the cell, so it is still under the pointer; a click there places on that very cell.
    const zoomedAt = await page.evaluate(({ x, y }) => window.__testBoard!.cellToPixel(x, y), spot);
    expect(Math.abs(zoomedAt.x - at.x)).toBeLessThan(2);
    await canvas.click({ position: zoomedAt });
    await expect(page.locator("#playerCards")).toContainText("Tower 100/100");
    expect(await towers(page)).toMatchObject([{ x: spot.x, y: spot.y }]);

    await page.locator("#zoomFitBtn").click();
    expect(await page.evaluate(() => window.__testBoard!.zoom())).toBe(1);
    await page.locator("#zoomInBtn").click();
    expect(await page.evaluate(() => window.__testBoard!.zoom())).toBe(1.25);
    await page.keyboard.press("-");
    expect(await page.evaluate(() => window.__testBoard!.zoom())).toBe(1);
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    expect(await page.evaluate(() => window.__testBoard!.zoom())).toBe(1.5);
    await page.keyboard.press("0");
    expect(await page.evaluate(() => window.__testBoard!.zoom())).toBe(1);
  });

  test("dragging pans a zoomed board without selecting a cell, and a pinch zooms without placing a tower", async ({ page }) => {
    await startMatch(page, "/");
    const canvas = page.locator("#board canvas");
    await page.locator("#zoomInBtn").click();
    await page.locator("#zoomInBtn").click();
    await page.locator("#zoomInBtn").click();
    await page.locator("#zoomInBtn").click();
    expect(await page.evaluate(() => window.__testBoard!.zoom())).toBe(2);

    const spot = (await page.evaluate(() => window.__testBoard!.findTowerSpot(0)))!;
    const before = await page.evaluate(({ x, y }) => window.__testBoard!.cellToPixel(x, y), spot);
    const box = (await boardBox(page))!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 40, { steps: 6 });
    await page.mouse.up();
    const after = await page.evaluate(({ x, y }) => window.__testBoard!.cellToPixel(x, y), spot);
    expect(after.x).toBeGreaterThan(before.x + 20);
    expect(after.y).toBeGreaterThan(before.y + 10);
    expect(await towers(page)).toEqual([]);

    // Two pointers moving apart: a pinch. Synthetic events are enough because the scene reads plain pointer events.
    await page.locator("#zoomFitBtn").click();
    await canvas.evaluate((node, { x, y }) => {
      const fire = (type: string, id: number, px: number, py: number): void => {
        node.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: px, clientY: py, bubbles: true, pointerType: "touch", isPrimary: id === 1 }));
      };
      fire("pointerdown", 1, x - 20, y);
      fire("pointerdown", 2, x + 20, y);
      for (let step = 1; step <= 10; step += 1) {
        fire("pointermove", 1, x - 20 - step * 8, y);
        fire("pointermove", 2, x + 20 + step * 8, y);
      }
      fire("pointerup", 2, x + 100, y);
      fire("pointerup", 1, x - 100, y);
    }, { x: cx, y: cy });
    expect(await page.evaluate(() => window.__testBoard!.zoom())).toBeGreaterThan(1.5);
    expect(await towers(page)).toEqual([]);
  });
});
