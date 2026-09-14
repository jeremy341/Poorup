import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const profileBindings = readFileSync(new URL("./clientProfileBindings.js", import.meta.url), "utf8");

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error });
  }
}

function expectMatch(source, pattern, message) {
  assert.ok(pattern.test(source), message || `Expected ${pattern}`);
}

check("document exposes a skip link, named mains, and a browser theme color", () => {
  expectMatch(index, /<a[^>]+id="skip-link"[^>]+href="#home-main"[^>]*>Skip to main content<\/a>/i, "skip link is missing");
  for (const id of ["home-main", "profile-main", "rankings-page-content", "social-page-content", "rules-page-content", "game-main"]) {
    expectMatch(index, new RegExp(`<main[^>]+id="${id}"`, "i"), `${id} is missing`);
  }
  expectMatch(index, /<meta[^>]+name="theme-color"[^>]+content="#01070a"/i, "theme-color meta is missing");
});

check("rankings and social page shells expose a page-level heading", () => {
  expectMatch(index, /<h1[^>]+id="rankings-page-heading"[^>]*>Global Rankings<\/h1>/i, "rankings page H1 is missing");
  expectMatch(index, /<main[^>]+id="rankings-page-content"[^>]+aria-labelledby="rankings-page-heading"/i, "rankings main label is missing");
  expectMatch(index, /<h1[^>]+id="social-page-heading"[^>]*>Parlor Social<\/h1>/i, "social page H1 is missing");
  expectMatch(index, /<main[^>]+id="social-page-content"[^>]+aria-labelledby="social-page-heading"/i, "social main label is missing");
});

check("shared modal and drawer close targets have a 40px floor", () => {
  expectMatch(styles, /button\[id\$="-close"\][^{]*\{[^}]*min-height:\s*40px/i, "close target floor is missing");
});

check("mobile Rules intro uses a readable two-row grid", () => {
  expectMatch(styles, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.rules-intro\s*\{[^}]*display:\s*grid/i, "rules intro grid is missing");
  expectMatch(styles, /\.rules-intro-meta\s*\{[^}]*grid-area:\s*meta/i, "rules meta row is missing");
  expectMatch(styles, /\.rules-intro-copy\s*\{[^}]*grid-area:\s*copy/i, "rules copy area is missing");
});

check("mobile Home patrol readouts flow before the title", () => {
  expectMatch(styles, /@media\s*\(orientation:\s*portrait\)[\s\S]*?\.home-sky-atmosphere\s*\{[^}]*position:\s*static/i, "portrait patrol band is missing");
  expectMatch(styles, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.home-local-time\s*\{[^}]*position:\s*static/i, "mobile local-time flow is missing");
  expectMatch(styles, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.home-patrol-score\s*\{[^}]*position:\s*static/i, "mobile score flow is missing");
});

check("portrait and mobile text fields keep the 16px focus floor", () => {
  expectMatch(styles, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.field[^}]*font-size:\s*16px/i, "mobile field font floor is missing");
});

check("landscape iPad frequent controls use the 44px touch contract", () => {
  const tablet = styles.match(/@media\s*\(orientation:\s*landscape\)[\s\S]*$/i)?.[0] || "";
  expectMatch(tablet, /\.home-nav-tab\s*\{[^}]*min-height:\s*44px/i, "tablet nav target floor is missing");
  expectMatch(tablet, /\.audio-toggle\s*\{[^}]*height:\s*44px/i, "tablet audio target floor is missing");
  expectMatch(tablet, /\.chair-edit\s*\{[^}]*min-height:\s*44px/i, "tablet chair target floor is missing");
});

check("static CSS aliases resolve to the Poorup token roles", () => {
  assert.ok(!/var\(--ink-[13]\)/.test(styles), "undefined ink aliases remain");
  assert.ok(!/var\(--font-mono\)/.test(styles), "undefined font alias remains");
  expectMatch(styles, /\.ranking-scope[^}]*color:\s*var\(--text-muted\)/, "ranking scope token is missing");
  expectMatch(styles, /\.casino-reel-card[^}]*font-family:\s*var\(--font-numeric\)/, "casino numeric token is missing");
});

check("decorative compositor hints are scoped to active animation states", () => {
  for (const selector of [".home-helicopter", ".home-patrol-effect", ".night-target", ".night-shift-effect", ".casino-reel-track"]) {
    assert.doesNotMatch(styles, new RegExp(`(?:^|\\r?\\n)${selector.replace(/[.-]/g, "\\$&")}\\s*\\{[^}]*will-change\\s*:`, "i"), `${selector} keeps an idle will-change hint`);
  }
  expectMatch(styles, /\.home-helicopter\.is-flying[^{]*\{[^}]*will-change:\s*transform,\s*opacity/i, "helicopter active compositor hint is missing");
  expectMatch(styles, /\.home-patrol-effect\.is-burst[^{]*\{[^}]*will-change:\s*transform,\s*opacity/i, "patrol burst compositor hint is missing");
  expectMatch(styles, /\.night-target\.is-flight[^{]*\{[^}]*will-change:\s*transform,\s*opacity/i, "night target active compositor hint is missing");
  expectMatch(styles, /\.night-shift-effect\.(?:is-burst|night-shift-aircraft-burst)[^{]*\{[^}]*will-change:\s*transform,\s*opacity/i, "night effect active compositor hint is missing");
  expectMatch(styles, /\.casino-reel\[data-reel-state="presenting"\]\s+\.casino-reel-track\s*\{[^}]*will-change:\s*transform/i, "casino reel active compositor hint is missing");
  assert.doesNotMatch(styles, /\.theme-pedestrian-band\s*,[\s\S]{0,200}will-change:\s*transform/i, "pedestrian container receives a compositor hint instead of animated children");
  expectMatch(styles, /\.theme-pedestrian-a\s*,\s*\.theme-pedestrian-b[\s\S]{0,200}will-change:\s*transform/i, "pedestrian animated children lack compositor hints");
});

check("mobile navigation retains a visible overflow cue", () => {
  expectMatch(styles, /\.hdr \.home-nav[^}]*mask-image:\s*linear-gradient/i, "mobile nav mask cue is missing");
  expectMatch(styles, /\.hdr \.home-nav[^}]*-webkit-mask-image:\s*linear-gradient/i, "mobile nav webkit mask cue is missing");
});

check("event summaries wrap at narrow widths", () => {
  expectMatch(styles, /@media\s*\(max-width:\s*620px\)[\s\S]*?\.global-event-copy\s*\{[^}]*white-space:\s*normal/i, "event summary wrap is missing");
});

check("static duplicate status nodes are removed", () => {
  assert.ok(!/class="chair-flag"/.test(index), "static chair status remains");
  assert.ok(!/id="tn-connection-note"/.test(index), "static game connection note remains");
  assert.ok(!/<div class="online">[\s\S]*id="tn-online"/.test(index), "static game online status remains");
  assert.ok(!/#view-home \.hdr-right > \.online/.test(styles), "global duplicate-status suppression remains");
});

check("touch painting resolves the cell under the pointer", () => {
  expectMatch(profileBindings, /elementFromPoint\(e\.clientX,\s*e\.clientY\)/, "pointer painting does not resolve under-pointer cell");
});

const failures = checks.filter((result) => !result.ok);
checks.forEach((result) => {
  if (result.ok) console.log(`PASS - ${result.name}`);
  else console.error(`FAIL - ${result.name}: ${result.error.message}`);
});
console.log(`client responsive/a11y tests: ${checks.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw failures[0].error;
