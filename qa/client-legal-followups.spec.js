import { test, expect } from "@playwright/test";

test("theme soundtrack exposes a single deterministic looping track", async ({ page }) => {
  await page.goto("/");
  const values = await page.evaluate(() => {
    const controller = window.__poorupThemeMusicController;
    const result = {};
    for (const theme of ["original", "spring", "summer", "autumn", "winter", "light"]) {
      controller.setTheme(theme, { userInitiated: true });
      const snapshot = controller.snapshot();
      result[theme] = { track: snapshot.currentTrackId, queue: snapshot.queue, loop: snapshot.loop, mode: snapshot.mode };
    }
    return result;
  });
  expect(values.original).toEqual({ track: "pondering-the-cosmos", queue: ["pondering-the-cosmos"], loop: true, mode: "AUTO THEME" });
  expect(values.spring).toEqual({ track: "hot-springs-town", queue: ["hot-springs-town"], loop: true, mode: "AUTO THEME" });
  expect(values.summer).toEqual({ track: "summers", queue: ["summers"], loop: true, mode: "AUTO THEME" });
  expect(values.autumn).toEqual({ track: "autumn", queue: ["autumn"], loop: true, mode: "AUTO THEME" });
  expect(values.winter).toEqual({ track: "snowy-village", queue: ["snowy-village"], loop: true, mode: "AUTO THEME" });
  expect(values.light).toEqual({ track: "town", queue: ["town"], loop: true, mode: "AUTO THEME" });
});

test("music toggle can stop and resume the hidden soundtrack runtime", async ({ page }) => {
  await page.goto("/");
  const toggle = page.locator("#music-toggle-btn");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-music-runtime]")).toBeHidden();
  await expect(page.locator("[data-music-box]")).toHaveCount(0);
});
