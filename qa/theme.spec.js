import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const themeIds = ["original", "spring", "summer", "autumn", "winter", "light"];

async function openThemeChooser(page) {
  await page.goto("/");
  await page.locator("#home-profile-tab").click();
  await page.locator("#profile-tab-account").click();
  await page.locator("#theme-open-btn").click();
  await expect(page.locator("#theme-popover")).toBeVisible();
}

test.describe("Poorup seasonal worlds", () => {
  test("offers six accessible radio choices and restores focus", async ({ page }) => {
    await openThemeChooser(page);
    const choices = page.locator("#theme-popover [data-theme-choice]");
    await expect(choices).toHaveCount(6);
    await expect(choices.first()).toHaveAttribute("type", "radio");
    await expect(choices.first()).toBeChecked();
    await expect(choices.first()).toHaveAttribute("tabindex", "0");
    await expect(choices.nth(1)).toHaveAttribute("tabindex", "-1");
    await choices.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(choices.nth(1)).toBeChecked();
    await expect(page.locator("body")).toHaveAttribute("data-theme-id", "spring");
    await page.keyboard.press("Escape");
    await expect(page.locator("#theme-open-btn")).toBeFocused();
  });

  test("applies a themed scene without changing the shell geometry", async ({ page }) => {
    await page.goto("/");
    await page.locator("#home-profile-tab").click();
    await page.locator("#profile-tab-account").click();
    await page.locator("#theme-open-btn").click();
    // Clicking an offscreen choice scrolls the document on short viewports.
    // Compare layout coordinates so scrolling is not mistaken for reflow.
    const preferencesGeometry = () => page.locator(".profile-preferences").evaluate(element => {
      const rect = element.getBoundingClientRect();
      let x = rect.x;
      let y = rect.y;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        x += parent.scrollLeft;
        y += parent.scrollTop;
      }
      return { x, y, width: rect.width, height: rect.height };
    });
    const baseline = await preferencesGeometry();
    for (const id of themeIds.slice(1)) {
      await page.locator(`[data-theme-choice="${id}"]`).click();
      await expect(page.locator("body")).toHaveAttribute("data-theme-id", id);
      await expect(page.locator("#theme-home-world")).toHaveAttribute("data-theme-id", id);
      await expect(page.locator("#theme-home-world .theme-scene")).toHaveCount(1);
      await expect(page.locator("#theme-home-world .theme-prop-clouds")).toHaveCount(1);
      expect(await preferencesGeometry()).toEqual(baseline);
    }
    await page.locator('[data-theme-choice="original"]').click();
    await expect(page.locator("#theme-home-world")).toBeEmpty();
  });

  test("persists a sanitized preference and synchronizes another tab", async ({ page, context }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("poorup.theme.id.v2", "not-valid"));
    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-theme-id", "original");
    const peer = await context.newPage();
    await peer.goto("/");
    await page.evaluate(() => localStorage.setItem("poorup.theme.id.v2", "winter"));
    await expect(peer.locator("body")).toHaveAttribute("data-theme-id", "winter");
    await peer.close();
  });

  test("keeps the chooser inside the viewport at desktop and phone widths", async ({ page }) => {
    await openThemeChooser(page);
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      popover: document.querySelector("#theme-popover")?.getBoundingClientRect().toJSON(),
    }));
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    expect(metrics.popover.x).toBeGreaterThanOrEqual(0);
    expect(metrics.popover.right).toBeLessThanOrEqual(1920);
  });

  test("captures the six home worlds at native 1920", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1920", "visual evidence is pinned to the primary desktop viewport");
    const evidenceDir = resolve("qa-artifacts", "theme-homes-1920");
    mkdirSync(evidenceDir, { recursive: true });
    for (const id of themeIds) {
      await openThemeChooser(page);
      await page.locator(`[data-theme-choice="${id}"]`).click();
      await page.locator("#profile-back-btn").click();
      await expect(page.locator("body")).toHaveAttribute("data-theme-id", id);
      await page.screenshot({ path: resolve(evidenceDir, `${id}.png`), animations: "disabled" });
    }
  });
});
