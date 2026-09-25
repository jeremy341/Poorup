import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const tracks = [
  ["pondering-the-cosmos.mp3", "Ruskerdax", "CC0"],
  ["themes/spring/hot-springs-town.mp3", "Kistol", "CC0"],
  ["themes/spring/apple-cider.ogg", "Zane Little Music", "CC0"],
  ["themes/summer/summers.mp3", "symphony", "CC0"],
  ["themes/summer/funked-up.mp3", "Joth", "CC0"],
  ["themes/autumn/autumn.mp3", "Duasun", "CC0"],
  ["themes/autumn/autumn-colors.mp3", "shiru8bit", "CC-BY 3.0"],
  ["themes/winter/snowy-village.ogg", "Louswan", "CC-BY 3.0"],
  ["themes/winter/through-the-snow.ogg", "Cleyton Kauffman", "CC0"],
  ["themes/light/town.mp3", "Pro Sensory", "Public domain"],
  ["themes/light/frogtown.mp3", "LushoGames", "CC0"],
  ["themes/light/urban-theme.ogg", "MintoDog", "CC0"],
];

test("music runtime stays hidden and contains only its two playback channels", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-music-box]")).toHaveCount(0);
  const runtime = page.locator("[data-music-runtime]");
  await expect(runtime).toHaveCount(1);
  await expect(runtime).toBeHidden();
  await expect(runtime.locator("audio[data-music-audio]")).toHaveCount(2);
});

test("music runtime loads the selected theme track and honors the off toggle", async ({ page }) => {
  await page.goto("/");
  await page.locator("#music-toggle-btn").click();
  await expect(page.locator("#music-toggle-btn")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("[data-music-audio]").evaluateAll(nodes => nodes.some(node => node.src.endsWith("pondering-the-cosmos.mp3")))).toBe(true);

  await page.locator("#music-toggle-btn").click();
  await expect(page.locator("#music-toggle-btn")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.locator("[data-music-audio]").evaluateAll(nodes => nodes.every(node => node.paused))).toBe(true);
});

test("Account and Preferences shows inline theme and soundtrack controls without page scrolling", async ({ page }) => {
  await page.goto("/");
  await page.locator("#home-profile-tab").click();
  await page.locator("#profile-tab-account").click();
  const choices = page.locator("#theme-choice-grid [data-theme-choice]");
  await expect(choices).toHaveCount(6);
  await expect(page.locator("#theme-music-panel [data-theme-track-choice]").first()).toBeVisible();
  const overflow = await page.evaluate(() => ({
    documentX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
    documentY: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - document.documentElement.clientHeight,
    profileInternal: document.querySelector("#view-profile .profile-main")?.scrollHeight > document.querySelector("#view-profile .profile-main")?.clientHeight,
  }));
  expect(overflow.documentX).toBeLessThanOrEqual(1);
  expect(overflow.documentY).toBeLessThanOrEqual(1);
  expect(overflow.profileInternal).toBeTruthy();
});

test("track choices persist per theme while music stays disabled", async ({ page }) => {
  await page.goto("/");
  await page.locator("#home-profile-tab").click();
  await page.locator("#profile-tab-account").click();
  const musicToggle = page.locator("#profile-music-toggle-btn");
  await expect(musicToggle).toHaveAttribute("aria-pressed", "false");

  await page.locator('[data-theme-choice="light"]').click();
  await page.locator('[data-theme-track-id="frogtown"]').click();
  await expect(page.locator('[data-theme-track-id="frogtown"] input')).toBeChecked();
  await page.locator('[data-theme-choice="spring"]').click();
  await page.locator('[data-theme-track-id="apple-cider"]').click();
  await page.locator('[data-theme-choice="light"]').click();
  await expect(page.locator('[data-theme-track-id="frogtown"] input')).toBeChecked();
  await expect(musicToggle).toHaveAttribute("aria-pressed", "false");

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("poorup.music.preferences")));
  expect(persisted.selections).toMatchObject({ light: "frogtown", spring: "apple-cider" });
  expect(await page.locator("[data-music-audio]").evaluateAll(audios => audios.every(audio => audio.paused))).toBe(true);

  await page.reload();
  await page.locator("#home-profile-tab").click();
  await page.locator("#profile-tab-account").click();
  await expect(page.locator('[data-theme-track-id="frogtown"] input')).toBeChecked();
  await page.locator('[data-theme-choice="spring"]').click();
  await expect(page.locator('[data-theme-track-id="apple-cider"] input')).toBeChecked();
});

test("theme radios retain keyboard focus and announce the selected world", async ({ page }) => {
  await page.goto("/");
  await page.locator("#home-profile-tab").click();
  await page.locator("#profile-tab-account").click();
  const current = page.locator('#theme-choice-grid input[name="poorup-theme"]:checked');
  await current.focus();
  await page.keyboard.press("ArrowRight");
  const selected = page.locator('#theme-choice-grid input[name="poorup-theme"]:checked');
  await expect(selected).toHaveAttribute("value", "spring");
  await expect(selected).toHaveAttribute("aria-checked", "true");
  await expect(selected).toBeFocused();
  await expect(page.locator("#theme-music-title")).toContainText("SPRING soundtrack");
});

test("audio inventory has a credit and license for every shipped theme track", async () => {
  const audioReadme = read("public/assets/audio/README.md");
  for (const [file, creator, license] of tracks) {
    expect(fs.existsSync(path.join(root, "public/assets/audio", file)), file).toBeTruthy();
    expect(audioReadme).toContain(creator);
    expect(audioReadme).toContain(license);
    expect(audioReadme).toContain(file.split("/").pop());
  }
});
