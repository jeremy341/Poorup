import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const surfaces = await import("./clientSocialSurfaces.js");
const source = readFileSync(new URL("./clientSocialSurfaces.js", import.meta.url), "utf8");
const bindings = readFileSync(new URL("./clientParlorBindings.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function check(name, assertion) {
  try {
    assertion();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

check("rankingMetricFamiliesPreserveExistingMetricSnapshots", () => {
  assert.deepEqual(surfaces.RANKING_METRIC_FAMILIES, {
    results: ["wins", "rate", "games", "bankruptcies"],
    tablecraft: ["achievements", "mythical", "events", "auctions", "patrol"],
    economy: ["rent", "casino", "market", "playerloans", "equity", "loans"],
  });
  for (const metric of surfaces.RANKING_ORDER) assert.ok(surfaces.RANKING_LABELS[metric]);
  const html = surfaces.rankingMetricNavigationHTML("market");
  assert.match(html, /class="ranking-family-control is-active" aria-current="true">ECONOMY & DEALS/);
  assert.match(html, /class="ranking-metric-control is-active" type="button" data-ranking-metric="market"[^>]+aria-pressed="true"/);
  assert.match(html, /data-ranking-metric="rent"/);
});

check("rankingScopesAndSearchRemainAvailable", () => {
  assert.match(source, /\[\["all", "ALL TIME"\], \["season", "THIS SEASON"\], \["month", "30 DAYS"\], \["friends", "FRIENDS"\]\]/);
  assert.match(source, /data-ranking-search-form/);
  assert.match(source, /data-ranking-search-input/);
  assert.match(source, /data-ranking-scope=/);
});

check("rankingFamilyTabsAreKeyboardAccessible", () => {
  const html = surfaces.rankingMetricNavigationHTML("wins");
  assert.match(html, /role="group" aria-label="Ranking metric families"/);
  assert.match(html, /<button[^>]+type="button"[^>]+data-ranking-family=/);
  assert.match(html, /<button[^>]+type="button"[^>]+data-ranking-metric=/);
  assert.match(html, /aria-current="true"/);
  assert.match(styles, /\.ranking-family-control:focus-visible/);
  assert.match(styles, /\.ranking-metric-control:focus-visible/);
});

check("rankingFocusReturnsToSelectedMetric", () => {
  const html = surfaces.rankingMetricNavigationHTML("market");
  assert.match(html, /<button class="ranking-metric-control is-active" type="button" data-ranking-metric="market"[^>]+aria-pressed="true"[^>]+aria-current="true"[^>]+aria-disabled="true">MARKET PROFIT/);
  assert.match(bindings, /function focusSelectedRankingMetric\(surface\)[\s\S]*?\[data-ranking-metric="\$\{state\.leaderboard\.metric\}"\][\s\S]*?focus\(\{ preventScroll: true \}\)/);
  assert.equal((bindings.match(/focusSelectedRankingMetric\(surface\);/g) || []).length, 2);
});

check("seasonGuestSeesExactlyOneSignInCta", () => {
  const season = {
    id: "2026-08-11",
    status: "active",
    startsAt: "2026-08-11",
    endsAt: "2026-10-12",
  };
  const rewards = ["bronze", "silver", "gold"].map((id, index) => ({ id, track: "placement", threshold: (index + 1) / 100, tokens: 40 * (index + 1) }));
  const html = surfaces.seasonPanelHTML("test", { season, rewards, signedIn: false });
  assert.equal((html.match(/data-season-sign-in/g) || []).length, 1);
  assert.equal((html.match(/>SIGN IN</g) || []).length, 1);
  assert.equal((html.match(/data-season-claim=/g) || []).length, 0);
  for (const reward of rewards) assert.ok(html.includes(reward.id.toUpperCase()));
});

check("seasonLoadingErrorEmptyAndStaleStatesRemainUseful", () => {
  const loading = surfaces.seasonPanelHTML("test", { loading: true });
  assert.match(loading, /LOADING VERIFIED SEASON/);
  const error = surfaces.seasonPanelHTML("test", { error: "Service unavailable" });
  assert.match(error, /Service unavailable/);
  assert.match(error, /data-season-retry/);
  const empty = surfaces.seasonPanelHTML("test", { season: { id: "S1", status: "active" }, rows: [], rewards: [], signedIn: true });
  assert.match(empty, /NO VERIFIED PLACEMENTS YET/);
  assert.match(empty, /REWARDS WILL APPEAR AFTER YOUR FIRST ELIGIBLE MATCH/);
  const stale = surfaces.seasonPanelHTML("test", { season: { id: "S1", status: "active" }, stale: true, error: "Refresh failed", rows: [], rewards: [], signedIn: true });
  assert.match(stale, /LAST VERIFIED SEASON SHOWN/);
  assert.match(stale, /data-season-retry/);
});
