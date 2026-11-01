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
  assert.ok(surfaces.RANKING_ORDER.includes("patrol"), "Parlor Patrol is a ranking metric");
  for (const metric of surfaces.RANKING_ORDER) assert.ok(surfaces.RANKING_LABELS[metric]);
  const html = surfaces.rankingMetricNavigationHTML("market");
  assert.match(html, /class="btn-dark ranking-step" type="button" data-ranking-step="-1" aria-label="Previous ranking category"/);
  assert.match(html, /class="btn-dark ranking-step" type="button" data-ranking-step="1" aria-label="Next ranking category"/);
  assert.match(html, /<strong class="t-label f12 g100">11 \/ 15<\/strong>/);
  assert.doesNotMatch(source, /RANKING_METRIC_FAMILIES|ranking-family-control/);
});

check("rankingsShowTenRowsPerPageWithoutDroppingTheFullSnapshot", () => {
  const allRows = Array.from({ length: 23 }, (_, index) => ({ index }));
  assert.equal(surfaces.RANKING_PAGE_SIZE, 10);
  assert.deepEqual(surfaces.rankingsPageSlice(allRows, 0), {
    rows: allRows.slice(0, 10), total: 23, page: 0, pageCount: 3, start: 0,
  });
  assert.deepEqual(surfaces.rankingsPageSlice(allRows, 1), {
    rows: allRows.slice(10, 20), total: 23, page: 1, pageCount: 3, start: 10,
  });
  assert.deepEqual(surfaces.rankingsPageSlice(allRows, 99), {
    rows: allRows.slice(20), total: 23, page: 2, pageCount: 3, start: 20,
  });
  assert.match(source, /data-ranking-page="-1"/);
  assert.match(source, /data-ranking-page="1"/);
  assert.match(bindings, /data-ranking-page/);
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
  assert.match(source, /\[\["all", "ALL TIME"\], \["month", "30 DAYS"\], \["friends", "FRIENDS"\]\]/);
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

check("retiredSeasonSurfacesAndRequestsAreGone", () => {
  assert.equal(typeof surfaces.requestSeason, "undefined");
  assert.equal(typeof surfaces.seasonPanelHTML, "undefined");
  assert.doesNotMatch(source, /get-season|claim-season-reward|Season Ledger|data-season-claim|THIS SEASON|rankings-pane-tab/);
  assert.match(source, /\[\["all", "ALL TIME"\], \["month", "30 DAYS"\], \["friends", "FRIENDS"\]\]/);
});

check("rulesExplainAuctionAndPropertyActionTiming", () => {
  assert.match(source, /Each valid bid resets the five-second timer/);
  assert.match(source, /There is no pass action during an auction/);
  assert.match(source, /build houses and hotels before ending your turn/);
  assert.match(source, /sell buildings evenly for half their cost on any turn/);
  assert.match(source, /Mortgaging an owned deed may happen on any turn/);
});

check("sharedHistoryReadsBankruptLikeOwnHistoryAndKeepsMatchNumbers", () => {
  const history = [
    { completedAt: "2026-10-19T12:00:00.000Z", participants: [{ isViewedPlayer: true, finalPlacement: 1 }], globalEvents: [] },
    { completedAt: "2026-10-18T12:00:00.000Z", participants: [{ isViewedPlayer: true, finalPlacement: 4, bankrupt: true }] },
  ];
  const html = surfaces.playerHistoryHTML(history, { accountId: "target" });
  assert.match(html, /is-bankrupt/);
  assert.match(html, /red">BANKRUPT</);
  assert.doesNotMatch(html, /PLACE 4/);
  assert.match(html, /MATCH 02/);
  assert.match(html, /MATCH 01/);
  assert.match(html, /OCT 19, 2026/);
  assert.doesNotMatch(html, /2026-10-19/);
});

check("sharedHistoryLayoutRulesExist", () => {
  assert.match(styles, /\.player-history-main\s*\{[^}]*display:\s*flex/);
  assert.match(styles, /\.player-history-meta\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(styles, /\.player-history-row\.is-bankrupt/);
});

function renderInto(id, render) {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.window.addEventListener = () => {};
  const card = { id, innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const previous = globalThis.document.querySelector;
  globalThis.document.querySelector = (selector) => (selector === `#${id}` ? card : null);
  try {
    render(`#${id}`);
  } finally {
    globalThis.document.querySelector = previous;
  }
  return card.innerHTML;
}

const { state } = await import("./clientState.js");

check("inGameRankingsAndSocialShareThePageContentAndReturnToTheTable", () => {
  state.roomCode = "UXCAP1";
  const pageRankings = renderInto("rankings-page-content", surfaces.renderRankingsSurface);
  const modalRankings = renderInto("rankings-card", surfaces.renderRankingsSurface);
  const pageSocial = renderInto("social-page-content", surfaces.renderSocialSurface);
  const modalSocial = renderInto("social-card", surfaces.renderSocialSurface);
  // Rankings share their ledger; table Social shares actions in a compact shell.
  for (const marker of ["PARLOR RECORDS", "Global Rankings", "data-ranking-stage", "data-ranking-scope=\"all\"", "data-ranking-step=\"1\""]) {
    assert.ok(pageRankings.includes(marker) && modalRankings.includes(marker), marker);
  }
  for (const marker of ["social-network-grid", "data-social-tab=\"friends\"", "data-social-search-form"]) {
    assert.ok(pageSocial.includes(marker) && modalSocial.includes(marker), marker);
  }
  for (const [html, id] of [[modalRankings, "rankings-close"], [modalSocial, "social-close"]]) {
    assert.match(html, new RegExp(`class="table-return-bar"><button class="btn-dark social-close table-return-btn" id="${id}"`));
    assert.match(html, /BACK TO TABLE/);
    assert.match(html, /TABLE STAYS LIVE · ROOM UXCAP1/);
    assert.doesNotMatch(html, />CLOSE</);
  }
  for (const html of [pageRankings, pageSocial]) assert.doesNotMatch(html, /table-return-bar|BACK TO TABLE/);
});

check("inGameReturnBarIsPinnedInsideAFixedCardWithInternalScroll", () => {
  const ux = readFileSync(new URL("./ux-surfaces.css", import.meta.url), "utf8");
  assert.match(ux, /#rankings-modal \.social-surface-card,\s*#social-modal \.social-surface-card\s*\{[^}]*height:\s*min\(860px/);
  assert.match(ux, /\.table-return-bar\s*\{[^}]*flex-shrink:\s*0/);
  assert.match(ux, /\.table-return-btn\s*\{[^}]*min-height:\s*44px/);
  assert.match(ux, /position:\s*sticky/);
});

check("computerProfileIsReachableFromTheBotCardAndShowsOnlyItsRecord", () => {
  assert.match(source, /data-player-action="computer-profile"/);
  assert.match(bindings, /action\.dataset\.playerAction === "computer-profile"[\s\S]*state\.selectedPlayerView = "computer"/);
  assert.match(source, /state\.selectedPlayerView === "computer"/);
  assert.match(source, /NO UNLOCKS YET/);
  assert.match(styles, /\.computer-profile-unlock\s*\{/);
});
