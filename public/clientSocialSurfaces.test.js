import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const surfaces = await import("./clientSocialSurfaces.js");
const source = readFileSync(new URL("./clientSocialSurfaces.js", import.meta.url), "utf8");
const responsiveSource = readFileSync(new URL("./clientResponsiveSocialSurfaces.js", import.meta.url), "utf8");
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

check("rankingArrowNavigationPreservesExistingMetricSnapshots", () => {
  assert.equal(surfaces.RANKING_ORDER.length, 15);
  for (const metric of surfaces.RANKING_ORDER) assert.ok(surfaces.RANKING_LABELS[metric]);
  const html = surfaces.rankingMetricNavigationHTML("market");
  assert.match(html, /class="btn-dark ranking-step" type="button" data-ranking-step="-1" aria-label="Previous ranking category"/);
  assert.match(html, /class="btn-dark ranking-step" type="button" data-ranking-step="1" aria-label="Next ranking category"/);
  assert.match(html, /<strong class="t-label f12 g100">11 \/ 15<\/strong>/);
  assert.doesNotMatch(source, /RANKING_METRIC_FAMILIES|ranking-family-control/);
});

check("sharedHistoryShowsNotRecordedForSparseLegacyFields", () => {
  const html = surfaces.playerHistoryHTML([{
    completedAt: "2024-01-01T00:00:00.000Z"
  }], { accountId: "target" });
  assert.match(html, /RESULT NOT RECORDED/);
  assert.match(html, /NOT RECORDED PLAYERS/);
  assert.match(html, /NOT RECORDED DEEDS/);
  assert.match(html, /NOT RECORDED EVENTS/);
  assert.match(html, /NOT RECORDED COMBOS/);
  assert.doesNotMatch(html, /ROUND COMPLETE|0 PLAYERS|0 DEEDS|0 EVENTS|0 COMBOS/);

  const recorded = surfaces.playerHistoryHTML([{
    participants: [{ isViewedPlayer: true, finalPlacement: 2, propertyCount: 0 }],
    globalEvents: [],
    eventCombinations: []
  }], { accountId: "target" });
  assert.match(recorded, /PLACE 2/);
  assert.match(recorded, /0 DEEDS/);
  assert.match(recorded, /1 PLAYERS/);
  assert.match(recorded, /0 EVENTS/);
  assert.match(recorded, /0 COMBOS/);

  for (const finalPlacement of [null, 0, -1, 1.5, "2"]) {
    const invalidPlacement = surfaces.playerHistoryHTML([{
      participants: [{ isViewedPlayer: true, finalPlacement }]
    }], { accountId: "target" });
    assert.match(invalidPlacement, /RESULT NOT RECORDED/);
    assert.doesNotMatch(invalidPlacement, /PLACE (?:null|0|-1|1\.5|2)/);
  }
});

check("rankingScopesAndSearchRemainAvailable", () => {
  assert.match(source, /\[\["all", "ALL TIME"\], \["season", "THIS SEASON"\], \["month", "30 DAYS"\], \["friends", "FRIENDS"\]\]/);
  assert.match(responsiveSource, /data-ranking-search-form/);
  assert.match(responsiveSource, /data-ranking-search-input/);
  assert.match(source, /data-ranking-scope=/);
});

check("rankingArrowControlsRemainKeyboardAccessible", () => {
  const html = surfaces.rankingMetricNavigationHTML("wins");
  assert.match(html, /role="group" aria-label="Change ranking category"/);
  assert.equal((html.match(/class="btn-dark ranking-step"/g) || []).length, 2);
  assert.match(styles, /\.ranking-step:hover, \.ranking-step:focus-visible/);
  assert.match(bindings, /function focusRankingStep\(surface, direction\)[\s\S]*?\[data-ranking-step="\$\{direction\}"\][\s\S]*?focus\(\{ preventScroll: true \}\)/);
  assert.equal((bindings.match(/focusRankingStep\(surface,/g) || []).length, 3);
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
