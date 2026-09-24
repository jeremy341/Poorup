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

test("audio inventory has a credit and license for every shipped theme track", async () => {
  const audioReadme = read("public/assets/audio/README.md");
  for (const [file, creator, license] of tracks) {
    expect(fs.existsSync(path.join(root, "public/assets/audio", file)), file).toBeTruthy();
    expect(audioReadme).toContain(creator);
    expect(audioReadme).toContain(license);
    expect(audioReadme).toContain(file.split("/").pop());
  }
});
