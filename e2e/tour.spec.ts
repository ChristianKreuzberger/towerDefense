import { expect, test } from "@playwright/test";
import { installCommonSetup, openMenu } from "./helpers";

installCommonSetup();

test("tour: the first match opens the how-to-play tour before placement, and only once", async ({ page }) => {
  await openMenu(page, "/");
  await page.getByRole("button", { name: "Start Match" }).click();
  const tour = page.locator("#tourRoot");
  await expect(tour).toBeVisible();
  await expect(tour).toContainText("1000 points");
  await expect(tour).toContainText("Step 1 of 5");
  await expect(page.locator("#tourBackBtn")).toBeHidden();
  await expect(page.locator("#gameScreen")).toHaveAttribute("inert", "");

  // Hotkeys are off while it is open.
  await page.keyboard.press("t");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(tour).toContainText("Step 2 of 5");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(tour).toContainText("Step 1 of 5");
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(tour).toContainText("Step 5 of 5");
  await page.getByRole("button", { name: "Start playing" }).click();
  await expect(tour).toBeHidden();
  await expect(page.locator("#placeTowerBtn")).toBeFocused();

  // Seen once: the next match goes straight to placement.
  await page.getByRole("button", { name: "Back To Menu" }).click();
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(tour).toBeHidden();
  await expect(page.locator("#gameScreen")).not.toHaveAttribute("inert", "");
});

test("tour: Esc counts as seen, and How to play reopens it", async ({ page }) => {
  await openMenu(page, "/");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.locator("#tourRoot")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#tourRoot")).toBeHidden();

  await page.locator("#tourBtn").click();
  await expect(page.locator("#tourRoot")).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.locator("#tourRoot")).toBeHidden();
  await expect(page.locator("#tourBtn")).toBeFocused();

  await page.getByRole("button", { name: "Back To Menu" }).click();
  await page.locator("#menuTourBtn").click();
  await expect(page.locator("#tourRoot")).toBeVisible();
});
