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
    await expect(choices.first()).toHaveAttribute("tabindex", "0");
    await expect(choices.nth(1)).toHaveAttribute("tabindex", "-1");
    await expect(choices.first()).toHaveAttribute("aria-checked", "true");
    await expect(choices.first()).toContainText("NIGHT");
    await expect(choices.nth(1)).toContainText("DAY");

    await choices.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", "clearline-day");
    await expect(choices.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(choices.first()).toHaveAttribute("aria-checked", "false");
    const columns = await page.locator("#theme-popover .theme-choice-grid").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", themeIds[(1 + columns) % themeIds.length]);
    await expect(page.locator(":focus")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", "clearline-day");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", "midnight-ledger");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(":focus")).toHaveAttribute("data-theme-choice", "warm-window-snow-city");
    await expect(choices.last()).toHaveAttribute("aria-checked", "true");
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

    await page.locator("#theme-open-btn").click();
    await choices.first().focus();
    await page.evaluate(() => document.querySelector("#view-profile").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await expect(page.locator("#theme-popover")).toHaveClass(/is-hidden/);
    await expect(page.locator("#theme-open-btn")).toBeFocused();
  });

  test("selector remains usable in forced colors", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openThemeChooser(page);
    const choices = page.locator("#theme-popover [data-theme-choice]");
    await expect(choices.first()).toBeFocused();
    await expect(choices.first()).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#theme-popover")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(choices.nth(1)).toHaveAttribute("aria-checked", "true");
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

  test("themes update Poorup UI tokens without moving the shell", async ({ page }) => {
    await openThemeChooser(page);
    const snapshot = () => page.evaluate(() => {
      const styles = getComputedStyle(document.body);
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? [rect.x, rect.y, rect.width, rect.height] : null;
      };
      return {
        theme: document.body.dataset.themeId,
        tokens: {
          canvas: styles.getPropertyValue("--bg-canvas").trim(),
          panel: styles.getPropertyValue("--surface-panel").trim(),
          action: styles.getPropertyValue("--red-action").trim(),
          text: styles.getPropertyValue("--text-primary").trim(),
        },
        surfaces: {
          panel: getComputedStyle(document.querySelector(".panel")).backgroundColor,
          primaryAction: getComputedStyle(document.querySelector("#open-create-btn")).backgroundColor,
          input: getComputedStyle(document.querySelector("#home-alias")).backgroundColor,
        },
        geometry: [box("#view-home"), box("#home-nav"), box("#open-create-btn"), box("#theme-open-btn")],
      };
    });
    const baseline = await snapshot();
    for (const themeId of themeIds.slice(1)) {
      await page.locator(`[data-theme-choice="${themeId}"]`).click();
      const current = await snapshot();
      expect(current.theme).toBe(themeId);
      expect(current.tokens).not.toEqual(baseline.tokens);
      expect(current.surfaces).not.toEqual(baseline.surfaces);
      expect(current.geometry).toEqual(baseline.geometry);
    }
  });

  test("theme text and controls keep measured contrast", async ({ page }) => {
    await openThemeChooser(page);
    const contrastForTheme = async (themeId) => {
      await page.locator(`[data-theme-choice="${themeId}"]`).click();
      return page.evaluate(() => {
        const parse = (value) => {
          const match = value.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/);
          if (match) return match.slice(1, 4).map(Number);
          const hex = value.trim().replace(/^#/, "");
          if (![6, 8].includes(hex.length)) return null;
          return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
        };
        const luminance = (value) => {
          const rgb = parse(value);
          if (!rgb) return 0;
          return rgb.reduce((sum, channel, index) => {
            const linear = channel / 255 <= 0.03928 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4;
            return sum + linear * [0.2126, 0.7152, 0.0722][index];
          }, 0);
        };
        const ratio = (foreground, background) => {
          const light = Math.max(luminance(foreground), luminance(background));
          const dark = Math.min(luminance(foreground), luminance(background));
          return (light + 0.05) / (dark + 0.05);
        };
        const styles = getComputedStyle(document.body);
        const panel = getComputedStyle(document.querySelector(".panel"));
        const button = getComputedStyle(document.querySelector("#open-create-btn"));
        const input = getComputedStyle(document.querySelector("#home-alias"));
        return {
          panelText: ratio(styles.getPropertyValue("--text-primary"), panel.backgroundColor),
          buttonText: ratio(button.color, button.backgroundColor),
          inputText: ratio(input.color, input.backgroundColor),
        };
      });
    };
    for (const themeId of themeIds) {
      const contrast = await contrastForTheme(themeId);
      expect(contrast.panelText, `${themeId} panel text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast.buttonText, `${themeId} primary action`).toBeGreaterThanOrEqual(3);
      expect(contrast.inputText, `${themeId} input text`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("seasonal signatures mount the intended light and weather props", async ({ page }) => {
    await openThemeChooser(page);
    const prop = async (themeId, slot) => {
      await page.locator(`[data-theme-choice="${themeId}"]`).click();
      return page.locator(`#theme-home-world .theme-prop-${slot}`).getAttribute("src");
    };
    expect(await prop("clearline-day", "light")).toContain("clearline-day/sun.svg");
    expect(await prop("warm-window-snow-city", "light")).toContain("warm-window-snow-city/moon.svg");
    expect(await prop("rainy-copper-town", "incident")).toContain("rainy-copper-town/leaf.svg");
    expect(await prop("bloom-district", "incident")).toContain("bloom-district/blossom.svg");
    expect(await prop("golden-hour-exchange", "signature")).toContain("golden-hour-exchange/crane.svg");
    expect(await prop("midnight-ledger", "detail")).toContain("midnight-ledger/beacon.svg");
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

  test("theme layers preserve visible Standard-40 and Metro-52 board geometry", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1920", "Board geometry contract runs on desktop-1920.");
    const variants = [
      { variant: "standard-40", code: "THM40A", tileCount: 40, gridSize: 11 },
      { variant: "metro-52", code: "THM52A", tileCount: 52, gridSize: 14 },
    ];
    for (const { variant, code, tileCount, gridSize } of variants) {
      const host = await context.newPage();
      const guest = await context.newPage();
      await host.goto("/");
      await host.locator("#home-alias").fill("ALPHA");
      await host.locator("#open-create-btn").click();
      await host.locator("#rc-vis-selector [data-vis=\"private\"]").click();
      await host.locator("#rc-room-code").fill(code);
      await host.locator("#rc-board-variant").selectOption(variant);
      await host.locator("#rc-create-btn").click();
      await host.locator("#su-start").click();

      await guest.goto("/");
      await guest.locator("#home-alias").fill("BETA");
      await guest.locator("#open-join-btn").click();
      await guest.locator("#room-join").fill(code);
      await guest.locator("#join-nickname").fill("BETA");
      await guest.locator("#join-room-submit").click();
      await guest.locator("#su-start").click();
      await host.locator("#lobby-start-btn").click();
      await expect(host.locator("#view-game")).toBeVisible();

      const measure = () => host.evaluate(() => {
        const frame = document.querySelector("#board-frame");
        const grid = document.querySelector("#board-grid");
        const rect = frame?.getBoundingClientRect();
        const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
        return {
          frame: rect ? [rect.x, rect.y, rect.width, rect.height] : null,
          tileCount: grid?.querySelectorAll(":scope > .tile").length || 0,
          gridSize: columns,
          variant: grid?.dataset.boardVariant || null,
        };
      });
      const before = await measure();
      expect(before.frame).not.toBeNull();
      expect(before.frame[2]).toBeGreaterThan(0);
      expect(before.frame[2]).toBe(before.frame[3]);
      expect(before.tileCount).toBe(tileCount);
      expect(before.gridSize).toBe(gridSize);
      expect(before.variant).toBe(variant);

      await host.evaluate(async () => {
        const { renderTheme } = await import("/clientThemeRender.js");
        renderTheme("warm-window-snow-city", { animate: false });
      });
      const after = await measure();
      expect(after).toEqual(before);
      await guest.close();
      await host.close();
    }
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
