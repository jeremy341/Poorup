import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "public/index.html"), "utf8");

// The supplied reference is 1672×941; acceptance is performed at native 1920×1080.
export const MUSIC_BOX_REFERENCE = Object.freeze({
  referenceWidth: 1672,
  referenceHeight: 941,
  acceptanceWidth: 1920,
  acceptanceHeight: 1080,
  collapsedWidth: [304, 324],
  collapsedHeight: [92, 104],
  leftInset: [14, 18],
  bottomInset: [18, 22],
  volumeWidth: [34, 40],
  volumeHeight: [104, 116],
});

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

test("reference dimensions and acceptance viewport are locked", () => {
  assert.equal(MUSIC_BOX_REFERENCE.referenceWidth, 1672);
  assert.equal(MUSIC_BOX_REFERENCE.referenceHeight, 941);
  assert.deepEqual(
    [MUSIC_BOX_REFERENCE.acceptanceWidth, MUSIC_BOX_REFERENCE.acceptanceHeight],
    [1920, 1080],
  );
});

test("compact music box exposes one stable root contract", () => {
  assert.match(index, /data-music-box[ =]/, "the global dock root is not mounted yet");
  assert.equal((index.match(/data-music-box[ =]/g) || []).length, 1);
  assert.match(index, /data-music-box-panel[ =]/, "the controlled panel is not mounted yet");
  assert.match(index, /aria-controls=["'](?:music-box-panel|music-box)["']/);
});

test("reference dock is outside per-view containers and keeps a single audio pair", () => {
  const rootStart = index.indexOf("data-music-box");
  assert.notEqual(rootStart, -1, "the global dock root is not mounted yet");
  const tagStack = [];
  const prefix = index.slice(0, rootStart);
  const tokenPattern = /<!--[\s\S]*?-->|<\/?([a-z][\w-]*)(?:\s[^>]*)?>/gi;
  for (const token of prefix.matchAll(tokenPattern)) {
    if (!token[1]) continue;
    const tag = token[1].toLowerCase();
    if (token[0].startsWith("</")) {
      const indexToClose = tagStack.map((entry) => entry.tag).lastIndexOf(tag);
      if (indexToClose >= 0) tagStack.splice(indexToClose, 1);
      continue;
    }
    if (/\/\s*>$/.test(token[0]) || ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(tag)) continue;
    tagStack.push({ tag, isView: /\bclass\s*=\s*["'][^"']*\bview\b[^"']*["']/i.test(token[0]) });
  }
  assert.equal(tagStack.some((entry) => entry.isView), false, "dock must be mounted outside SPA views");
  assert.equal((index.match(/data-music-audio=["'](?:a|b)["']/g) || []).length, 2);
});
