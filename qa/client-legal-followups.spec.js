import { test, expect } from "@playwright/test";

test("music retry state is announced once and distinguishes media errors", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("poorup.music.enabled.v1", "1");
    window.__poorupPlayCalls = 0;
    HTMLMediaElement.prototype.play = function play() {
      window.__poorupPlayCalls += 1;
      return Promise.resolve();
    };
  });
  await page.goto("/");
  await expect(page.locator("#music-toggle-btn")).toHaveAttribute("aria-label", "Turn parlor music off");
  const firstPlayCalls = await page.evaluate(() => window.__poorupPlayCalls);
  expect(firstPlayCalls).toBe(1);

  await page.evaluate(() => document.querySelector("#home-music").dispatchEvent(new Event("error")));
  await expect(page.locator("#music-toggle-btn")).toHaveAttribute("aria-label", /unavailable/i);
  await expect(page.locator("#music-status")).toContainText(/could not be loaded/i);
  await page.evaluate(() => document.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
  await expect.poll(() => page.evaluate(() => window.__poorupPlayCalls)).toBe(firstPlayCalls + 1);
  await expect(page.locator("#music-toggle-btn")).toHaveAttribute("aria-label", "Turn parlor music off");
});

test("music ended and stalled events have distinct live messages", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("poorup.music.enabled.v1", "1");
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  await page.goto("/");
  await page.evaluate(() => document.querySelector("#home-music").dispatchEvent(new Event("stalled")));
  await expect(page.locator("#music-status")).toContainText(/waiting for audio data/i);
  await page.evaluate(() => document.querySelector("#home-music").dispatchEvent(new Event("ended")));
  await expect(page.locator("#music-status")).toContainText(/ended/i);
});
