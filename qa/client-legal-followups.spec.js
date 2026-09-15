/* global window, document, Event, localStorage, HTMLMediaElement, DOMException */
import { test, expect } from "@playwright/test";

async function startPendingTrack(page) {
  const audios = page.locator("[data-music-audio]");
  await expect(audios).toHaveCount(2);
  await page.evaluate(() => {
    window.__poorupMusicBoxController.resetToThemeTrack();
    document.querySelectorAll("[data-music-audio]").forEach(audio => audio.dispatchEvent(new Event("canplay")));
  });
}

test("A/B music retry uses the current blocked status and succeeds from the dock", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("poorup.music.enabled.v1", "1");
    window.__poorupPlayCalls = 0;
    HTMLMediaElement.prototype.play = function play() {
      window.__poorupPlayCalls += 1;
      return window.__poorupPlayCalls === 1
        ? Promise.reject(new DOMException("autoplay blocked", "NotAllowedError"))
        : Promise.resolve();
    };
  });
  await page.goto("/");
  await startPendingTrack(page);
  await expect.poll(() => page.evaluate(() => window.__poorupMusicBoxController?.snapshot().status)).toBe("autoplay-blocked");
  await expect(page.locator("[data-music-status]")).toContainText("autoplay-blocked");
  const firstPlayCalls = await page.evaluate(() => window.__poorupPlayCalls);

  await page.locator('[data-music-action="play"]').click();
  await expect.poll(() => page.evaluate(() => window.__poorupMusicBoxController?.snapshot().status)).toBe("playing");
  await expect.poll(() => page.evaluate(() => window.__poorupPlayCalls)).toBe(firstPlayCalls + 1);
  await expect(page.locator("#music-status")).toContainText("playing");
});

test("current A/B event listeners distinguish loop-off ended from stalled errors", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("poorup.music.enabled.v1", "1");
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  await page.goto("/");
  await startPendingTrack(page);
  await expect.poll(() => page.evaluate(() => window.__poorupMusicBoxController?.snapshot().status)).toBe("playing");

  await page.evaluate(() => {
    const controller = window.__poorupMusicBoxController;
    controller.toggleLoop();
    document.querySelectorAll("[data-music-audio]").forEach(audio => audio.dispatchEvent(new Event("ended")));
  });
  await expect.poll(() => page.evaluate(() => window.__poorupMusicBoxController?.snapshot().status)).toBe("ended");
  await expect(page.locator("#music-status")).toContainText("ended");

  await page.evaluate(() => {
    document.querySelectorAll("[data-music-audio]").forEach(audio => audio.dispatchEvent(new Event("stalled")));
  });
  await expect.poll(() => page.evaluate(() => window.__poorupMusicBoxController?.snapshot().status)).toBe("track-error");
  await expect(page.locator("#music-status")).toContainText("track-error");
});
