import assert from "node:assert/strict";
import {
  DEFAULT_THEME_ID,
  THEME_IDS,
  THEMES,
  getTheme,
  sanitizeThemeId,
  themeOptions,
} from "./clientThemeData.js";
import { themeSceneMarkup } from "./clientThemeRender.js";

const expectedIds = [
  "midnight-ledger",
  "clearline-day",
  "bloom-district",
  "golden-hour-exchange",
  "rainy-copper-town",
  "warm-window-snow-city",
];

function check(name, fn) {
  try {
    fn();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error };
  }
}

const checks = [
  check("theme ids use the approved six-world order", () => {
    assert.deepEqual(THEME_IDS, expectedIds);
  }),
  check("unknown theme ids fall back to the original world", () => {
    assert.equal(DEFAULT_THEME_ID, "midnight-ledger");
    assert.equal(sanitizeThemeId("unknown"), DEFAULT_THEME_ID);
    assert.equal(sanitizeThemeId(null), DEFAULT_THEME_ID);
    assert.equal(sanitizeThemeId("CLEARLINE-DAY"), "clearline-day");
  }),
  check("theme lookup returns a safe definition", () => {
    assert.equal(getTheme("clearline-day").name, "Clearline Day");
    assert.equal(getTheme("missing").id, DEFAULT_THEME_ID);
    assert.equal(themeOptions().length, 6);
  }),
  check("registry is immutable", () => {
    assert.equal(Object.isFrozen(THEMES), true);
    assert.equal(Object.isFrozen(THEME_IDS), true);
    assert.equal(Object.isFrozen(themeOptions()), true);
  }),
  check("each theme has local scenes, previews, and bounded motion", () => {
    for (const id of expectedIds) {
      const theme = getTheme(id);
      assert.equal(theme.id, id);
      assert.equal(typeof theme.name, "string");
      assert.equal(typeof theme.description, "string");
      assert.equal(typeof theme.ariaLabel, "string");
      assert.equal(typeof theme.preview.heading, "string");
      assert.equal(typeof theme.preview.copy, "string");
      for (const surface of ["page", "home", "board"]) {
        assert.match(theme.scene[surface], /^\/assets\/themes\/[a-z0-9-]+\/scene\.svg$/);
      }
      assert.ok(theme.motion.durationMs > 0);
      assert.ok(theme.motion.maxConcurrent >= 0 && theme.motion.maxConcurrent <= 1);
      for (const path of Object.values(theme.props)) {
        assert.match(path, /^\/assets\/themes\/[a-z0-9-]+\/[a-z0-9-]+\.svg$/);
      }
    }
  }),
  check("theme definitions do not expose semantic UI colors", () => {
    const semantic = new Set(["#35a653", "#d74438", "#286ea1"]);
    for (const theme of themeOptions()) {
      for (const value of Object.values(theme.palette)) assert.equal(semantic.has(value.toLowerCase()), false);
    }
  }),
  check("theme scene markup is decorative and noninteractive", () => {
    const theme = getTheme("bloom-district");
    const html = themeSceneMarkup(theme, "home");
    assert.match(html, /bloom-district\/scene\.svg/);
    assert.match(html, /aria-hidden="true"/);
    assert.doesNotMatch(html, /data-action|data-setting|socket|onclick/);
    assert.doesNotMatch(html, /<button\b|<input\b|<select\b|tabindex=/);
    for (const path of Object.values(theme.props)) assert.match(html, new RegExp(path.replaceAll("/", "\\/")));
    assert.match(themeSceneMarkup(getTheme("missing"), "unknown"), /midnight-ledger\/scene\.svg/);
  }),
];

const failures = checks.filter((result) => !result.ok);
checks.forEach((result) => {
  if (result.ok) console.log(`PASS - ${result.name}`);
  else console.error(`FAIL - ${result.name}: ${result.error.message}`);
});
console.log(`client theme registry: ${checks.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw failures[0].error;
