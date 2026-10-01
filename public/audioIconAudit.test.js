// The audio control surfaces (clientAudioControls.js and the header toggle
// buttons in index.html) load exactly four state icons from /assets. This
// audit keeps them present, hygiene-clean, and visually consistent: the
// active state uses the warm parlor palette, the muted state the
// desaturated one with the red slash.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const ICONS = Object.freeze({
  "music-on": { warm: true },
  "music-off": { warm: false },
  "sound-on": { warm: true },
  "sound-off": { warm: false },
});
const WARM_PALETTE = Object.freeze(["#f0d9ac", "#cfa75f"]);
const MUTED_PALETTE = Object.freeze(["#a79d7d", "#d74438"]);

const sources = Object.keys(ICONS).map((name) => {
  const path = join(root, "assets", `${name}.svg`);
  assert.ok(existsSync(path), `${name}.svg should exist`);
  return [name, readFileSync(path, "utf8")];
});

for (const [name, source] of sources) {
  assert.match(source, /^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(source, /viewBox="0 0 24 24"/);
  assert.match(source, /shape-rendering="crispEdges"/);
  const withoutNamespace = source.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "");
  assert.doesNotMatch(withoutNamespace, /<text\b|<filter\b|<linearGradient\b|<radialGradient\b|https?:\/\//);
  assert.doesNotMatch(source, /(?:[xy]=|[MLHVCSQTA])"?[^\n]*?\d+\.\d/,
    `${name} should use integer-aligned coordinates`);
  const palette = ICONS[name].warm ? WARM_PALETTE : MUTED_PALETTE;
  const tone = ICONS[name].warm ? "warm" : "muted";
  for (const color of palette) {
    assert.ok(source.includes(color), `${name} should carry the ${tone} tone ${color}`);
  }
}

function onAndOffDiffer(base) {
  const on = sources.find(([name]) => name === `${base}-on`)[1];
  const off = sources.find(([name]) => name === `${base}-off`)[1];
  assert.notEqual(on, off, `${base} on/off icons must differ`);
}
onAndOffDiffer("music");
onAndOffDiffer("sound");

console.log(`audio icon audit: ${sources.length} passed, 0 failed`);
