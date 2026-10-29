import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const render = readFileSync(new URL("./clientProfileRender.js", import.meta.url), "utf8");
const bindings = readFileSync(new URL("./clientProfileBindings.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = { querySelector: () => null };
const {
  profileHistoryRowHTML, profileStatisticsHTML, profileHistoryToggleAccessibleName,
  profileHistorySummary, filterProfileHistory, profileHistoryCountLabel, historyPanelHTML, setProfileHistoryFilter, historyNetWorthChartSpec,
} = await import("./clientProfileRender.js");
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
  const html = profileHistoryRowHTML({ matchId: "stable-id", result: "WIN", playedAt: "2026-09-01" }, 0, 1, { accountId: "self" });
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls=/);
  for (const label of ["SUMMARY", "PLAYERS", "ECONOMY &amp; DEALS", "EVENTS"]) assert.ok(html.includes(label), `${label} detail tab missing`);
  assert.match(bindings, /profile-history-toggle/);
  assert.match(bindings, /scrollTop|scrollY/);
  assert.match(bindings, /focus\(\{\s*preventScroll:\s*true\s*\}\)/);
});

check("legacyMissingFieldsRenderNotRecorded", () => {
  const html = profileHistoryRowHTML({ matchId: "older-id", playedAt: "2026-09-01" }, 0, 1, { accountId: "self" });
  assert.match(html, /NOT RECORDED/);
  assert.match(html, /data-profile-detail-source="unavailable"/);
});

check("legacyRowsDoNotInventDateDeedOrEventCounts", () => {
  const html = profileHistoryRowHTML({ matchId: "sparse-legacy" }, 0, 1, { accountId: "self" });
  assert.match(html, /NOT RECORDED/);
  assert.doesNotMatch(html, /· ROUND ·|DEEDS 0|>0 EVENTS</);
});

check("scrollableDefaultResultsPanelIsKeyboardFocusable", () => {
  const html = profileStatisticsHTML({ account: {}, stats: {}, games: 0, wins: 0, bankruptcies: 0, winShare: 0, chronological: [] });
  assert.match(html, /id="profile-stat-panel-results"[^>]*tabindex="0"/);
});

check("historyToggleKeepsMatchContextInAccessibleName", () => {
  const html = profileHistoryRowHTML({ matchId: "named-match", result: "WIN", playedAt: "2026-09-01" }, 0, 1, { accountId: "self" });
  const initial = html.match(/aria-label="([^"]+)"/)[1];
  assert.match(initial, /^Show details for .+: WIN$/);
  assert.equal(typeof profileHistoryToggleAccessibleName, "function");
  const expanded = profileHistoryToggleAccessibleName(initial, true);
  const collapsed = profileHistoryToggleAccessibleName(expanded, false);
  assert.equal(expanded, initial.replace(/^Show details/, "Hide details"));
  assert.equal(collapsed, initial);
});

check("retiredCollectionIsRemovedWhileDesignThemesAndMusicRemain", () => {
  assert.doesNotMatch(bindings, /clientCosmetics|requestCosmetics|handleCosmeticClick|profile-collection-content|"collection"/);
  assert.doesNotMatch(render, /renderCollection|profile-collection-content/);
  assert.match(bindings, /"designs"/);
  assert.match(render, /profile-music-state/);
});

