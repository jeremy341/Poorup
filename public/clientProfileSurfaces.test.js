import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const render = readFileSync(new URL("./clientProfileRender.js", import.meta.url), "utf8");
const bindings = readFileSync(new URL("./clientProfileBindings.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { profileHistoryRowHTML, profileStatisticsHTML, profileHistoryToggleAccessibleName } = await import("./clientProfileRender.js");
const checks = [];

function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error });
  }
}

check("statisticsUseCompactOverviewAndInternalTabs", () => {
  const html = profileStatisticsHTML({ account: { stats: {} }, stats: {}, games: 0, wins: 0, bankruptcies: 0, winShare: 0, chronological: [] });
  for (const label of ["RESULTS", "ECONOMY", "DEALS &amp; EVENTS"]) assert.ok(html.includes(label), `${label} tab missing`);
  assert.match(html, /role="tablist"/);
  assert.doesNotMatch(html, /stats-metric-grid/);
});

check("recentResultsAreCategoricalAndTruthful", () => {
  const html = profileStatisticsHTML({ account: {}, accountId: "self", games: 2, wins: 1, bankruptcies: 0, winShare: 50, stats: {}, chronological: [
    { matchId: "winner", result: "WIN", playedAt: "2026-09-01" },
    { matchId: "unknown", playedAt: "2026-09-02" }
  ] });
  assert.match(html, /WIN/);
  assert.match(html, /NOT RECORDED/);
  assert.doesNotMatch(html, /--bar-height|stats-chart-bars|role="img" aria-label="Win history chart/);
  assert.match(html, /profile-recent-results/);
});

check("historyRowsExpandWithAccessibleControlsAndRestoreFocus", () => {
  const html = profileHistoryRowHTML({ matchId: "stable-id", result: "WIN", playedAt: "2026-09-01" }, 0, 1, "self");
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls=/);
  for (const label of ["SUMMARY", "PLAYERS", "ECONOMY &amp; DEALS", "EVENTS"]) assert.ok(html.includes(label), `${label} detail tab missing`);
  assert.match(bindings, /profile-history-toggle/);
  assert.match(bindings, /scrollTop|scrollY/);
  assert.match(bindings, /focus\(\{\s*preventScroll:\s*true\s*\}\)/);
});

check("legacyMissingFieldsRenderNotRecorded", () => {
  const html = profileHistoryRowHTML({ matchId: "older-id", playedAt: "2026-09-01" }, 0, 1, "self");
  assert.match(html, /NOT RECORDED/);
  assert.match(html, /data-profile-detail-source="unavailable"/);
});

check("legacyRowsDoNotInventDateDeedOrEventCounts", () => {
  const html = profileHistoryRowHTML({ matchId: "sparse-legacy" }, 0, 1, "self");
  assert.match(html, /NOT RECORDED/);
  assert.doesNotMatch(html, /· ROUND ·|DEEDS 0|>0 EVENTS</);
});

check("scrollableDefaultResultsPanelIsKeyboardFocusable", () => {
  const html = profileStatisticsHTML({ account: {}, stats: {}, games: 0, wins: 0, bankruptcies: 0, winShare: 0, chronological: [] });
  assert.match(html, /id="profile-stat-panel-results"[^>]*tabindex="0"/);
});

check("historyToggleKeepsMatchContextInAccessibleName", () => {
  const html = profileHistoryRowHTML({ matchId: "named-match", result: "WIN", playedAt: "2026-09-01" }, 0, 1, "self");
  const initial = html.match(/aria-label="([^"]+)"/)[1];
  assert.match(initial, /^Show details for .+: WIN$/);
  assert.equal(typeof profileHistoryToggleAccessibleName, "function");
  const expanded = profileHistoryToggleAccessibleName(initial, true);
  const collapsed = profileHistoryToggleAccessibleName(expanded, false);
  assert.equal(expanded, initial.replace(/^Show details/, "Hide details"));
  assert.equal(collapsed, initial);
});

check("redactedHistoryCannotRenderPrivateFields", () => {
  const redacted = profileHistoryRowHTML({ matchId: "public-id", result: "ROUND", endingCash: 9123, playerContracts: [{ terms: "secret-term" }] }, 0, 1, "self");
  assert.match(redacted, /data-profile-detail-source="unavailable"/);
  assert.doesNotMatch(redacted, /9123|secret-term/);
  const owner = profileHistoryRowHTML({ matchId: "private-id", result: "ROUND" }, 0, 1, "self", {
    matchId: "private-id", participants: [{ accountId: "self", endingCash: 500, finalPlacement: 2 }], botDecisions: ["do-not-render"],
  });
  assert.match(owner, /data-profile-detail-source="owner"/);
  assert.match(owner, /\$500/);
  assert.doesNotMatch(owner, /do-not-render/);
  assert.match(render, /matchHistory/);
  assert.match(styles, /profile-detail-scroll[^{]*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /profile-history-details[^{]*\{[^}]*overflow|overflow[XY]?\s*:/s);
});

const failures = checks.filter((checkResult) => !checkResult.ok);
for (const result of checks) {
  if (result.ok) console.log(`PASS - ${result.name}`);
  else console.error(`FAIL - ${result.name}: ${String(result.error.message).slice(0, 240)}`);
}
console.log(`profile surface contracts: ${checks.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`${failures.length} profile surface contract(s) failed: ${failures.map((result) => result.name).join(", ")}`);
