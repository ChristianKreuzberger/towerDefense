import { expect, test } from "@playwright/test";
import { installCommonSetup, openMenu } from "./helpers";

installCommonSetup();

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
