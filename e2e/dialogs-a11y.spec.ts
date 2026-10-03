import { expect, test } from "@playwright/test";
import { installCommonSetup, clickTowerSpot, startMatch, showEndedOverlay } from "./helpers";

installCommonSetup();

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
  await clickTowerSpot(page);
  await page.locator("#settingsBtn").click();
  await page.locator("#settingsVolume").fill("20");
  await page.keyboard.press("Escape");
  await expect(page.locator("#gameScreen")).toBeVisible();
  expect(errors).toEqual([]);
});

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
