/* global process */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MUSIC_MANIFEST } from "./clientMusicData.js";

const root = dirname(fileURLToPath(import.meta.url));
const index = readFileSync(join(root, "index.html"), "utf8");
const styles = readFileSync(join(root, "styles.css"), "utf8");
const main = readFileSync(join(root, "main.js"), "utf8");
const player = readFileSync(join(root, "clientMusicPlayer.js"), "utf8");

assert.equal((index.match(/data-music-runtime\b/g) || []).length, 1);
assert.equal((index.match(/data-music-audio=["'](?:a|b)["']/g) || []).length, 2);
assert.doesNotMatch(index, /data-music-box|music-box-panel|clientMusicBoxUi\.js/);
assert.doesNotMatch(styles, /\.music-box\b|music-position-menu|music-volume-popover/);
assert.match(styles, /\.music-runtime[\s\S]*?clip-path:\s*inset\(50%\)/);
assert.match(main, /querySelector\("\[data-music-runtime\]"\)/);
assert.match(main, /__poorupThemeMusicController/);
assert.doesNotMatch(main, /bindMusicBoxIntent|music-box-play|data-music-box/);
assert.match(player, /loop\s*=\s*true/);
assert.match(player, /resolveThemeTrack\(theme, manifest\)/);

const expected = {
  original: "pondering-the-cosmos",
  spring: "hot-springs-town",
  summer: "summers",
  autumn: "autumn",
  winter: "snowy-village",
  light: "town",
};
assert.deepEqual(MUSIC_MANIFEST.defaults, expected);
for (const [theme, track] of Object.entries(expected)) {
  assert.deepEqual(MUSIC_MANIFEST.themes[theme], [track]);
  assert.equal(MUSIC_MANIFEST.tracks[track].status, "approved");
}

process.stdout.write("theme music runtime contract: passed\n");
