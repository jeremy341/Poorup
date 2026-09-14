import { test, expect } from "@playwright/test";

test.describe("reference-locked music box", () => {
  test("home acceptance viewport records the compact reference geometry", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");

    const box = page.locator("[data-music-box]");
    await expect(box).toHaveCount(1);
    const bounds = await box.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.width).toBeGreaterThanOrEqual(304);
    expect(bounds.width).toBeLessThanOrEqual(324);
    expect(bounds.height).toBeGreaterThanOrEqual(92);
    expect(bounds.height).toBeLessThanOrEqual(104);

    const viewport = page.viewportSize();
    expect(viewport).toEqual({ width: 1920, height: 1080 });
    await expect(page.locator("[data-music-audio]")).toHaveCount(2);
  });
});
