/* global process */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

function test(name, fn) {
  try { fn(); process.stdout.write(`ok - ${name}\n`); }
  catch (error) { process.stderr.write(`not ok - ${name}\n${error.stack}\n`); process.exitCode = 1; }
}

test("mounts exactly one compact dock outside every SPA view", () => {
  assert.equal((index.match(/data-music-box(?:[ =])/g) || []).length, 1);
  const dockAt = index.indexOf("data-music-box");
  assert.ok(dockAt >= 0);
  const before = index.slice(0, dockAt);
  assert.equal((before.match(/<div[^>]+class=["'][^"']*\bview\b/g) || []).length,
    (before.match(/<\/div>/g) || []).length === 0 ? 0 : 0,
    "dock must be mounted at the document root, outside .view containers");
});

test("uses the compact reference dimensions and balanced edge padding", () => {
  assert.match(styles, /\.music-box\s*\{[\s\S]*?width:\s*min\(324px/);
  assert.match(styles, /\.music-box\s*\{[\s\S]*?padding:\s*8px/);
  assert.match(styles, /\.music-box-controls[^}]*gap:\s*8px/);
  assert.match(styles, /\.music-box\s*\{[\s\S]*?bottom:\s*max\(56px/);
});

test("exposes one semantic control for each music action", () => {
  for (const action of ["previous", "play", "next", "shuffle", "repeat", "volume"]) {
    assert.match(index, new RegExp(`data-music-action=["']${action}["']`));
  }
  assert.match(index, /aria-controls=["']music-box-panel["']/);
  assert.match(index, /aria-expanded=["']false["']/);
  assert.match(index, /role=["']status["'][^>]*aria-live=["']polite["']/);
  assert.match(index, /type=["']range["'][^>]*aria-label=["'][^"']*volume/i);
});

test("keeps controls icon-only while providing accessible names and no topbar duplicate", () => {
  const dock = index.slice(index.indexOf("data-music-box"), index.indexOf("data-music-box") + 12000);
  assert.doesNotMatch(dock, /data-music-action=["'](?:previous|play|next|shuffle|repeat|volume)["'][^>]*>[A-Z ]+</);
  for (const label of ["Previous track", "Play music", "Next track", "Toggle shuffle", "Toggle repeat", "Volume"]) {
    assert.match(dock, new RegExp(`aria-label=["']${label}`));
  }
  assert.equal((index.match(/id=["'][^"']*music-player[^"']*["']/g) || []).length, 0);
});

test("declares the vertical volume popover and hidden move menu relationship", () => {
  assert.match(index, /id=["']music-volume-popover["'][^>]*hidden/);
  assert.match(index, /id=["']music-position-menu["'][^>]*hidden/);
  assert.match(styles, /\.music-volume-popover[^}]*bottom:\s*calc\(100%\s*\+\s*8px\)/);
});

test("keeps the fixed dock clear of the home footer ticker", () => {
  assert.match(styles, /\.music-box\s*\{[^}]*bottom:\s*(?:max\([^)]*\)|(?:5[2-9]|[6-9]\d)px)/);
  assert.match(styles, /\.music-box\s*\{[^}]*z-index:\s*55/);
});

test("renders controller play state and a proportional progress meter", () => {
  assert.match(fs.readFileSync(path.join(root, "public/clientMusicBoxUi.js"), "utf8"), /state\.playing/);
  assert.match(fs.readFileSync(path.join(root, "public/clientMusicBoxUi.js"), "utf8"), /data-music-meter/);
  assert.match(fs.readFileSync(path.join(root, "public/clientMusicBoxUi.js"), "utf8"), /Pause music/);
  assert.match(styles, /music-progress/);
});

test("uses the controller's active snapshot time and audio duration", () => {
  const source = fs.readFileSync(path.join(root, "public/clientMusicBoxUi.js"), "utf8");
  assert.doesNotMatch(source, /Math\.max\(\.\.\.\[\.\.\.root\.querySelectorAll\("audio\[data-music-audio\]"\)/);
  assert.match(source, /state\.currentTime/);
  assert.match(source, /activeAudio/);
});

test("keeps volume popover safe for top-corner placements and touch tablets", () => {
  assert.match(styles, /music-box\[data-position="top-left"\][\s\S]*?music-volume-popover[^}]*top:/);
  assert.match(styles, /music-box\[data-position="top-right"\][\s\S]*?music-volume-popover[^}]*top:/);
  assert.match(styles, /orientation:\s*landscape[\s\S]*?music-box-controls[\s\S]*?44px/);
});

test("releases move gesture at document level", () => {
  const source = fs.readFileSync(path.join(root, "public/clientMusicBoxUi.js"), "utf8");
  assert.match(source, /setPointerCapture/);
  assert.match(source, /document\.addEventListener\("pointerup"/);
});

test("keeps touch hit areas large without making the visual dock tall", () => {
  assert.match(styles, /\.music-box\s*\{[^}]*min-height:\s*96px/);
  assert.match(styles, /@media[^}]*\(hover:\s*none\)[\s\S]*?\.music-box\s*\{[^}]*max-height:\s*116px/);
  assert.match(styles, /@media[^}]*\(hover:\s*none\)[\s\S]*?\.music-box-panel\s*\{[^}]*gap:\s*2px/);
  assert.match(styles, /@media[^}]*\(hover:\s*none\)[\s\S]*?width:\s*44px/);
});

test("declares safe corner snapping and keyboard-native move controls", () => {
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /z-index:\s*5[0-9]/);
  assert.match(index, /data-music-position=["']top-left["']/);
  assert.match(index, /data-music-position=["']top-right["']/);
  assert.match(index, /data-music-position=["']bottom-left["']/);
  assert.match(index, /data-music-position=["']bottom-right["']/);
  assert.match(index, /role=["']menu["']/);
});

test("defines volume keyboard, outside dismissal, and enum-only placement behavior", () => {
  const source = fs.readFileSync(path.join(root, "public/clientMusicBoxUi.js"), "utf8");
  assert.match(source, /ArrowUp|ArrowDown/);
  assert.match(source, /pointerdown|mousedown/);
  assert.match(source, /localStorage|music\.position/);
  assert.match(source, /contains\(/);
  assert.match(source, /top-left.*top-right.*bottom-left.*bottom-right/s);
});
