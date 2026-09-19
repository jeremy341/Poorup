import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const evidenceDir = resolve("qa-artifacts", "release-readiness-2026-09-14");

async function capture(page, name) {
  await page.screenshot({
    path: resolve(evidenceDir, `${name}.png`),
    animations: "disabled",
    fullPage: false,
  });
}

test.describe("release readiness visual evidence", () => {
  test("captures the primary 1920px surfaces and focused modal states", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1920", "visual evidence is pinned to the native 1920px viewport");
    mkdirSync(evidenceDir, { recursive: true });

    await page.goto("/");
    await expect(page.locator("#home-main")).toBeVisible();
    await capture(page, "home");

    await page.locator("#home-rooms-tab").click();
    await expect(page.locator("#rooms-modal")).not.toHaveClass(/is-hidden/);
    await capture(page, "rooms-browser");
    await page.locator("#rm-tab-create").click();
    await expect(page.locator("#rm-panel-create")).not.toHaveClass(/is-hidden/);
    await capture(page, "room-create");
    await page.locator("#rooms-close").click();

    await page.locator("#home-profile-tab").click();
    await page.locator("#profile-tab-account").click();
    await expect(page.locator("#profile-panel-account")).toBeVisible();
    await capture(page, "profile-account");
    await page.locator("#theme-open-btn").click();
    await expect(page.locator("#theme-popover")).toBeVisible();
    await capture(page, "profile-theme-selector");
    await page.keyboard.press("Escape");

    await page.goto("/");
    await page.locator("#home-rankings-tab").click();
    await expect(page.locator("#rankings-page-content [data-ranking-stage]")).toBeVisible();
    await capture(page, "rankings");

    await page.goto("/");
    await page.locator("#home-social-tab").click();
    await expect(page.locator("#social-page-content")).toBeVisible();
    await capture(page, "social-guest");

    await page.goto("/?rules=book");
    await expect(page.locator("#rules-page-content")).toBeVisible();
    await capture(page, "rules");

    await page.goto("/admin/analytics");
    await expect(page.locator("#admin-analytics-main")).toBeVisible();
    await capture(page, "analytics");

    await page.goto("/");
    await page.locator("#home-alias").fill("RELEASE");
    await page.locator("#open-create-btn").click();
    await page.locator("#rm-tab-create").click();
    await page.locator("#rc-vis-selector [data-vis='private']").click();
    const roomCode = `Q${Date.now().toString(36).slice(-5).toUpperCase()}`;
    await page.locator("#rc-room-code").fill(roomCode);
    await page.locator("#rc-create-btn").click();
    await expect(page.locator("#setup-wrap")).toHaveAttribute("aria-hidden", "false");
    await page.locator("#su-start").click();
    await expect(page.locator("#right-rail-lobby")).toBeVisible();
    await capture(page, "lobby");

    await page.locator("#lobby-settings-body [data-step='bots'][data-dir='1']").click();
    await page.locator("#lobby-start-btn").click();
    await expect(page.locator("#right-rail-game")).toBeVisible();
    await capture(page, "game");
    await page.locator("#hud-cash-action").click();
    await expect(page.locator("#wallet-modal")).not.toHaveClass(/is-hidden/);
    await capture(page, "wallet-modal");
  });
});
