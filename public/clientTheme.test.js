import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_THEME_ID,
  THEME_IDS,
  getTheme,
  sanitizeThemeId,
  themeOptions,
} from "./clientThemeData.js";
import { themeSceneMarkup } from "./clientThemeRender.js";

const expectedIds = ["original", "spring", "summer", "autumn", "winter", "light"];
const root = dirname(fileURLToPath(import.meta.url));
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error }); }
}

check("original is the stable default and invalid ids fall back", () => {
  assert.equal(DEFAULT_THEME_ID, "original");
  assert.deepEqual(THEME_IDS, expectedIds);
  assert.equal(sanitizeThemeId("SPRING"), "spring");
  assert.equal(sanitizeThemeId("missing"), DEFAULT_THEME_ID);
  assert.equal(sanitizeThemeId(null), DEFAULT_THEME_ID);
});

check("registry is immutable and exposes six choices", () => {
  assert.equal(Object.isFrozen(THEME_IDS), true);
  assert.equal(Object.isFrozen(themeOptions()), true);
  assert.equal(themeOptions().length, 6);
  assert.equal(getTheme("original").id, "original");
  assert.equal(getTheme("winter").name, "Winter / Frostline Ledger");
});

check("original has no visual override while new worlds have complete tokens", () => {
  assert.deepEqual(getTheme("original").tokens, {});
  for (const id of expectedIds.slice(1)) {
    const theme = getTheme(id);
    assert.ok(Object.keys(theme.tokens).length >= 16, `${id} needs UI tokens`);
    assert.ok(theme.scene, `${id} needs scene`);
    assert.deepEqual(Object.keys(theme.props), ["light", "signature", "weather", "accent"]);
    assert.match(theme.scene, /^\/assets\/themes\/[a-z-]+\/scene\.svg$/);
  }
});

check("theme tokens keep readable panel and primary-action contrast", () => {
  const rgb = (value) => {
    const hex = value.replace("#", "").slice(0, 6);
    return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  };
  const luminance = (value) => rgb(value).reduce((sum, channel, index) => {
    const linear = channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  const contrast = (foreground, background) => {
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return (light + 0.05) / (dark + 0.05);
  };
  for (const theme of themeOptions().slice(1)) {
    assert.ok(contrast(theme.tokens["--text-primary"], theme.tokens["--surface-panel"]) >= 4.5, `${theme.id} panel text`);
    assert.ok(contrast(theme.tokens["--gold-050"], theme.tokens["--red-action"]) >= 3, `${theme.id} action text`);
  }
});

check("scene markup is decorative and noninteractive", () => {
  const html = themeSceneMarkup(getTheme("autumn"), "home");
  assert.match(html, /themes\/autumn\/scene\.svg/);
  assert.match(html, /class="theme-scene"[^>]+width="640" height="360"/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /<button|<input|onclick|data-action/);
});

check("all new SVGs are local crisp pixel assets", () => {
  for (const id of expectedIds.slice(1)) {
    const theme = getTheme(id);
    const assetNames = ["scene", ...Object.values(theme.props).map((path) => path.split("/").pop().replace(/\.svg$/, ""))];
    for (const name of assetNames) {
      const file = join(root, "assets", "themes", id, `${name}.svg`);
      const source = readFileSync(file, "utf8");
      assert.match(source, /<svg\b/);
      assert.match(source, /shape-rendering="crispEdges"/);
      const withoutNamespace = source.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "");
      assert.doesNotMatch(withoutNamespace, /<text\b|<filter\b|linearGradient|radialGradient|https?:\/\//);
    }
  }
});

const failures = checks.filter((result) => !result.ok);
checks.forEach((result) => {
  if (result.ok) console.log(`PASS - ${result.name}`);
  else console.error(`FAIL - ${result.name}: ${result.error.message}`);
});
console.log(`client theme tests: ${checks.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw failures[0].error;
