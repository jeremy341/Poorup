import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const themeIds = ["original", "spring", "summer", "autumn", "winter", "light"];

async function openThemeChooser(page) {
  await page.goto("/");
  await page.locator("#home-profile-tab").click();
  await page.locator("#profile-tab-account").click();
  await expect(page.locator("#theme-choice-grid")).toBeVisible();
}

test.describe("Poorup seasonal worlds", () => {
  test("offers six native radio choices and keeps keyboard focus on the selected world", async ({ page }) => {
    await openThemeChooser(page);
    const choices = page.locator("#theme-choice-grid [data-theme-choice]");
    await expect(choices).toHaveCount(6);
    expect(await page.locator(".theme-choice-art img").evaluateAll((images) => images.map((image) => new URL(image.src).pathname))).toEqual([
      "/assets/themes/original/scene.svg",
      "/assets/themes/spring/scene.svg",
      "/assets/themes/summer/scene.svg",
      "/assets/themes/autumn/scene.svg",
      "/assets/themes/winter/scene.svg",
      "/assets/themes/light/scene.svg",
    ]);
    await expect(choices.first()).toHaveAttribute("type", "radio");
    await expect(choices.first()).toBeChecked();
    await expect(choices.first()).toHaveAttribute("tabindex", "0");
    await expect(choices.nth(1)).toHaveAttribute("tabindex", "-1");
    await choices.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(choices.nth(1)).toBeChecked();
    await expect(choices.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(choices.nth(1)).toBeFocused();
    await expect(page.locator("body")).toHaveAttribute("data-theme-id", "spring");
    await expect(page.locator("#theme-music-title")).toContainText("SPRING soundtrack");
  });

  test("applies a themed scene without changing the shell geometry", async ({ page }) => {
    await page.goto("/");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator("#home-profile-tab").click();
    await page.locator("#profile-tab-account").click();
    const shellGeometry = () => page.evaluate(() => {
      const bounds = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return { header: bounds("#view-profile .hdr"), main: bounds("#view-profile .profile-main") };
    });
    const baseline = await shellGeometry();
    for (const id of themeIds.slice(1)) {
      await page.locator(`[data-theme-choice-label="${id}"]`).click();
      await expect(page.locator("body")).toHaveAttribute("data-theme-id", id);
      await expect(page.locator("#theme-home-world")).toHaveAttribute("data-theme-id", id);
      await expect(page.locator("#theme-home-world .theme-scene")).toHaveCount(1);
      await expect(page.locator("#theme-home-world .theme-prop-clouds")).toHaveCount(2);
      const cloudMotion = await page.locator("#theme-home-world .theme-cloud-a").evaluate((element) => getComputedStyle(element).animationName);
      const cloudReturn = await page.locator("#theme-home-world .theme-cloud-b").evaluate((element) => getComputedStyle(element).animationName);
      expect(cloudMotion).toBe("theme-cloud-a-drift");
      expect(cloudReturn).toBe("theme-cloud-b-drift");
      if (id === "spring") {
        await expect(page.locator("#theme-home-world .theme-petal-a")).toHaveCount(1);
        await expect(page.locator("#theme-home-world .theme-petal-b")).toHaveCount(1);
      }
      if (id === "autumn") {
        await expect(page.locator("#theme-home-world .theme-leaves-a")).toHaveCount(1);
        await expect(page.locator("#theme-home-world .theme-leaves-b")).toHaveCount(1);
      }
      if (id === "winter") {
        await expect(page.locator("#theme-home-world .theme-snow-a")).toHaveCount(1);
        await expect(page.locator("#theme-home-world .theme-snow-b")).toHaveCount(1);
      }
      if (id === "light") {
        await expect(page.locator("#theme-home-world .theme-pedestrian-band")).toHaveCount(2);
      }
      expect(await shellGeometry()).toEqual(baseline);
    }
    await page.locator('[data-theme-choice="original"]').click();
    await expect(page.locator("#theme-home-world .theme-scene")).toHaveCount(1);
    await expect(page.locator("#theme-home-world .theme-prop-fog")).toHaveCount(2);
    await expect(page.locator("#theme-page-world")).toBeEmpty();
    await expect(page.locator("#theme-board-world")).toBeEmpty();
    await expect(page.locator("#view-home .home-house-drift")).toHaveCSS("opacity", "0.5");
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

  test("freezes petals and pedestrians when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openThemeChooser(page);
    const originalFogMotion = await page.locator("#theme-home-world .theme-fog-a").evaluate((element) => getComputedStyle(element).animationName);
    expect(originalFogMotion).toBe("none");
    await page.locator('[data-theme-choice-label="spring"]').click();
    const petalMotion = await page.locator("#theme-home-world .theme-petal-a").evaluate((element) => getComputedStyle(element).animationName);
    expect(petalMotion).toBe("none");
    await page.locator('[data-theme-choice-label="autumn"]').click();
    const leavesMotion = await page.locator("#theme-home-world .theme-leaves-a").evaluate((element) => getComputedStyle(element).animationName);
    expect(leavesMotion).toBe("none");
    await page.locator('[data-theme-choice-label="winter"]').click();
    const snowMotion = await page.locator("#theme-home-world .theme-snow-a").evaluate((element) => getComputedStyle(element).animationName);
    expect(snowMotion).toBe("none");
    await page.locator("#profile-back-btn").click();
    await page.locator("#home-profile-tab").click();
    await page.locator("#profile-tab-account").click();
    await page.locator('[data-theme-choice-label="light"]').click();
    const pedestrianMotion = await page.locator("#theme-home-world .theme-pedestrian-a").evaluate((element) => getComputedStyle(element).animationName);
    expect(pedestrianMotion).toBe("none");
  });

  test("isolates ambient theme layers below semantic home content and releases paused compositor hints", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");

    const layers = await page.evaluate(() => {
      const style = (selector) => getComputedStyle(document.querySelector(selector));
      const world = document.querySelector("#theme-home-world");
      return {
        bodyIsolation: getComputedStyle(document.body).isolation,
        titleIsolation: style(".title-screen").isolation,
        boardIsolation: style("#center-field").isolation,
        pageWorldZ: Number(style("#theme-page-world").zIndex),
        viewZ: Number(style("#view-home").zIndex),
        homeWorldZ: Number(style("#theme-home-world").zIndex),
        titleZ: Number(style(".title-grid").zIndex),
        atmosphereZ: Number(style(".home-sky-atmosphere").zIndex),
        boardWorldZ: Number(style("#theme-board-world").zIndex),
        boardCopyZ: Number(style("#center-field .cf-inner").zIndex),
        decorativeChildrenContained: [...document.querySelectorAll(".theme-scene, .theme-prop")]
          .every((element) => element.closest("[data-theme-layer]")),
        ambientAnimation: style("#theme-home-world .theme-fog-a").animationName,
        ambientWillChange: style("#theme-home-world .theme-fog-a").willChange,
      };
    });

    expect(layers).toEqual({
      bodyIsolation: "isolate",
      titleIsolation: "isolate",
      boardIsolation: "isolate",
      pageWorldZ: 0,
      viewZ: 1,
      homeWorldZ: 0,
      titleZ: 2,
      atmosphereZ: 4,
      boardWorldZ: 0,
      boardCopyZ: 2,
      decorativeChildrenContained: true,
      ambientAnimation: "theme-fog-a-drift",
      ambientWillChange: "transform",
    });

    await page.locator("body").evaluate((body) => body.classList.add("theme-motion-paused"));
    await expect(page.locator("#theme-home-world .theme-fog-a")).toHaveCSS("animation-play-state", "paused");
    await expect(page.locator("#theme-home-world .theme-fog-a")).toHaveCSS("will-change", "auto");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("#theme-home-world .theme-fog-a")).toHaveCSS("animation-name", "none");
    await expect(page.locator("#theme-home-world .theme-fog-a")).toHaveCSS("will-change", "auto");
  });

  test("keeps inline preferences in internal Profile scrolling without document overflow", async ({ page }) => {
    await openThemeChooser(page);
    await page.locator('[data-theme-choice="light"]').click();
    await page.locator("#theme-music-panel").scrollIntoViewIfNeeded();
    const metrics = await page.evaluate(() => ({
      documentX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
      documentY: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - document.documentElement.clientHeight,
      pageScrollY: window.scrollY,
      profileScrollTop: document.querySelector("#view-profile .profile-main")?.scrollTop,
      profileScrollHeight: document.querySelector("#view-profile .profile-main")?.scrollHeight,
      profileClientHeight: document.querySelector("#view-profile .profile-main")?.clientHeight,
      panel: document.querySelector("#theme-music-panel")?.getBoundingClientRect().toJSON(),
    }));
    expect(metrics.documentX).toBeLessThanOrEqual(1);
    expect(metrics.documentY).toBeLessThanOrEqual(1);
    expect(metrics.pageScrollY).toBe(0);
    expect(metrics.profileScrollTop).toBeGreaterThan(0);
    expect(metrics.profileScrollHeight).toBeGreaterThan(metrics.profileClientHeight);
    expect(metrics.panel.left).toBeGreaterThanOrEqual(0);
    expect(metrics.panel.right).toBeLessThanOrEqual(page.viewportSize().width + 1);
    expect(metrics.panel.top).toBeGreaterThanOrEqual(0);
    expect(metrics.panel.bottom).toBeLessThanOrEqual(page.viewportSize().height + 1);
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
