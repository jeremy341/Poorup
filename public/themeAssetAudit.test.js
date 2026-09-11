import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const themes = {
  "midnight-ledger": ["scene", "moon", "helicopter", "rooftop", "windows", "beacon"],
  "clearline-day": ["scene", "sun", "cloud-bank", "cloud-small", "civic-tower", "bird"],
  "bloom-district": ["scene", "sun", "house", "blossom", "fence", "bird"],
  "golden-hour-exchange": ["scene", "sun", "crane", "ferry", "palm", "gull"],
  "rainy-copper-town": ["scene", "cloud", "leaf", "rain", "station", "street-lamp"],
  "warm-window-snow-city": ["scene", "moon", "ice-roof", "pine", "snow", "smoke"],
};

const files = Object.entries(themes).flatMap(([theme, names]) => names.map((name) => ({
  theme,
  name,
  path: join(root, "assets", "themes", theme, `${name}.svg`),
})));

function checkFile(entry) {
  const source = readFileSync(entry.path, "utf8");
  assert.match(source, /<svg\b/);
  assert.match(source, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(source, /viewBox="[^"]+"/);
  assert.match(source, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(source, /<text\b|<filter\b|<linearGradient\b|<radialGradient\b/);
  const withoutNamespace = source.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "");
  assert.doesNotMatch(withoutNamespace, /https?:\/\//);
  assert.doesNotMatch(source, /inkscape:|sodipodi:|editorData/i);
  if (entry.name === "scene") {
    assert.match(source, /viewBox="0 0 88 36"/);
    const elementCount = (source.match(/<(?:path|rect|circle|ellipse|polygon|polyline|g)\b/g) || []).length;
    assert.ok(elementCount < 220, `${entry.theme} scene is too dense`);
  }
}

const failures = [];
for (const entry of files) {
  try {
    checkFile(entry);
    console.log(`PASS - ${entry.theme}/${entry.name}.svg`);
  } catch (error) {
    failures.push({ entry, error });
    console.error(`FAIL - ${entry.theme}/${entry.name}.svg: ${error.message}`);
  }
}

console.log(`theme asset audit: ${files.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw failures[0].error;
