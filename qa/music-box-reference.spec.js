import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const evidenceDir = path.join(root, "qa-artifacts", "music-box-reference-qa");

const tracks = [
  ["pondering-the-cosmos.mp3", "Ruskerdax", "CC0"],
  ["themes/spring/hot-springs-town.mp3", "Kistol", "CC0"],
  ["themes/summer/summers.mp3", "symphony", "CC0"],
  ["themes/autumn/autumn.mp3", "Duasun", "CC0"],
  ["themes/winter/snowy-village.ogg", "Louswan", "CC-BY 3.0"],
  ["themes/light/town.mp3", "Pro Sensory", "Public domain"],
];

async function dismissTransientLayers(page) {
  // Surface navigation must not inherit a room/theme/profile dialog from the
  // previous surface. Escape is the public close contract for these layers.
  for (let attempt = 0; attempt < 3; attempt += 1) await page.keyboard.press("Escape");
  // `#log-drawer` is an off-canvas dialog that remains display:flex while
  // aria-hidden=true; only semantically open layers are actionable here.
  await expect(page.locator('[role="dialog"][aria-hidden="false"], .panel-menu:not(.is-hidden):visible, .popup:not(.is-hidden):visible')).toHaveCount(0);
}

async function captureNative(page, name) {
  const file = path.join(evidenceDir, `${name}.png`);
  const image = await page.screenshot({ path: file, animations: "disabled", caret: "hide", scale: "css" });
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(image.readUInt32BE(16)).toBe(1920);
  expect(image.readUInt32BE(20)).toBe(1080);
  expect(fs.statSync(file).size).toBeGreaterThan(1000);
  return file;
}

test.describe("reference-locked music box", () => {
  test("home acceptance viewport records the compact reference geometry", async ({ page }) => {
    await page.goto("/");

    const box = page.locator("[data-music-box]");
    await expect(box).toHaveCount(1);
    const bounds = await box.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.width).toBeGreaterThanOrEqual(304);
    expect(bounds.width).toBeLessThanOrEqual(324);
    const isDesktopReference = page.viewportSize().width >= 1800;
    expect(bounds.height).toBeGreaterThanOrEqual(isDesktopReference ? 92 : 104);
    expect(bounds.height).toBeLessThanOrEqual(isDesktopReference ? 104 : 116);
    expect(bounds.x).toBeGreaterThanOrEqual(14);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1062);

    const viewport = page.viewportSize();
    expect(viewport).toEqual(isDesktopReference ? { width: 1920, height: 1080 } : { width: 1024, height: 768 });
    await expect(page.locator("[data-music-audio]")).toHaveCount(2);
  });

  test("iPad landscape keeps touch targets large while staying footer-safe", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    const box = page.locator("[data-music-box]");
    const bounds = await box.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.height).toBeGreaterThanOrEqual(104);
    expect(bounds.height).toBeLessThanOrEqual(116);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(768 - 52);
    for (const control of await box.locator("button:visible").all()) {
      const controlBounds = await control.boundingBox();
      expect(controlBounds?.width).toBeGreaterThanOrEqual(44);
      expect(controlBounds?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("audio inventory has a credit and license for every shipped theme track", async () => {
    const licenses = read("public/legal/licenses.html");
    const audioReadme = read("public/assets/audio/README.md");
    for (const [file, creator, license] of tracks) {
      expect(fs.existsSync(path.join(root, "public/assets/audio", file)), file).toBeTruthy();
      expect(`${licenses}\n${audioReadme}`).toContain(creator);
      expect(`${licenses}\n${audioReadme}`).toContain(license);
      expect(`${licenses}\n${audioReadme}`).toContain(file.split("/").pop());
    }
  });

  test("storage notice names music keys and theme/custom behavior", async () => {
    const storage = read("public/legal/storage.html");
    const privacy = read("public/legal/privacy.html");
    for (const key of ["poorup.music.enabled.v1", "poorup.music.preferences", "poorup.music.position.v1", "poorup.theme.id.v2"]) {
      expect(storage).toContain(key);
    }
    expect(storage).toMatch(/theme defaults?/i);
    expect(storage).toMatch(/custom choices?/i);
    expect(privacy).toMatch(/autoplay/i);
    expect(privacy).toMatch(/local preference/i);
  });

  test("dock stays global across SPA surfaces and static legal pages are player-free", async ({ page }) => {
    await page.goto("/");
    for (const tab of ["rooms", "profile", "rankings", "social", "rules"]) {
      await dismissTransientLayers(page);
      const button = page.locator(`[data-home-tab="${tab}"]:visible, [data-top-surface="${tab}"]:visible`).first();
      await button.click();
      await expect(page.locator("[data-music-box]")).toHaveCount(1);
    }
    await dismissTransientLayers(page);
    for (const legal of ["licenses", "storage", "privacy"]) {
      await page.goto(`/legal/${legal}`);
      await expect(page.locator("[data-music-box]")).toHaveCount(0);
      await expect(page.locator("audio")).toHaveCount(0);
    }
  });

  test("captures the native 1920 reference state matrix locally", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    await fs.promises.mkdir(evidenceDir, { recursive: true });
    await dismissTransientLayers(page);

    await captureNative(page, "01-collapsed-original");
    await page.locator('[data-music-action="volume"]').click();
    await expect(page.locator("#music-volume-popover")).toBeVisible();
    await captureNative(page, "02-volume-open-bottom-left");
    await page.keyboard.press("Escape");

    for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      await page.locator('[data-music-action="position"]').dispatchEvent("click");
      await expect(page.locator("#music-position-menu")).toBeVisible();
      await page.locator(`#music-position-menu [data-music-position="${position}"]:visible`).click();
      await expect(page.locator(`[data-music-box][data-position="${position}"]`)).toHaveCount(1);
      await captureNative(page, `03-position-${position}`);
    }

    await page.locator('[data-music-action="shuffle"]').click();
    await expect(page.locator('[data-music-action="shuffle"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-music-mode]")).toContainText("CUSTOM");
    await captureNative(page, "04-custom-shuffle");

    await page.locator('[data-home-tab="profile"]:visible').click();
    await expect(page.locator("#view-profile")).toBeVisible();
    await page.locator("#profile-tab-account").click();
    await expect(page.locator("#theme-open-btn")).toBeVisible();
    for (const theme of ["original", "spring", "summer", "autumn", "winter", "light"]) {
      // Theme application can return focus to the home surface; re-enter the
      // visible preferences panel before every deterministic capture.
      await page.locator('[data-home-tab="profile"]:visible').click();
      await expect(page.locator("#view-profile")).toBeVisible();
      await page.locator("#profile-tab-account").click();
      const themeTrigger = page.locator("#theme-open-btn:visible");
      await expect(themeTrigger).toBeVisible();
      await themeTrigger.click();
      const choice = page.locator(`[data-theme-choice="${theme}"]`);
      if (!(await choice.isChecked())) {
        await choice.check();
      }
      const closeTheme = page.locator("#theme-popover-close:visible");
      if (await closeTheme.count()) await closeTheme.click();
      else await page.keyboard.press("Escape");
      await expect(page.locator("#theme-popover")).toBeHidden();
      await captureNative(page, `05-theme-${theme}`);
    }

    await dismissTransientLayers(page);
    await page.locator('[data-home-tab="rooms"]:visible').click();
    await expect(page.locator("#rooms-modal")).toBeVisible();
    await captureNative(page, "06-modal-over-dock");
  });
});
