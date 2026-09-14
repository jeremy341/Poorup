import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

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
    expect(bounds.x).toBeGreaterThanOrEqual(14);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1062);

    const viewport = page.viewportSize();
    expect(viewport).toEqual({ width: 1920, height: 1080 });
    await expect(page.locator("[data-music-audio]")).toHaveCount(2);
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
});