check("redactedHistoryCannotRenderPrivateFields", () => {
  const redacted = profileHistoryRowHTML({ matchId: "public-id", result: "ROUND", endingCash: 9123, playerContracts: [{ terms: "secret-term" }] }, 0, 1, { accountId: "self" });
  assert.match(redacted, /data-profile-detail-source="unavailable"/);
  assert.doesNotMatch(redacted, /9123|secret-term/);
  const owner = profileHistoryRowHTML({ matchId: "private-id", result: "ROUND" }, 0, 1, { accountId: "self", ownerRecord: {
    matchId: "private-id", participants: [{ accountId: "self", endingCash: 500, finalPlacement: 2 }], botDecisions: ["do-not-render"],
  } });
  assert.match(owner, /data-profile-detail-source="owner"/);
  assert.match(owner, /\$500/);
  assert.doesNotMatch(owner, /do-not-render/);
  assert.match(render, /matchHistory/);
  assert.match(styles, /profile-detail-scroll[^{]*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /profile-history-details[^{]*\{[^}]*overflow|overflow[XY]?\s*:/s);
});

const ownerRecord = {
  matchId: "rich-id", completedAt: "2026-10-19T12:00:00.000Z", durationSeconds: 900, roundCount: 12,
  casino: [{ accountId: "self", net: -20 }], market: [{ accountId: "self", net: 65 }], auctionsCompleted: 3,
  globalEvents: [], playerContracts: [],
  participants: [
    { accountId: "other", displayNameAtMatch: "NIGHT OWL", finalPlacement: 3, endingCash: 90, propertyCount: 1 },
    { accountId: "self", displayNameAtMatch: "ME", finalPlacement: 1, endingCash: 1320, propertyCount: 5 },
    { accountId: "third", displayNameAtMatch: "CASH CROW", finalPlacement: 2, endingCash: 760, propertyCount: 3, bankrupt: true },
  ],
};

check("collapsedRowShowsLabelledColumnsAndOwnerOnlyCash", () => {
  const owned = profileHistoryRowHTML(ownerRecord, 0, 1, { accountId: "self", ownerRecord });
  for (const label of ["PLAYERS", "DEEDS", "ENDING CASH", "EVENTS"]) assert.ok(owned.includes(`>${label}<`), `${label} column missing`);
  assert.match(owned, /profile-history-stat"><span class="t-micro ink-3">ENDING CASH<\/span><strong[^>]*>\$1[.,\s]?320</);
  assert.match(owned, /OCT 19, 2026/);
  const publicOnly = profileHistoryRowHTML({ matchId: "public-only", result: "ROUND", endingCash: 9123 }, 0, 1, { accountId: "self" });
  assert.match(publicOnly, /ENDING CASH<\/span><strong[^>]*>-<span class="sr-only">NOT RECORDED/);
  assert.doesNotMatch(publicOnly, /9,?123/);
  const bankrupt = profileHistoryRowHTML({ matchId: "b", participants: [{ accountId: "self", bankrupt: true }] }, 0, 1, { accountId: "self" });
  assert.match(bankrupt, /profile-history-row is-bankrupt/);
});

check("detailTabsRankPlayersMarkYouAndSignMoney", () => {
  const html = profileHistoryRowHTML(ownerRecord, 0, 1, { accountId: "self", ownerRecord });
  const order = [...html.matchAll(/profile-history-player-name[^>]*>([A-Z ]+)</g)].map((match) => match[1].trim());
  assert.deepEqual(order, ["ME", "CASH CROW", "NIGHT OWL"]);
  assert.match(html, /profile-history-player is-you/);
  assert.match(html, />YOU<\/em>/);
  assert.match(html, /is-bankrupt">BANKRUPT<\/em>/);
  assert.match(html, /#1 OF 3/);
  assert.match(html, /red">-\$20</);
  assert.match(html, /green">\+\$65</);
  assert.doesNotMatch(html, /\$-\d/);
  assert.match(html, /AUCTIONS<\/dt><dd[^>]*>3</);
  assert.match(html, /NO GLOBAL EVENTS THIS ROUND/);
});

check("openHistoryRowsSurviveRerender", () => {
  assert.match(render, /const openHistoryRows = new Map\(\)/);
  assert.match(render, /restoreOpenHistoryRows\(root\)/);
  assert.match(render, /export function setProfileHistoryExpanded/);
  assert.match(render, /export function selectProfileHistoryDetailTab/);
  assert.match(bindings, /setProfileHistoryExpanded\(toggle, expanded\)/);
  assert.match(bindings, /selectProfileHistoryDetailTab\(tab\)/);
});

const round = (n, cash, placement, extra = {}) => ({
  matchId: `m${n}`, completedAt: `2026-10-${String(10 + n).padStart(2, "0")}T12:00:00.000Z`, boardVariant: "standard-40", globalEvents: [],
  participants: [{ accountId: "self", displayNameAtMatch: "ME", finalPlacement: placement, endingCash: cash, propertyCount: 3, ...(extra.bankrupt ? { bankrupt: true } : {}) }, { accountId: "o", displayNameAtMatch: "O", finalPlacement: placement === 1 ? 2 : 1 }],
  ...extra.entry,
});
// newest first, like the profile list
const sample = [
  round(5, 900, 1), round(4, 1500, 1), round(3, 400, 2, { entry: { boardVariant: "metro-52" } }),
  round(2, 0, 4, { bankrupt: true, entry: { rulesetOverrides: [{ key: "startingCash", value: 2000 }] } }), round(1, 1100, 1),
];
const ownerRecordsFor = (list) => new Map(list.map((entry) => [entry.matchId, entry]));

check("summaryReportsRecordStreakPlacementAndCashTrendFromStoredRounds", () => {
  const summary = profileHistorySummary(sample, "self", ownerRecordsFor(sample));
  assert.equal(summary.rounds, 5);
  assert.equal(summary.wins, 3);
  assert.equal(summary.known, 5);
  assert.equal(summary.winRate, 60);
  assert.equal(summary.winStreak, 2);
  assert.equal(summary.averagePlacement, (1 + 1 + 2 + 4 + 1) / 5);
  assert.deepEqual(summary.cashTrend, [1100, 0, 400, 1500, 900], "oldest to newest");
  assert.equal(summary.bestCash, 1500);
  assert.equal(summary.bestIndex, 1, "the best-cash round is identified by its place in the newest-first list");
});

check("summaryNeverInventsNumbersForLegacyRows", () => {
  const legacy = [{ completedAt: "2026-10-01T00:00:00.000Z", result: "WIN" }, { matchId: "bare" }];
  const summary = profileHistorySummary(legacy, "self", new Map());
  assert.equal(summary.averagePlacement, null);
  assert.equal(summary.bestCash, null);
  assert.equal(summary.bestIndex, -1);
  assert.ok(summary.cashTrend.every((cash) => cash === null));
  assert.equal(profileHistorySummary([], "self").winRate, null);
});

check("filtersNarrowByResultBoardAndHouseRulesAndCombine", () => {
  const of = (filters) => filterProfileHistory(sample, "self", { result: "all", board: "all", houseRules: false, ...filters }).map((entry) => entry.matchId);
  assert.deepEqual(of({}), ["m5", "m4", "m3", "m2", "m1"]);
  assert.deepEqual(of({ result: "win" }), ["m5", "m4", "m1"]);
  assert.deepEqual(of({ result: "placed" }), ["m3"]);
  assert.deepEqual(of({ result: "bankrupt" }), ["m2"]);
  assert.deepEqual(of({ board: "metro-52" }), ["m3"]);
  assert.deepEqual(of({ houseRules: true }), ["m2"]);
  assert.deepEqual(of({ result: "win", houseRules: true }), []);
});

check("countLabelIsHonestAboutFilteringAndAboutRoundsThatAreNoLongerListed", () => {
  assert.equal(profileHistoryCountLabel({ shown: 4, saved: 4, total: 4, filtered: false }), "4 SAVED");
  assert.equal(profileHistoryCountLabel({ shown: 50, saved: 50, total: 120, filtered: false }), "50 OF 120 ROUNDS LISTED");
  assert.equal(profileHistoryCountLabel({ shown: 2, saved: 50, total: 120, filtered: true }), "SHOWING 2 OF 50");
});

check("panelRendersSummaryToolbarChipsAndTheOlderRoundsNote", () => {
  setProfileHistoryFilter("clear");
  const account = { id: "self", stats: { gamesPlayed: 9 }, matchHistory: sample };
  const html = historyPanelHTML(sample, account);
  assert.match(html, /class="profile-history-strip"/);
  assert.match(html, /ENDING CASH TREND/);
  assert.match(html, /<svg class="pc-spark/);
  assert.match(html, /5 OF 9 ROUNDS LISTED/);
  assert.match(html, /Older rounds still count toward your statistics/);
  assert.match(html, /role="group" aria-label="Filter completed rounds"/);
  assert.match(html, /aria-pressed="true" data-profile-history-filter="result:all"/);
  assert.match(html, /data-profile-history-filter="houseRules">HOUSE RULES · 1</);
  assert.match(html, /<select data-profile-history-filter="board">/);
  assert.match(html, /data-profile-history-bulk="expand"/);
  assert.equal((html.match(/is-best">BEST CASH</g) || []).length, 1);
  assert.match(html, /profile-history-chip">METRO-52</);
  assert.match(html, /profile-history-chip">HOUSE RULES</);
  assert.doesNotMatch(html, /profile-history-chip">STANDARD-40</, "a plain standard board adds no tag");
});

check("filteredPanelKeepsOriginalRoundNumbersAndOffersAWayBack", () => {
  setProfileHistoryFilter("result:win");
  const account = { id: "self", stats: { gamesPlayed: 5 }, matchHistory: sample };
  const wins = historyPanelHTML(sample, account);
  assert.match(wins, /SHOWING 3 OF 5/);
  assert.match(wins, /aria-pressed="true" data-profile-history-filter="result:win"/);
  assert.equal((wins.match(/data-profile-history-row=/g) || []).length, 3);
  assert.match(wins, /profile-history-index t-micro ink-3">01</, "the oldest round is still round 01, not renumbered by the filter");
  setProfileHistoryFilter("result:bankrupt");
  setProfileHistoryFilter("houseRules");
  assert.equal(setProfileHistoryFilter("houseRules"), true);
  setProfileHistoryFilter("result:win");
  setProfileHistoryFilter("houseRules");
  const none = historyPanelHTML(sample, account);
  assert.match(none, /NO ROUNDS MATCH THESE FILTERS/);
  assert.match(none, /data-profile-history-filter="clear"/);
  assert.doesNotMatch(none, /data-profile-history-bulk/, "no rows, so no expand/collapse");
  setProfileHistoryFilter("clear");
  assert.equal(setProfileHistoryFilter("nonsense"), false);
});

check("staleBoardFilterFallsBackToAllAndSummaryFieldsShowRules", () => {
  setProfileHistoryFilter("board:gone-99");
  const account = { id: "self", stats: { gamesPlayed: 5 }, matchHistory: sample };
  assert.match(historyPanelHTML(sample, account), /5 SAVED/);
  setProfileHistoryFilter("clear");
  const row = profileHistoryRowHTML(sample[3], 3, 5, { accountId: "self", ownerRecord: sample[3] });
  assert.match(row, /RULES<\/dt><dd[^>]*>1 HOUSE RULE</);
  const plain = profileHistoryRowHTML({ ...sample[0], rulesetOverrides: [] }, 0, 5, { accountId: "self", ownerRecord: { ...sample[0], rulesetOverrides: [] } });
  assert.match(plain, /RULES<\/dt><dd[^>]*>STANDARD RULES</);
});

check("historyBindingsWireFiltersBulkActionsAndArrowKeyRowNavigation", () => {
  assert.match(bindings, /setProfileHistoryFilter\(filter\.getAttribute\("data-profile-history-filter"\)\)/);
  assert.match(bindings, /setAllProfileHistoryRowsExpanded\(bulk\.getAttribute\("data-profile-history-bulk"\) === "expand"\)/);
  assert.match(bindings, /onProfileHistoryChange/);
  assert.match(bindings, /ArrowDown: toggles\[at \+ 1\], ArrowUp: toggles\[at - 1\], Home: toggles\[0\]/);
  assert.match(render, /restoreHistoryFocus\(root, focus\)/);
});

const worthRecord = {
  matchId: "worth-1", participants: [
    { accountId: "rival", displayNameAtMatch: "RIVAL", finalPlacement: 2, endingCash: 500 },
    { accountId: "self", displayNameAtMatch: "ME", finalPlacement: 1, endingCash: 1320 },
    { accountId: "third", displayNameAtMatch: "THIRD", finalPlacement: 3, endingCash: 100 },
  ],
  netWorthTimeline: [{ round: 1, worth: [1500, 1500, 1500] }, { round: 2, worth: [1400, 1700, 900] }, { round: 3, worth: [1200, null, 600] }],
};

check("netWorthChartPutsYouFirstAndKeepsEachSeatsColumn", () => {
  const spec = historyNetWorthChartSpec(worthRecord, "self");
  assert.equal(spec.kind, "line");
  assert.equal(spec.unit, "dollars");
  assert.deepEqual(spec.labels, ["R1", "R2", "R3"]);
  assert.deepEqual(spec.series.map((series) => series.name), ["ME (you)", "RIVAL", "THIRD"]);
  assert.deepEqual(spec.series[0].values, [1500, 1700, null], "worth is read from the seat's own column, not by sort order");
  assert.deepEqual(spec.series[1].values, [1500, 1400, 1200]);
});

check("netWorthChartRefusesToDrawWhatWasNeverRecorded", () => {
  assert.equal(historyNetWorthChartSpec({ participants: worthRecord.participants }, "self"), null);
  assert.equal(historyNetWorthChartSpec({ ...worthRecord, netWorthTimeline: [{ round: 1, worth: [1, 2, 3] }] }, "self"), null, "one point is not a trend");
  assert.equal(historyNetWorthChartSpec({ ...worthRecord, participants: [] }, "self"), null);
  assert.equal(historyNetWorthChartSpec(null, "self"), null);
});

check("worthTabShowsAChartHostFinalFiguresAndHonestEmptyStates", () => {
  const html = profileHistoryRowHTML(worthRecord, 0, 1, { accountId: "self", ownerRecord: worthRecord });
  assert.match(html, />NET WORTH</, "the tab exists");
  assert.match(html, /class="profile-history-chart" data-profile-history-chart="worth-1"/);
  assert.match(html, /FINAL NET WORTH · ME \(you\) -/, "a seat with no value at the end reads as a dash");
  assert.match(html, /RIVAL \$1[.,\s]?200/);
  assert.match(html, /NET WORTH = CASH \+ DEEDS \+ BUILDINGS − DEBTS/);
  const older = profileHistoryRowHTML({ matchId: "old", participants: worthRecord.participants }, 0, 1, { accountId: "self", ownerRecord: { matchId: "old", participants: worthRecord.participants } });
  assert.doesNotMatch(older, /profile-history-chart"/);
  assert.match(older, /profile-history-worth-empty">NOT RECORDED</);
  const publicOnly = profileHistoryRowHTML({ matchId: "pub", netWorthTimeline: worthRecord.netWorthTimeline }, 0, 1, { accountId: "self" });
  assert.doesNotMatch(publicOnly, /profile-history-chart"/, "without the owner's private record there is nothing to chart");
});

check("historyChartsAreMountedLazilyAndReleasedBeforeRerender", () => {
  assert.match(render, /function syncHistoryChart/);
  assert.match(render, /closest\("\[hidden\]"\)/);
  assert.match(render, /querySelectorAll\("\.profile-history-chart"\)\.forEach\(disposeChart\)/);
  assert.match(render, /syncHistoryChart\(toggle\.closest/);
});

const failures = checks.filter((checkResult) => !checkResult.ok);
for (const result of checks) {
  if (result.ok) console.log(`PASS - ${result.name}`);
  else console.error(`FAIL - ${result.name}: ${String(result.error.message).slice(0, 240)}`);
}
console.log(`profile surface contracts: ${checks.length - failures.length} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`${failures.length} profile surface contract(s) failed: ${failures.map((result) => result.name).join(", ")}`);
