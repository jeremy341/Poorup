import { test, expect } from "@playwright/test";

const THEME_TRACKS = {
  original: "pondering-the-cosmos",
  spring: "hot-springs-town",
  summer: "summers",
  autumn: "autumn",
  winter: "snowy-village",
  light: "town",
};

test.describe("theme music runtime", () => {
  test("does not mount a visible player or add layout space", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-music-runtime]")).toHaveCount(1);
    await expect(page.locator("[data-music-runtime]")).toBeHidden();
    await expect(page.locator("[data-music-box]")).toHaveCount(0);
    await expect(page.locator("[data-music-audio]")).toHaveCount(2);
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight,
    }));
    expect(overflow.width).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.height).toBeGreaterThan(0);
  });

  test("keeps exactly one looping track for every theme", async ({ page }) => {
    await page.goto("/");
    const snapshots = await page.evaluate(async (expected) => {
      const controller = window.__poorupThemeMusicController;
      const result = {};
      for (const [theme, track] of Object.entries(expected)) {
        controller.setTheme(theme, { userInitiated: true });
        const snapshot = controller.snapshot();
        result[theme] = {
          track: snapshot.currentTrackId,
          queue: snapshot.queue,
          loop: snapshot.loop,
          shuffle: snapshot.shuffle,
          mode: snapshot.mode,
        };
      }
      return result;
    }, THEME_TRACKS);
    for (const [theme, track] of Object.entries(THEME_TRACKS)) {
      expect(snapshots[theme]).toEqual({ track, queue: [track], loop: true, shuffle: false, mode: "AUTO THEME" });
    }
  });

  test("theme switching does not expose custom-track controls", async ({ page }) => {
    await page.goto("/");
    for (const selector of [
      '[data-music-action="previous"]',
      '[data-music-action="next"]',
      '[data-music-action="shuffle"]',
      '[data-music-action="repeat"]',
      '[data-music-action="volume"]',
      '[data-music-action="position"]',
      "#music-volume-popover",
      "#music-position-menu",
    ]) {
      await expect(page.locator(selector)).toHaveCount(0);
    }
    await expect(page.locator("#music-toggle-btn")).toHaveCount(1);
  });

  test("existing music toggle remains the only user-facing music control", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator("#music-toggle-btn");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-music-runtime]")).toBeHidden();
  });

  test("the runtime remains global across SPA surfaces", async ({ page }) => {
    await page.goto("/");
    for (const tab of ["rooms", "profile", "rankings", "social", "rules"]) {
      await page.keyboard.press("Escape");
      const button = page.locator(`[data-home-tab="${tab}"]:visible, [data-top-surface="${tab}"]:visible`).first();
      await button.click();
      await expect(page.locator("[data-music-runtime]")).toHaveCount(1);
      await expect(page.locator("[data-music-box]")).toHaveCount(0);
    }
  });
});
