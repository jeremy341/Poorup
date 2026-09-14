import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const musicRoot = join(root, "assets", "music");
const names = [
  "music-note",
  "music-prev",
  "music-play",
  "music-pause",
  "music-next",
  "music-shuffle",
  "music-repeat",
  "music-speaker",
  "music-grip",
];

const sources = names.map((name) => {
  const path = join(musicRoot, `${name}.svg`);
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
}

const pathSignature = (name) => {
  const source = sources.find(([candidate]) => candidate === name)[1];
  return [...source.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]).join("|");
};
assert.notEqual(pathSignature("music-shuffle"), pathSignature("music-repeat"),
  "shuffle and repeat need distinct path signatures");

console.log(`music icon audit: ${sources.length} passed, 0 failed`);
