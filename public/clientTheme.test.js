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

const UI_ROLES = [
  "canvas", "chrome", "panel", "panelRaised", "panelDeep", "boardTile", "boardCenter", "input", "buttonDark",
  "textPrimary", "textSecondary", "textMuted", "accent", "accentBright", "lineDefault", "lineStrong", "lineActive", "lineBoard", "focus",
  "action", "actionHover", "actionPressed", "danger", "success", "warning", "player", "logoPrimary", "logoSecondary", "iconPrimary", "iconSecondary", "scrim", "scanline",
  "lineDark", "lineSubtle", "goldMuted", "redDark", "surfaceError", "lineError", "textError", "surfaceInset", "surfaceSelected", "surfaceHover", "surfaceBoardHover", "surfaceAvatar", "surfaceCard", "surfaceActive", "surfaceSpecial", "boardFrame", "lineShadow",
];

const MIDNIGHT_UI = {
  canvas: "#01070a", chrome: "#020a0d", panel: "#071314", panelRaised: "#09191a", panelDeep: "#030c10",
  boardTile: "#061011", boardCenter: "#031d1e", input: "#061216", buttonDark: "#081516",
  textPrimary: "#e8d3ab", textSecondary: "#a79d7d", textMuted: "#a79d7d", accent: "#cfa75f", accentBright: "#f0d9ac",
  lineDefault: "#5c5033", lineStrong: "#6b5a36", lineActive: "#c88f2e", lineBoard: "#9b783d", focus: "#f0d9ac",
  action: "#af2a21", actionHover: "#be3126", actionPressed: "#98231c", danger: "#d74438", success: "#35a653", warning: "#c88f2e", player: "#286ea1",
  logoPrimary: "#9b783d", logoSecondary: "#cfa75f", iconPrimary: "#cfa75f", iconSecondary: "#f0d9ac", scrim: "#01070acc", scanline: "#f0d9ac08",
  lineDark: "#5c5033", lineSubtle: "#5c5033", goldMuted: "#a79d7d", redDark: "#98231c", surfaceError: "#030c10", lineError: "#d74438", textError: "#e8d3ab",
  surfaceInset: "#030c10", surfaceSelected: "#031d1e", surfaceHover: "#09191a", surfaceBoardHover: "#031d1e", surfaceAvatar: "#030c10", surfaceCard: "#071314", surfaceActive: "#031d1e", surfaceSpecial: "#09191a", boardFrame: "#020a0d", lineShadow: "#030c10",
};

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
  check("each theme exposes complete UI tokens", () => {
    for (const id of expectedIds) {
      const theme = getTheme(id);
      assert.ok(theme.ui, `${id} is missing ui tokens`);
      for (const role of UI_ROLES) assert.match(theme.ui[role], /^#[0-9a-f]{6,8}$/i, `${id}.${role}`);
    }
    assert.deepEqual(MIDNIGHT_UI, getTheme(DEFAULT_THEME_ID).ui);
  }),
  check("semantic colors stay separate from environmental accents", () => {
    const semanticRoles = ["groups", "success", "danger", "warning", "player", "ownership", "focus"];
    for (const theme of themeOptions()) {
      assert.ok(theme.semantic, `${theme.id} is missing semantic roles`);
      semanticRoles.forEach((role) => assert.ok(theme.semantic[role], `${theme.id}.${role}`));
      assert.equal(typeof theme.semantic.groups, "object");
      assert.equal(typeof theme.semantic.groups.brown, "string");
      assert.deepEqual(theme.semantic.groups, {
        brown: "#7b5029", cyan: "#3e7d7b", magenta: "#a04e6f", orange: "#b96d2a",
        red: "#87231e", yellow: "#b18a2e", green: "#4b853d", blue: "#286ea1",
      });
    }
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
      assert.deepEqual(theme.assetSlots, ["signature", "incident", "light", "weather", "detail"]);
      assert.equal(Object.keys(theme.props).length, theme.assetSlots.length);
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
