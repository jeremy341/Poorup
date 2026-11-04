// PROFILE HISTORY AND STATISTICS: the statistics deck and the match history panel. Rendered into the profile page from
// clientProfileRender.js; it reads the same state and shares the same profile helpers.
import { $, esc } from "./clientDom.js";
import { PARLOR_PATROL_ENABLED } from "./clientParlorPatrolFlag.js";
import { state } from "./clientState.js";
import { hydrateSprites } from "./clientSprites.js";

import { formatHistoryDate, formatHistoryDateTime, formatHistoryMoney, formatSignedMoney } from "./clientHistoryFormat.js";
import { sparklineSVG } from "./clientChartRender.js";
import { mountChart, disposeChart, isChartMounted } from "./clientChartMount.js";

import { historyNetWorthChartSpec, ownerDetailsPanels, historyStat, ownerCashValue, ownerEndingCash, boardOf, hasHouseRules, historyChips } from "./clientProfileHistoryDetails.js";

export function formatStatDate(value) {
  if (!value) return "NOT RECORDED";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NOT RECORDED";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

export function cleanHistory(entries) {
  return entries.filter((entry) => entry && typeof entry === "object").slice(0, 50);
}

export function accountHistoryList(account) {
  const matchHistory = Array.isArray(account?.matchHistory) ? account.matchHistory : null;
  if (matchHistory && matchHistory.length) return cleanHistory(matchHistory);
  if (Array.isArray(account?.history)) return cleanHistory(account.history);
  return [];
}

export function ownParticipant(entry, accountId) {
  if (!Array.isArray(entry.participants)) return null;
  return entry.participants.find((item) => item.accountId === accountId) || null;
}

export function baseSummary(account) {
  const stats = account?.stats || {};
  const games = Math.max(0, Number(stats.gamesPlayed) || 0);
  const wins = Math.max(0, Math.min(games, Number(stats.wins) || 0));
  const bankruptcies = Math.max(0, Number(stats.bankruptcies) || 0);
  return {
    account,
    stats,
    games,
    wins,
    bankruptcies,
    winShare: games ? Math.round((wins / games) * 100) : 0,
  };
}

export function recordedOwnValue(entry, accountId, key, fallbackKey) {
  const participant = ownParticipant(entry, accountId);
  const value = participant?.[key] ?? (fallbackKey ? entry?.[fallbackKey] : entry?.[key]);
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

export function historyValues(history, accountId) {
  const cashValues = history.map((entry) => recordedOwnValue(entry, accountId, "endingCash")).filter((value) => value != null);
  const propertyValues = history.map((entry) => recordedOwnValue(entry, accountId, "propertyCount", "properties")).filter((value) => value != null);
  return {
    averageCash: cashValues.length ? Math.round(cashValues.reduce((sum, value) => sum + value, 0) / cashValues.length) : null,
    bestCash: cashValues.length ? Math.max(...cashValues) : null,
    bestProperties: propertyValues.length ? Math.max(...propertyValues) : null,
  };
}

export function statValue(stats, key, format = String) {
  if (!Object.prototype.hasOwnProperty.call(stats, key)) return "NOT RECORDED";
  if (stats[key] == null) return "NOT RECORDED";
  if (!Number.isFinite(Number(stats[key]))) return "NOT RECORDED";
  return format(Number(stats[key]));
}

export function statRecords(items) {
  return `<dl class="profile-stat-list">${items.map(([label, value]) => `<div class="profile-stat-record"><dt class="t-micro ink-3">${label}</dt><dd class="t-label f14 g100">${value}</dd></div>`).join("")}</dl>`;
}

export function categoricalOutcome(entry, accountId) {
  const participant = ownParticipant(entry, accountId);
  if (participant?.bankrupt === true) return "BANKRUPT";
  if (entry.bankrupt === true) return "BANKRUPT";
  const placementOutcomeValue = placementOutcome(participant, entry);
  if (placementOutcomeValue) return placementOutcomeValue;
  return fallbackOutcome(entry);
}

export function placementOutcome(participant, entry) {
  const placement = Number(participant?.finalPlacement ?? entry.finalPlacement);
  if (!Number.isInteger(placement) || placement <= 0) return "";
  if (placement === 1) return "WIN";
  return `PLACED #${placement}`;
}

export function fallbackOutcome(entry) {
  const result = String(entry.result || "").toUpperCase();
  if (result === "WIN") return "WIN";
  if (entry.won === true) return "WIN";
  if (result === "ROUND") return "ROUND COMPLETE";
  if (entry.won === false) return "ROUND COMPLETE";
  return "NOT RECORDED";
}

export function recentResultsHTML(ctx) {
  if (!ctx.chronological.length) {
    const message = ctx.account ? "NO COMPLETED ROUNDS YET" : "ACCOUNT HISTORY UNAVAILABLE";
    return `<p class="profile-results-empty t-body ink-2">${message}</p>`;
  }
  const rows = ctx.chronological.map((entry) => {
    const outcome = categoricalOutcome(entry, ctx.accountId);
    const tone = outcome === "WIN" ? "green" : outcome === "BANKRUPT" ? "red" : "g100";
    return `<li class="profile-result-row"><span class="t-micro ink-3">${formatStatDate(entry.completedAt || entry.playedAt)}</span><strong class="t-label f12 ${tone}">${outcome}</strong></li>`;
  }).join("");
  return `<ol class="profile-recent-results" aria-label="Recent completed match outcomes">${rows}</ol>`;
}

export function profilePersonalRecordsHTML(ctx) {
  const values = [
    ["AVG ENDING CASH", ctx.averageCash == null ? "NOT RECORDED" : `$${ctx.averageCash.toLocaleString()}`],
    ["BEST CASH STACK", ctx.bestCash == null ? "NOT RECORDED" : `$${ctx.bestCash.toLocaleString()}`],
    ["MOST PROPERTIES", ctx.bestProperties == null ? "NOT RECORDED" : String(ctx.bestProperties)],
    ["DATA WINDOW", ctx.account ? (ctx.historyLength ? `${ctx.historyLength} ROUNDS` : "NO ROUNDS") : "ACCOUNT ONLY"],
  ];
  return `<section class="profile-personal-records" aria-label="Personal records">${values.map(([label, value]) => `<div class="profile-personal-record"><span class="t-micro ink-3">${label}</span><strong class="t-label f12 g100">${value}</strong></div>`).join("")}</section>`;
}

const ECONOMY_STAT_FIELDS = [
  ["CASINO NET", "casinoNet", (value) => `$${value.toLocaleString()}`],
  ["MARKET P/L", "marketProfit", (value) => `$${value.toLocaleString()}`],

  ["BANK LOANS REPAID", "bankLoanRepayments"],
];

const ACTIVITY_STAT_FIELDS = [
  ["EVENT SURVIVAL", "eventSurvival"],
  ["AUCTION WINS", "auctionWins"],
  ["LOANS GIVEN", "playerLoansGiven"],
  ["EQUITY DEALS", "equityDeals"],
];

export function profileStatValue(ctx, key, format) {
  if (!ctx.account) return "NOT RECORDED";
  return statValue(ctx.stats, key, format);
}

export function statisticsGroupHTML(ctx, fields) {
  const items = fields.map(([label, key, format]) => [label, profileStatValue(ctx, key, format)]);
  return statRecords(items);
}

export function statisticsTabsHTML(ctx) {
  const patrolFields = PARLOR_PATROL_ENABLED ? [
    ["PATROL VERIFIED BEST", "patrolVerifiedBest"],
    ...(Number(ctx.stats?.patrolBest) > 0 ? [["PATROL LEGACY BEST", "patrolBest"]] : []),
    ["PATROL VERIFIED ACE RUNS", "patrolVerifiedAceRuns"],
    ...(Number(ctx.stats?.patrolAceRuns) > 0 ? [["PATROL LEGACY ACE RUNS", "patrolAceRuns"]] : []),
  ] : [];
  const values = statisticsGroupHTML(ctx, [...ECONOMY_STAT_FIELDS, ...patrolFields]);
  const activity = statisticsGroupHTML(ctx, ACTIVITY_STAT_FIELDS);
  const tabs = [["results", "RESULTS"], ["economy", "ECONOMY"], ["deals-events", "DEALS &amp; EVENTS"]];
  const buttons = tabs.map(([tab, label], index) => `<button class="profile-stat-tab${index === 0 ? " is-active" : ""}" type="button" role="tab" id="profile-stat-tab-${tab}" aria-selected="${index === 0}" aria-controls="profile-stat-panel-${tab}" tabindex="${index === 0 ? "0" : "-1"}" data-profile-stat-tab="${tab}">${label}</button>`).join("");
  return `<div class="profile-stat-tabs" role="tablist" aria-label="Statistics categories">${buttons}</div>
    <section class="profile-stat-tab-panel" role="tabpanel" id="profile-stat-panel-results" aria-labelledby="profile-stat-tab-results" tabindex="0">${recentResultsHTML(ctx)}${profilePersonalRecordsHTML(ctx)}</section>
    <section class="profile-stat-tab-panel" role="tabpanel" id="profile-stat-panel-economy" aria-labelledby="profile-stat-tab-economy" tabindex="0" hidden>${values}</section>
    <section class="profile-stat-tab-panel" role="tabpanel" id="profile-stat-panel-deals-events" aria-labelledby="profile-stat-tab-deals-events" tabindex="0" hidden>${activity}</section>`;
}

export function profileStatisticsHTML(ctx) {
  const account = ctx.account;
  const values = [
    ["ROUNDS", account ? String(ctx.games) : "-", "g100"],
    ["WINS", account ? String(ctx.wins) : "-", "green"],
    ["WIN RATE", account ? `${ctx.winShare}%` : "-", "g300"],
    ["BANKRUPTCIES", account ? String(ctx.bankruptcies) : "-", "g-muted"],
  ];
  return `<section class="profile-stats-overview panel noise" aria-label="Statistics overview"><div><span class="t-micro g400">PERFORMANCE</span><h2 class="t-section g100">Statistics</h2></div><div class="profile-stats-headline">${values.map(([label, value, tone]) => `<div class="profile-stats-kpi"><span class="t-micro ink-3">${label}</span><strong class="t-label f18 ${tone}">${value}</strong></div>`).join("")}</div></section>
    <div class="profile-stats-categories">${statisticsTabsHTML(ctx)}</div>`;
}

export function renderProfileStatistics() {
  const root = $("#profile-statistics-content");
  if (!root) return;
  const account = state.account?.account || null;
  const base = baseSummary(account);
  const history = accountHistoryList(account);
  const values = historyValues(history, account?.id);
  const ctx = {
    ...base,
    ...values,
    accountId: account?.id,
    historyLength: history.length,
    chronological: [...history].reverse().slice(-12),
  };
  root.innerHTML = profileStatisticsHTML(ctx);
  hydrateSprites(root);
}

export function listSize(list, fallback) {
  if (Array.isArray(list)) return list.length;
  return fallback;
}

export function deedCount(participant, entry) {
  if (participant?.propertyCount != null) return participant.propertyCount;
  if (entry.properties != null) return entry.properties;
  return null;
}

export function profileHistoryToggleAccessibleName(currentName, expanded) {
  const name = String(currentName || "");
  const action = expanded ? "Hide details" : "Show details";
  return /^(Show|Hide) details/.test(name)
    ? name.replace(/^(Show|Hide) details/, action)
    : `${action} for match`;
}

export function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

export function recordedText(recordValue, key, format = (value) => String(value)) {
  if (!recordValue || !Object.prototype.hasOwnProperty.call(recordValue, key) || recordValue[key] == null) return "NOT RECORDED";
  return format(recordValue[key]);
}

export function detailField(label, value, tone = "g100") {
  return `<div class="profile-history-detail-field"><dt class="t-micro ink-3">${label}</dt><dd class="t-label f12 ${tone}">${value}</dd></div>`;
}

export function ownParticipantResult(recordValue, accountId) {
  return ownParticipant(recordValue || {}, accountId);
}

export function matchResult(recordValue, accountId) {
  if (!recordValue) return "NOT RECORDED";
  return categoricalOutcome(recordValue, accountId);
}

export function formatDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  if (!seconds) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function resultTone(result) {
  if (result === "WIN") return "green";
  if (result === "BANKRUPT") return "red";
  return "g100";
}

export function placementLabel(recordValue, participant) {
  const placement = participant?.finalPlacement ?? recordValue?.finalPlacement;
  if (placement == null) return "NOT RECORDED";
  const field = Array.isArray(recordValue?.participants) && recordValue.participants.length ? ` OF ${recordValue.participants.length}` : "";
  return `#${esc(placement)}${field}`;
}

export function rulesLabel(recordValue) {
  const overrides = recordValue?.rulesetOverrides;
  if (!Array.isArray(overrides)) return "NOT RECORDED";
  return overrides.length ? `${overrides.length} HOUSE RULE${overrides.length === 1 ? "" : "S"}` : "STANDARD RULES";
}

export function historySummaryFields(recordValue, participant, result) {
  const board = recordValue?.boardVariant;
  return [
    detailField("RESULT", esc(result), resultTone(result)),
    detailField("PLACEMENT", placementLabel(recordValue, participant)),
    detailField("COMPLETED", esc(formatHistoryDateTime(recordValue?.completedAt))),
    detailField("DURATION", esc(recordedText(recordValue, "durationSeconds", formatDuration))),
    detailField("ROUNDS", esc(recordedText(recordValue, "roundCount"))),
    detailField("BOARD", board == null ? "NOT RECORDED" : esc(String(board).toUpperCase())),
    detailField("RULES", esc(rulesLabel(recordValue)), hasHouseRules(recordValue) ? "g300" : "g100"),
    detailField("MATCH", esc(recordedText(recordValue, "matchId")), "g-muted"),
  ].join("");
}

export function placementRank(player) {
  const placement = Number(player?.finalPlacement);
  return Number.isInteger(placement) && placement > 0 ? placement : Infinity;
}

export function byPlacement(a, b) {
  const left = placementRank(a);
  const right = placementRank(b);
  return left === right ? 0 : left - right;
}

export function historyPlayerTags(player, you) {
  const youTag = you ? '<em class="profile-history-tag is-you">YOU</em>' : "";
  const bankruptTag = player.bankrupt === true ? '<em class="profile-history-tag is-bankrupt">BANKRUPT</em>' : "";
  return youTag + bankruptTag;
}

export function historyPlayerRow(player, accountId) {
  const you = accountId != null && player.accountId === accountId;
  const rank = player.finalPlacement == null ? "NOT RECORDED" : `#${esc(player.finalPlacement)}`;
  const cash = player.endingCash == null ? "-" : esc(formatHistoryMoney(player.endingCash, "-"));
  const deeds = player.propertyCount == null ? "-" : `${esc(player.propertyCount)} ${Number(player.propertyCount) === 1 ? "DEED" : "DEEDS"}`;
  return `<li class="profile-history-player${you ? " is-you" : ""}"><strong class="profile-history-player-rank t-label f12">${rank}</strong><span class="profile-history-player-name t-label f12">${esc(player.displayNameAtMatch || "PLAYER")}${historyPlayerTags(player, you)}</span><span class="profile-history-player-cash t-label f12">${cash}</span><span class="profile-history-player-deeds t-micro ink-3">${deeds}</span></li>`;
}

export function historyPlayerRows(recordValue, accountId) {
  const participants = recordValue?.participants;
  if (!Array.isArray(participants) || !participants.length) return "<li>NOT RECORDED</li>";
  return [...participants].sort(byPlacement).map((player) => historyPlayerRow(player, accountId)).join("");
}

export function netField(label, list, accountId) {
  const entry = (Array.isArray(list) ? list : []).find((item) => item?.accountId === accountId);
  const net = Number(entry?.net);
  if (!entry || entry.net == null || !Number.isFinite(net)) return detailField(label, "NOT RECORDED");
  return detailField(label, esc(formatSignedMoney(net)), net > 0 ? "green" : net < 0 ? "red" : "g100");
}

export function historyEconomyFields(recordValue, participant, accountId) {
  return [
    detailField("ENDING CASH", esc(recordedText(participant, "endingCash", (value) => formatHistoryMoney(value)))),
    detailField("PROPERTIES", historyPropertyCount(participant)),
    detailField("ITEMS HELD", esc(recordedText(participant, "itemsHeld"))),
    detailField("REBATE EARNED", esc(recordedText(participant, "matchRebate", (value) => formatHistoryMoney(value)))),
    detailField("BEST TRADE", esc(recordedText(participant, "bestTradeNet", (value) => formatHistoryMoney(value)))),
    netField("CASINO NET", recordValue?.casino, accountId),
    netField("MARKET NET", recordValue?.market, accountId),
    detailField("TRADES", esc(recordedText(recordValue, "tradesCompleted"))),
    detailField("AUCTIONS", esc(recordedText(recordValue, "auctionsCompleted"))),
    detailField("CONTRACTS", esc(recordedText(recordValue, "playerContracts", (items) => Array.isArray(items) ? String(items.length) : "NOT RECORDED"))),
  ].join("");
}

export function historyPropertyCount(participant) {
  const propertyCount = participant?.propertyCount ?? participant?.properties;
  if (propertyCount == null) return "NOT RECORDED";
  return esc(propertyCount);
}

export function historyEventList(recordValue) {
  const events = recordValue?.globalEvents;
  if (!Array.isArray(events)) return "<p>NOT RECORDED</p>";
  if (!events.length) return "<p>NO GLOBAL EVENTS THIS ROUND</p>";
  return `<ul>${events.map((event) => `<li>${esc(historyEventName(event))}</li>`).join("")}</ul>`;
}

export function historyEventName(event) {
  if (typeof event === "string") return event;
  if (event?.name) return event.name;
  if (event?.title) return event.title;
  return "EVENT";
}

export function netWorthRoundLabel(row) {
  return `R${Math.max(0, Math.floor(Number(row?.round) || 0))}`;
}

export function netWorthSeatSeries(participant, index, accountId, rows) {
  const isYou = participant?.accountId === accountId;
  return {
    id: participant?.accountId || `seat-${index}`,
    name: `${participant?.displayNameAtMatch || "PLAYER"}${isYou ? " (you)" : ""}`,
    values: rows.map((row) => (Array.isArray(row?.worth) ? row.worth[index] : null)),
  };
}

/** Net worth per round as a multi-line chart spec: you first (solid, primary), then the other seats. */
export function profileHistoryRowHTML(entry, index, total, context = {}) {
  const { accountId, ownerRecord = null, best = false } = context;
  const matchId = typeof entry.matchId === "string" ? entry.matchId : "";
  const date = formatHistoryDate(entry.completedAt || entry.playedAt);
  const outcome = matchResult(entry, accountId);
  const won = outcome === "WIN";
  const bankrupt = outcome === "BANKRUPT";
  const deeds = deedCount(ownParticipant(entry, accountId), entry);
  const lead = String(total - index).padStart(2, "0");
  const detailId = `profile-history-details-${safeId(matchId)}`;
  const stats = [
    historyStat("PLAYERS", listSize(entry.participants, null)),
    historyStat("DEEDS", deeds),
    historyStat("ENDING CASH", ownerEndingCash(ownerRecord, accountId)),
    historyStat("EVENTS", listSize(entry.globalEvents, null)),
  ].join("");
  const rowContent = `<span class="profile-history-index t-micro ink-3">${lead}</span><span class="profile-history-main"><strong class="t-label f12 ${resultTone(outcome)}">${esc(outcome)}</strong><span class="profile-history-subline"><span class="t-micro ink-3">${esc(date)}</span>${historyChips(entry, best)}</span></span><span class="profile-history-meta">${stats}</span>`;
  const summary = matchId
    ? `<button type="button" class="profile-history-toggle" aria-label="Show details for ${esc(date)}: ${esc(outcome)}" aria-expanded="false" aria-controls="${detailId}" data-profile-history-toggle="${esc(matchId)}">${rowContent}<span class="profile-history-toggle-label t-micro g400" aria-hidden="true">DETAILS +</span></button>`
    : `<div class="profile-history-summary">${rowContent}<span class="profile-history-toggle-label is-static t-micro ink-3">DETAILS NOT RECORDED</span></div>`;
  return `<article class="profile-history-row${won ? " is-win" : ""}${bankrupt ? " is-bankrupt" : ""}" data-profile-history-row="${esc(matchId)}">${summary}${matchId ? ownerDetailsPanels(ownerRecord, accountId, detailId) : ""}</article>`;
}

/* Which rows are open (and on which detail tab) outlives a re-render, so a sound
   toggle or an account sync never folds the round the player is reading. */
const openHistoryRows = new Map();

/** Charts exist only while their tab is showing: hidden panels have no width, and each mount owns an observer. */
export function syncHistoryChart(row) {
  const host = row?.querySelector(".profile-history-chart");
  if (!host) return;
  if (host.closest("[hidden]")) {
    disposeChart(host);
    return;
  }
  if (isChartMounted(host)) return;
  const account = state.account?.account;
  const record = (Array.isArray(account?.matchHistory) ? account.matchHistory : []).find((entry) => entry?.matchId === host.dataset.profileHistoryChart);
  const spec = historyNetWorthChartSpec(record, account?.id);
  if (spec) mountChart(host, spec, { label: spec.title });
}

export function setProfileHistoryExpanded(toggle, expanded) {
  const details = document.getElementById(toggle.getAttribute("aria-controls"));
  if (!details) return false;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-label", profileHistoryToggleAccessibleName(toggle.getAttribute("aria-label"), expanded));
  toggle.querySelector("[aria-hidden='true']")?.replaceChildren(document.createTextNode(expanded ? "DETAILS −" : "DETAILS +"));
  details.hidden = !expanded;
  const matchId = toggle.dataset.profileHistoryToggle;
  if (!expanded) openHistoryRows.delete(matchId);
  else if (!openHistoryRows.has(matchId)) openHistoryRows.set(matchId, "summary");
  syncHistoryChart(toggle.closest("[data-profile-history-row]"));
  return true;
}

export function selectProfileHistoryDetailTab(tab) {
  const details = tab.closest(".profile-history-details");
  if (!details) return;
  const selected = tab.getAttribute("aria-controls");
  details.querySelectorAll("[data-profile-history-detail-tab]").forEach((button) => {
    const active = button === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  details.querySelectorAll("[role='tabpanel']").forEach((panel) => {
    panel.hidden = panel.id !== selected;
  });
  const row = tab.closest("[data-profile-history-row]");
  if (row) openHistoryRows.set(row.dataset.profileHistoryRow, tab.dataset.profileHistoryDetailTab);
  syncHistoryChart(row);
}

export function restoreOpenHistoryRows(root) {
  const rows = [...root.querySelectorAll("[data-profile-history-row]")];
  for (const [matchId, tabKey] of [...openHistoryRows]) {
    const row = rows.find((candidate) => candidate.dataset.profileHistoryRow === matchId);
    const toggle = row?.querySelector("[data-profile-history-toggle]");
    if (!toggle || !setProfileHistoryExpanded(toggle, true)) {
      openHistoryRows.delete(matchId);
      continue;
    }
    const tab = [...row.querySelectorAll("[data-profile-history-detail-tab]")].find((button) => button.dataset.profileHistoryDetailTab === tabKey);
    if (tab) selectProfileHistoryDetailTab(tab);
  }
}

export function emptyHistoryPanelHTML(account) {
  const message = account
    ? "NO COMPLETED ROUNDS YET. YOUR FIRST FINISH WILL APPEAR HERE."
    : "SIGN IN TO KEEP A SERVER-SYNCED ROUND HISTORY.";
  return `<section class="panel noise pad16 profile-empty-panel"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2></div><p class="t-body ink-2">${message}</p><p class="t-micro ink-3">Only completed server rounds appear here. Guest play remains available without an account.</p></section>`;
}

/* ---------- summary strip, filters, count ---------- */

export function placementNumber(entry, accountId) {
  const placement = Number(ownParticipant(entry, accountId)?.finalPlacement ?? entry.finalPlacement);
  return Number.isInteger(placement) && placement > 0 ? placement : null;
}

/** Record-level numbers for the strip above the list. `cashTrend` runs oldest to newest. */
export function profileHistorySummary(history, accountId, ownerRecords = new Map()) {
  const outcomes = history.map((entry) => matchResult(entry, accountId));
  const known = outcomes.filter((outcome) => outcome === "WIN" || outcome === "BANKRUPT" || outcome.startsWith("PLACED #"));
  const wins = outcomes.filter((outcome) => outcome === "WIN").length;
  const placements = history.map((entry) => placementNumber(entry, accountId)).filter((placement) => placement !== null);
  let winStreak = 0;
  for (const outcome of outcomes) {
    if (outcome !== "WIN") break;
    winStreak += 1;
  }
  const cashes = history.map((entry) => ownerCashValue(ownerRecords.get(entry.matchId) || null, accountId));
  const present = cashes.filter((cash) => cash !== null);
  const bestCash = present.length ? Math.max(...present) : null;
  return {
    rounds: history.length,
    wins,
    known: known.length,
    winRate: known.length ? Math.round((wins / known.length) * 100) : null,
    averagePlacement: placements.length ? placements.reduce((sum, placement) => sum + placement, 0) / placements.length : null,
    winStreak,
    cashTrend: [...cashes].reverse(),
    bestCash,
    bestIndex: bestCash === null ? -1 : cashes.indexOf(bestCash),
  };
}

export function summaryStripHTML(summary) {
  const cells = [
    ["ROUNDS", String(summary.rounds), "g100"],
    ["WINS", summary.known ? `${summary.wins} · ${summary.winRate}%` : "-", summary.wins ? "green" : "g100"],
    ["AVG PLACE", summary.averagePlacement === null ? "-" : `#${summary.averagePlacement.toFixed(1)}`, "g100"],
    ["WIN STREAK", summary.winStreak ? String(summary.winStreak) : "-", summary.winStreak ? "green" : "g100"],
    ["BEST CASH", summary.bestCash === null ? "-" : formatHistoryMoney(summary.bestCash), "g100"],
  ];
  const points = summary.cashTrend.filter((cash) => cash !== null).length;
  const trend = points >= 2
    ? `<div class="profile-history-trend"><span class="t-micro ink-3">ENDING CASH TREND</span>${sparklineSVG(summary.cashTrend, { width: 168, height: 28, label: `Ending cash across your last ${points} recorded rounds, oldest to newest` })}</div>`
    : "";
  return `<div class="profile-history-strip" role="group" aria-label="Round history summary">${cells.map(([label, value, tone]) => `<div class="profile-history-strip-cell"><span class="t-micro ink-3">${label}</span><strong class="t-label f14 ${tone}">${value}</strong></div>`).join("")}${trend}</div>`;
}

const RESULT_FILTERS = [["all", "ALL"], ["win", "WINS"], ["placed", "PLACED"], ["bankrupt", "BANKRUPT"]];
const historyFilters = { result: "all", board: "all", houseRules: false };

export function resultKind(outcome) {
  if (outcome === "WIN") return "win";
  if (outcome === "BANKRUPT") return "bankrupt";
  return outcome.startsWith("PLACED #") ? "placed" : "other";
}

export function filterProfileHistory(history, accountId, filters = historyFilters) {
  return history.filter((entry) => {
    if (filters.result !== "all" && resultKind(matchResult(entry, accountId)) !== filters.result) return false;
    if (filters.board !== "all" && boardOf(entry) !== filters.board) return false;
    return !filters.houseRules || hasHouseRules(entry);
  });
}

export function profileHistoryCountLabel({ shown, saved, total, filtered }) {
  if (filtered) return `SHOWING ${shown} OF ${saved}`;
  return total > saved ? `${saved} OF ${total} ROUNDS LISTED` : `${saved} SAVED`;
}

export function historyToolbarHTML(history, hasRows) {
  const boards = [...new Set(history.map(boardOf).filter(Boolean))];
  const houseRuleRounds = history.filter(hasHouseRules).length;
  const pressed = (key) => String(historyFilters.result === key);
  const results = RESULT_FILTERS.map(([key, label]) => `<button type="button" class="profile-history-filter${historyFilters.result === key ? " is-active" : ""}" aria-pressed="${pressed(key)}" data-profile-history-filter="result:${key}">${label}</button>`).join("");
  const board = boards.length > 1
    ? `<label class="profile-history-select"><span class="t-micro ink-3">BOARD</span><select data-profile-history-filter="board"><option value="all">ALL BOARDS</option>${boards.map((value) => `<option value="${esc(value)}"${historyFilters.board === value ? " selected" : ""}>${esc(value.toUpperCase())}</option>`).join("")}</select></label>`
    : "";
  const rules = houseRuleRounds
    ? `<button type="button" class="profile-history-filter${historyFilters.houseRules ? " is-active" : ""}" aria-pressed="${historyFilters.houseRules}" data-profile-history-filter="houseRules">HOUSE RULES · ${houseRuleRounds}</button>`
    : "";
  const bulk = hasRows
    ? '<div class="profile-history-bulk"><button type="button" class="profile-history-filter" data-profile-history-bulk="expand">EXPAND ALL</button><button type="button" class="profile-history-filter" data-profile-history-bulk="collapse">COLLAPSE ALL</button></div>'
    : "";
  return `<div class="profile-history-toolbar"><div class="profile-history-filters" role="group" aria-label="Filter completed rounds">${results}${board}${rules}</div>${bulk}</div>`;
}

export function historyPanelHTML(history, account) {
  const accountId = account.id;
  const ownerRecords = new Map((Array.isArray(account.matchHistory) ? account.matchHistory : []).filter((entry) => typeof entry?.matchId === "string").map((entry) => [entry.matchId, entry]));
  if (historyFilters.board !== "all" && !history.some((entry) => boardOf(entry) === historyFilters.board)) historyFilters.board = "all";
  const summary = profileHistorySummary(history, accountId, ownerRecords);
  const shown = filterProfileHistory(history, accountId);
  const filtered = shown.length !== history.length;
  const total = Math.max(history.length, Math.floor(Number(account.stats?.gamesPlayed) || 0));
  const rows = shown.map((entry) => {
    const index = history.indexOf(entry);
    return profileHistoryRowHTML(entry, index, history.length, { accountId, ownerRecord: ownerRecords.get(entry.matchId) || null, best: index === summary.bestIndex });
  }).join("");
  const list = shown.length
    ? `<div class="profile-history-list">${rows}</div>`
    : '<div class="profile-history-empty" role="status"><p class="t-body ink-2">NO ROUNDS MATCH THESE FILTERS.</p><button type="button" class="btn-dark" data-profile-history-filter="clear"><span class="t-label f11">CLEAR FILTERS</span></button></div>';
  const count = profileHistoryCountLabel({ shown: shown.length, saved: history.length, total, filtered });
  const older = total > history.length ? " Older rounds still count toward your statistics but are no longer listed." : "";
  return `<section class="panel noise pad16"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2><span class="t-micro ink-3" role="status" aria-live="polite">${count}</span></div>${summaryStripHTML(summary)}${historyToolbarHTML(history, shown.length > 0)}${list}<p class="t-micro ink-3 profile-history-note">History is recorded when a server round finishes. Detailed participants, events, and economy results stay inside your private account record.${older}</p></section>`;
}

/** Filters live outside the markup so they survive every re-render, like the open rows. */
export function setProfileHistoryFilter(spec) {
  const text = String(spec);
  const split = text.indexOf(":");
  const key = split === -1 ? text : text.slice(0, split);
  const value = split === -1 ? "" : text.slice(split + 1);
  if (key === "result" && RESULT_FILTERS.some(([name]) => name === value)) historyFilters.result = value;
  else if (key === "board") historyFilters.board = value || "all";
  else if (key === "houseRules") historyFilters.houseRules = !historyFilters.houseRules;
  else if (key === "clear") Object.assign(historyFilters, { result: "all", board: "all", houseRules: false });
  else return false;
  renderProfileHistory();
  return true;
}

export function setAllProfileHistoryRowsExpanded(expanded) {
  $("#profile-history-content")?.querySelectorAll("[data-profile-history-toggle]").forEach((toggle) => {
    if ((toggle.getAttribute("aria-expanded") === "true") !== expanded) setProfileHistoryExpanded(toggle, expanded);
  });
}

const FOCUS_ATTRIBUTES = ["data-profile-history-filter", "data-profile-history-bulk", "data-profile-history-toggle"];

export function historyFocusTarget(root) {
  const active = globalThis.document?.activeElement;
  if (!active || !root.contains(active)) return null;
  for (const attribute of FOCUS_ATTRIBUTES) {
    const value = active.getAttribute?.(attribute);
    if (value !== null && value !== undefined) return { attribute, value };
  }
  return null;
}

export function restoreHistoryFocus(root, target) {
  if (!target) return;
  [...root.querySelectorAll(`[${target.attribute}]`)].find((candidate) => candidate.getAttribute(target.attribute) === target.value)?.focus({ preventScroll: true });
}

export function subjectMatchRowHTML(match) {
  const placement = match.placement === 1 ? "WIN" : match.placement ? `PLACE ${esc(match.placement)}` : "MATCH";
  const tone = match.placement === 1 ? "green" : "g100";
  return `<div class="player-profile-match"><span class="t-micro ink-3">${esc(String(match.completedAt || "UNDATED").slice(0, 10))}</span><strong class="t-label f11 ${tone}">${placement}</strong><span class="t-micro ink-3">${esc(match.players)} PLAYERS · ${esc(match.events)} EVENTS</span></div>`;
}

export function renderProfileHistory() {
  const root = $("#profile-history-content");
  if (!root) return;
  if (state.profileSubject) {
    const matches = state.profileSubject.matches;
    root.innerHTML = matches.length ? matches.map(subjectMatchRowHTML).join("") : `<p class="t-body ink-3 social-empty">NO MATCHES YET.</p>`;
    return;
  }
  const account = state.account?.account || null;
  const history = accountHistoryList(account);
  if (!account || !history.length) {
    openHistoryRows.clear();
    root.querySelectorAll(".profile-history-chart").forEach(disposeChart);
    root.innerHTML = emptyHistoryPanelHTML(account);
    hydrateSprites(root);
    return;
  }
  const focus = historyFocusTarget(root);
  root.querySelectorAll(".profile-history-chart").forEach(disposeChart);
  root.innerHTML = historyPanelHTML(history, account);
  restoreOpenHistoryRows(root);
  hydrateSprites(root);
  restoreHistoryFocus(root, focus);
}

