import { test, expect } from "@playwright/test";

const themeIds = [
  "midnight-ledger",
  "clearline-day",
  "bloom-district",
  "golden-hour-exchange",
  "rainy-copper-town",
  "warm-window-snow-city",
];

async function openThemeChooser(page) {
  await page.goto("/");
  await page.locator("#home-profile-tab").click();
  await page.locator("#profile-tab-account").click();
  await page.locator("#theme-open-btn").click();
  await expect(page.locator("#theme-popover")).toBeVisible();
}

test.describe("Poorup parlor look themes", () => {
  test("selector exposes six labeled radio choices and restores focus", async ({ page }) => {
    await openThemeChooser(page);
    const choices = page.locator("#theme-popover [data-theme-choice]");
    await expect(choices).toHaveCount(6);
    await expect(choices.first()).toHaveAttribute("role", "radio");
    await expect(choices.first()).toHaveAttribute("aria-checked", "true");
    await expect(choices.first()).toContainText("NIGHT");
    await expect(choices.nth(1)).toContainText("DAY");

    await choices.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", "clearline-day");
    const columns = await page.locator("#theme-popover .theme-choice-grid").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", themeIds[(1 + columns) % themeIds.length]);
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", "clearline-day");
    await page.keyboard.press("End");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", "warm-window-snow-city");
    await page.keyboard.press("Home");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", "midnight-ledger");
    await page.keyboard.press("Escape");
    await expect(page.locator("#theme-popover")).toHaveClass(/is-hidden/);
    await expect(page.locator("#theme-open-btn")).toBeFocused();
    await page.locator("#theme-open-btn").click();
    await page.locator("#theme-popover-close").focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("#theme-popover")).toHaveClass(/is-hidden/);
  });

  test("applying a theme updates local state and decorative layers only", async ({ page }) => {
    await openThemeChooser(page);
    await page.locator('[data-theme-choice="bloom-district"]').press("Enter");
    await expect(page.locator("body")).toHaveAttribute("data-theme-id", "bloom-district");
    await expect(page.locator("#theme-page-world")).toHaveAttribute("data-theme-id", "bloom-district");
    await expect(page.locator("#theme-home-world")).toHaveAttribute("data-theme-id", "bloom-district");
    await expect(page.locator("#theme-board-world")).toHaveAttribute("data-theme-id", "bloom-district");
    await expect(page.locator('[data-theme-choice="bloom-district"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#system-announcer")).toContainText("Bloom District");
    await expect(page.locator("body")).toHaveAttribute("data-theme-id", "bloom-district");

    const state = await page.evaluate(() => ({
      stored: localStorage.getItem("poorup.theme.id.v1"),
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
      actionCount: document.querySelectorAll("[data-home-tab], [data-top-surface]").length,
      sceneButtons: document.querySelectorAll(".theme-page-world button, .theme-home-world button, .theme-board-world button").length,
    }));
    expect(state.stored).toBe("bloom-district");
    expect(state.scrollWidth - state.clientWidth).toBeLessThanOrEqual(2);
    expect(state.sceneButtons).toBe(0);
    expect(state.actionCount).toBeGreaterThan(0);
  });

  test("invalid storage falls back to the original world", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("poorup.theme.id.v1", "not-a-theme"));
    await page.goto("/");
    await expect(page.locator("body")).toHaveAttribute("data-theme-id", "midnight-ledger");
    await expect(page.locator("#theme-page-world")).toHaveAttribute("data-theme-id", "midnight-ledger");
  });

  test("theme preference syncs to a second browser tab", async ({ page, context }) => {
    await page.goto("/");
    const peer = await context.newPage();
    await peer.goto("/");
    await page.evaluate(() => localStorage.setItem("poorup.theme.id.v1", "golden-hour-exchange"));
    await expect(peer.locator("body")).toHaveAttribute("data-theme-id", "golden-hour-exchange");
    await peer.close();
  });

  test("theme layers do not alter the desktop shell geometry", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1920", "Geometry baseline is captured on desktop-1920.");
    await page.goto("/");
    const before = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? [rect.x, rect.y, rect.width, rect.height] : null;
      };
      return { board: box("#board-frame"), home: box("#view-home"), nav: box("#home-nav") };
    });
    await page.locator("#home-profile-tab").click();
    await page.locator("#profile-tab-account").click();
    await page.locator("#theme-open-btn").click();
    await page.locator('[data-theme-choice="warm-window-snow-city"]').click();
    await page.locator('#view-profile [data-home-tab="play"]').click();
    const after = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? [rect.x, rect.y, rect.width, rect.height] : null;
      };
      return { board: box("#board-frame"), home: box("#view-home"), nav: box("#home-nav") };
    });
    expect(after.home).toEqual(before.home);
    expect(after.nav).toEqual(before.nav);
    expect(after.board).toEqual(before.board);
  });

  test("reduced motion settles the scene without travel", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openThemeChooser(page);
    await page.locator('[data-theme-choice="rainy-copper-town"]').press("Enter");
    const motion = await page.locator("#theme-page-world .theme-scene").evaluate((element) => {
      const style = getComputedStyle(element);
      return { animationName: style.animationName, transform: style.transform };
    });
    expect(motion.animationName).toBe("none");
    expect(motion.transform).toBe("none");
  });

  test("theme ids stay aligned with the approved registry", async ({ page }) => {
    await page.goto("/");
    await page.locator("#home-profile-tab").click();
    await page.locator("#profile-tab-account").click();
    await page.locator("#theme-open-btn").click();
    await expect.poll(() => page.locator("#theme-popover [data-theme-choice]").evaluateAll((nodes) => nodes.map((node) => node.dataset.themeChoice))).toEqual(themeIds);
  });

  test("captures the six environments at native 1920px", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1920" || !process.env.POORUP_CAPTURE_VISUALS, "Opt-in native-resolution evidence only.");
    for (const themeId of themeIds) {
      await openThemeChooser(page);
      await page.locator(`[data-theme-choice="${themeId}"]`).click();
      await page.locator('#view-profile [data-home-tab="play"]').click();
      await expect(page.locator("#view-home")).toBeVisible();
      await page.screenshot({ path: `qa-artifacts/themes/${themeId}-home-1920.png`, fullPage: true });
    }
  });

  test("captures the theme chooser at native 1920px", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1920" || !process.env.POORUP_CAPTURE_VISUALS, "Opt-in selector evidence only.");
    await openThemeChooser(page);
    await page.screenshot({ path: "qa-artifacts/themes/theme-selector-profile-1920.png", fullPage: true });
  });

  test("captures a live themed board at native 1920px", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1920" || !process.env.POORUP_CAPTURE_VISUALS, "Opt-in live-board evidence only.");
    const guest = await context.newPage();
    await page.goto("/");
    await page.locator("#home-alias").fill("ALPHA");
    await page.locator("#open-create-btn").click();
    await page.locator('#rc-vis-selector [data-vis="private"]').click();
    await page.locator("#rc-room-code").fill("THEME1");
    await page.locator("#rc-create-btn").click();
    await page.locator("#su-start").click();

    await guest.goto("/");
    await guest.locator("#home-alias").fill("BETA");
    await guest.locator("#open-join-btn").click();
    await guest.locator("#room-join").fill("THEME1");
    await guest.locator("#join-nickname").fill("BETA");
    await guest.locator("#join-room-submit").click();
    await guest.locator("#su-start").click();
    await page.locator("#lobby-start-btn").click();
    await expect(page.locator("#view-game")).toBeVisible();
    await expect(page.locator("#theme-board-world")).toHaveAttribute("data-theme-id", "midnight-ledger");
    await expect(page.locator("#board-frame")).toBeVisible();
    await page.screenshot({ path: "qa-artifacts/themes/midnight-ledger-game-1920.png", fullPage: true });
    await guest.close();
  });
});
