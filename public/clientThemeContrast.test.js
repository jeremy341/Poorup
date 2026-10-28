import assert from "node:assert/strict";
import process from "node:process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_IDS, getTheme } from "./clientThemeData.js";

// Contrast guard computed from
// the per-theme token maps (original = the :root block in styles.css).
const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, "styles.css"), "utf8");
const rootStart = css.indexOf(":root {");
const baseTokens = {};
for (const m of css.slice(rootStart, css.indexOf("\n}", rootStart)).matchAll(/(--[\w-]+):\s*([^;]+);/g)) baseTokens[m[1]] = m[2].trim();

function tokensFor(id) {
  const merged = { ...baseTokens, ...getTheme(id).tokens };
  const resolve = (value, depth = 0) => {
    const ref = /^var\((--[\w-]+)\)$/.exec(value || "");
    return ref && depth < 6 ? resolve(merged[ref[1]], depth + 1) : value;
  };
  return (name) => {
    const value = resolve(merged[name]);
    assert.match(String(value), /^#[0-9a-f]{6}$/i, `${id} ${name} must resolve to an opaque #rrggbb colour (got ${value})`);
    return value;
  };
}

function luminance(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The selector may be one of a comma-separated list sharing one rule body.
  const matches = [...css.matchAll(new RegExp(`(^|\\n)(?:[^{}]*,\\s*)?${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, "g"))];
  assert.ok(matches.length, `missing rule ${selector}`);
  return matches.map((m) => m[2]).join("\n");
}

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error }); }
}

for (const id of THEME_IDS) {
  check(`${id}: CTA label, sublabel and disabled label reach 4.5:1 on every action fill`, () => {
    const t = tokensFor(id);
    for (const fill of ["--red-action", "--red-action-hover", "--red-action-pressed"]) {
      assert.ok(contrast(t("--cta-label"), t(fill)) >= 4.5, `${id} --cta-label on ${fill} = ${contrast(t("--cta-label"), t(fill)).toFixed(2)}`);
      assert.ok(contrast(t("--cta-label-muted"), t(fill)) >= 4.5, `${id} --cta-label-muted on ${fill} = ${contrast(t("--cta-label-muted"), t(fill)).toFixed(2)}`);
    }
    const disabled = contrast(t("--cta-label-disabled"), t("--theme-action-shadow-muted"));
    assert.ok(disabled >= 4.5, `${id} disabled CTA label = ${disabled.toFixed(2)}`);
  });

  check(`${id}: dark-button labels reach 4.5:1 on the dark button surface`, () => {
    const t = tokensFor(id);
    const label = getTheme(id).tokens["--button-dark-label"] ? "--button-dark-label" : "--gold-300";
    assert.ok(contrast(t(label), t("--surface-button-dark")) >= 4.5, `${id} ${label} on --surface-button-dark = ${contrast(t(label), t("--surface-button-dark")).toFixed(2)}`);
  });
  check(`${id}: neutral auction bid labels reach 4.5:1 on their button states`, () => {
    const t = tokensFor(id);
    for (const [label, surface] of [
      ["--text-primary", "--surface-button-dark"],
      ["--text-primary", "--surface-button-hover"],
      ["--text-primary", "--surface-button-pressed"],
      ["--text-primary", "--surface-disabled"],
    ]) {
      const ratio = contrast(t(label), t(surface));
      assert.ok(ratio >= 4.5, `${id} ${label} on ${surface} = ${ratio.toFixed(2)}`);
    }
  });

  check(`${id}: control borders reach 3:1 against input, button and panel surfaces`, () => {
    const t = tokensFor(id);
    for (const surface of ["--surface-input", "--surface-button-dark", "--surface-panel", "--surface-panel-raised", "--surface-panel-deep", "--surface-button-hover"]) {
      const ratio = contrast(t("--line-control"), t(surface));
      assert.ok(ratio >= 3, `${id} --line-control on ${surface} = ${ratio.toFixed(2)}`);
    }
  });
}

for (const id of THEME_IDS) {
  check(`${id}: home hero text and wordmark contrast with the scene's base colour`, () => {
    const t = tokensFor(id);
    assert.ok(contrast(t("--text-primary"), t("--surface-board-center")) >= 7, `${id} body text on scene base`);
    assert.ok(contrast(t("--wordmark-color"), t("--surface-board-center")) >= 4.5, `${id} wordmark ${contrast(t("--wordmark-color"), t("--surface-board-center")).toFixed(2)}`);
  });
}

check("home hero uses theme text tokens instead of fixed dark-on-scene colours", () => {
  assert.doesNotMatch(css, /color: #173e4b|color: #3d321d|color: #173f4d/);
});

check("CTA labels and sublabels come from opaque tokens, not translucent literals", () => {
  assert.match(rule(".cta-red"), /color:\s*var\(--cta-label\)/);
  assert.match(rule(".cta-red:disabled"), /color:\s*var\(--cta-label-disabled\)/);
  for (const selector of [".choice-buy .t-micro", ".dd-build-btn .t-micro"]) {
    const body = rule(selector);
    assert.match(body, /color:\s*var\(--cta-label-muted\)/, `${selector} must use --cta-label-muted`);
    assert.doesNotMatch(body, /\/\s*\d+%/, `${selector} must not use alpha`);
  }
  assert.match(rule(".btn-dark"), /color:\s*var\(--button-dark-label, var\(--gold-300\)\)/);
  assert.match(rule(".auction-bid-btn"), /color:\s*var\(--text-primary\)/);
  assert.match(rule(".auction-bid-btn:hover:not(:disabled)"), /color:\s*var\(--text-primary\)/);
  assert.match(rule('.auction-bid-btn[aria-disabled="true"]'), /color:\s*var\(--text-primary\)/);
  for (const selector of [".auction-bid-btn .t-label", ".auction-bid-btn .t-micro"]) {
    assert.match(rule(selector), /color:\s*inherit/, `${selector} must inherit the neutral button color`);
  }
});

check("fields and dark buttons draw their border from --line-control", () => {
  assert.match(rule(".field"), /border:\s*1px solid var\(--line-control\)/);
  assert.match(rule(".btn-dark"), /border:\s*1px solid var\(--line-control\)/);
  assert.match(rule(".parlor-dropdown-trigger"), /border:\s*1px solid var\(--line-control\)/);
});

let failed = 0;
for (const result of checks) {
  if (result.ok) console.log(`ok - ${result.name}`);
  else { failed += 1; console.error(`not ok - ${result.name}\n  ${result.error?.message || result.error}`); }
}
if (failed) process.exit(1);
console.log(`${checks.length} theme contrast checks passed`);
