import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { themeOptions } from "./clientThemeData.js";

const root = dirname(fileURLToPath(import.meta.url));
let passed = 0;
for (const definition of themeOptions()) {
  const theme = definition.id;
  const scenePaths = [definition.scene, definition.homeScene].filter(Boolean);
  const propValues = [...Object.values(definition.props || {}), ...Object.values(definition.homeProps || {})];
  const assetPaths = propValues.flatMap((value) => typeof value === "string" ? [value] : Object.values(value));
  const assetNames = [...new Set([...scenePaths, ...assetPaths].map((path) => path.split("/").pop().replace(/\.svg$/, "")))];
  const expectedNames = theme === "original"
    ? ["fog", "scene"]
    : theme === "spring"
    ? ["accent", "clouds", "light", "petals", "scene", "signature"]
    : theme === "light"
      ? ["clouds", "light", "pedestrians-pose-a", "pedestrians-pose-b", "scene", "signature", "weather"]
    : theme === "autumn"
      ? ["accent", "clouds", "leaves", "light", "scene", "signature", "weather"]
      : theme === "winter"
        ? ["accent", "clouds", "light", "scene", "signature", "snow"]
        : ["accent", "clouds", "light", "scene", "signature", "weather"];
  assert.deepEqual(assetNames.sort(), expectedNames);
  assert.deepEqual(
    readdirSync(join(root, "assets", "themes", theme)).sort(),
    assetNames.map((name) => `${name}.svg`).sort(),
    `${theme} should not retain prototype or backup assets`,
  );
  for (const name of assetNames) {
    const source = readFileSync(join(root, "assets", "themes", theme, `${name}.svg`), "utf8");
    assert.match(source, /^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    if (theme === "original" || name === "scene" || name === "clouds" || name === "petals" || name === "snow" || name === "leaves") {
      assert.match(source, /viewBox="0 0 640 360"/);
      if (name === "scene") assert.ok(source.length > 3_000, `${theme} scene should preserve the detailed 1920px art pass`);
    } else if (theme === "light" && name.startsWith("pedestrians")) {
      assert.match(source, /viewBox="0 0 640 360"/);
    } else {
      assert.match(source, /viewBox="0 0 320 180"/);
    }
    assert.match(source, /shape-rendering="crispEdges"/);
    const withoutNamespace = source.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "");
    assert.doesNotMatch(withoutNamespace, /<text\b|<filter\b|<linearGradient\b|<radialGradient\b|https?:\/\/|transform="scale\((?:3|4|5|6)/);
    passed += 1;
  }
}
console.log(`theme asset audit: ${passed} passed, 0 failed`);
