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
  assert.match(styles, /\.music-box\s*\{[\s\S]*?bottom:\s*20px/);
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
