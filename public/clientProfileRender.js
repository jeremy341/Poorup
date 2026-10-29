// PROFILE SURFACES: identity display, profile summary, statistics deck, history rows, library
// tiles, face editor canvas renderers and the guest-alias field. Socket-backed saves and view
// switching stay in the entry module. The achievements renderer is a host callback.
import { $, esc } from "./clientDom.js";
import { state, getProfileById, getAppearanceMeta } from "./clientState.js";
import { spriteFromGrid, avatarHTML, hydrateSprites } from "./clientSprites.js";
import { CONNECTION_COPY } from "./clientTopNavRender.js";
import { MAX_PROFILES, profileDesignName } from "./clientSanitize.js";
import { renderAccountRights } from "./clientAccountRights.js";
import { PARLOR_PATROL_ENABLED } from "./clientParlorPatrolFlag.js";
import { formatHistoryDate, formatHistoryDateTime, formatHistoryMoney, formatSignedMoney } from "./clientHistoryFormat.js";
import { sparklineSVG } from "./clientChartRender.js";
import { mountChart, disposeChart, isChartMounted } from "./clientChartMount.js";

const PROFILE_SWATCHES = ["#d74438", "#286ea1", "#d9a62f", "#35a653", "#a04e6f", "#3e7d7b", "#7b5029", "#cfa75f"];
const FACE_PALETTE = ["#f0d9ac", "#e8d3ab", "#cfa75f", "#c88f2e", "#9b783d", "#5c5033", "#01070a", "#ffffff", "#d74438", "#35a653", "#286ea1", "#d9a62f"];

function noop() {}
function noopNull() { return null; }

let host = { renderAchievements: noop, loadSavedGame: noopNull, renderHomeSignals: noop };

export function configureProfileRender(hooks) {
  host = { ...host, ...hooks };
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

function setHTML(sel, value) {
  const el = $(sel);
  if (el) el.innerHTML = value;
}

function replaceText(sel, value) {
  $(sel)?.replaceChildren(document.createTextNode(value));
}

export function accountRate(stats = {}) {
  const games = Number(stats.gamesPlayed) || 0;
  return games ? `${Math.round(((Number(stats.wins) || 0) / games) * 100)}%` : "0%";
}

function sourceName(account) {
  if (account?.displayName) return account.displayName;
  return state.alias || "PLAYER";
}

export function selectedProfile() {
  if (typeof state.appearance !== "string") return null;
  return getProfileById(state.appearance) || null;
}

function sourceColor(draft, profile, account, activeMeta) {
  if (draft?.color) return draft.color;
  if (profile?.color) return profile.color;
  if (account?.color) return account.color;
  if (activeMeta.color) return activeMeta.color;
  return "#d74438";
}

function sourceGrid(draft, profile, account) {
  if (draft?.grid) return draft.grid;
  if (profile?.avatarGrid) return profile.avatarGrid;
  return account?.avatarGrid || null;
}

export function profileDisplaySource() {
  const account = state.account?.account || null;
  const draft = state.profileDraft || null;
  const profile = draft || selectedProfile();
  const activeMeta = getAppearanceMeta(state.appearance);
  const name = sourceName(account);
  const color = sourceColor(draft, profile, account, activeMeta);
  const grid = sourceGrid(draft, profile, account);
  const designName = profile ? profileDesignName(profile) : activeMeta.label;
  return { account, profile, name, color, grid, designName };
}

function heroAvatarMarkup(grid, color, size) {
  if (grid) return spriteFromGrid(grid, size);
  return avatarHTML({ color }, size, 0);
}

function renderProfileHero(source, displayName) {
  const { account, grid, color } = source;
  setHTML("#profile-hero-avatar", heroAvatarMarkup(grid, color, 6));
  setHTML("#profile-overview-avatar", heroAvatarMarkup(grid, color, 5));
  replaceText("#profile-hero-name", displayName);
  replaceText("#profile-overview-name", displayName);
  // The hero names the player; the subtitle also carries the design name, so a just-saved design is visible here.
  const designLabel = source.designName ? String(source.designName).toUpperCase() : "";
  const base = account ? `@${account.username}` : "GUEST MODE";
  setText("#profile-hero-handle", designLabel ? `${base} · ${designLabel}` : base);
  const stateLabel = $("#profile-hero-state");
  if (stateLabel) {
    stateLabel.textContent = account
      ? "ACCOUNT PLAYER · STATS SYNCED AFTER COMPLETED ROUNDS"
      : "LOCAL PLAYER · READY FOR THE NEXT TABLE";
    stateLabel.classList.toggle("is-account", Boolean(account));
  }
  const heroAction = $("#profile-hero-account-btn");
  if (heroAction) {
    heroAction.querySelector(".t-label").textContent = account ? "EDIT ACCOUNT" : "CREATE ACCOUNT";
  }
}

function profileStatCells(account) {
  const accountStats = account?.stats || {};
  return {
    games: Number(accountStats.gamesPlayed) || 0,
    wins: Number(accountStats.wins) || 0,
    rate: accountRate(accountStats),
    bankruptcies: Number(accountStats.bankruptcies) || 0,
  };
}

function joinedLabel(account) {
  if (!account?.createdAt) return "GUEST";
  const opts = { month: "short", year: "numeric" };
  return new Date(account.createdAt).toLocaleDateString(undefined, opts).toUpperCase();
}

function renderProfileStats(source) {
  const account = source.account;
  const stats = profileStatCells(account);
  replaceText("#profile-stat-games", String(stats.games));
  replaceText("#profile-stat-wins", String(stats.wins));
  replaceText("#profile-stat-rate", stats.rate);
  replaceText("#profile-stat-bankruptcies", String(stats.bankruptcies));
  setText("#profile-stat-joined", joinedLabel(account));
}

function overviewStatusText() {
  if (state.connectionStatus === "online") return "READY";
  return (CONNECTION_COPY[state.connectionStatus] || "OFFLINE").toUpperCase();
}

function renderProfileOverview(source) {
  const account = source.account;
  replaceText("#profile-overview-mode", account ? `@${account.username}` : "GUEST MODE");
  setText("#profile-overview-status", overviewStatusText());
  setText("#profile-overview-sync", account ? "ACCOUNT SYNC" : "LOCAL ONLY");
}

function renderProfileToggles() {
  setText("#profile-sound-state", state.sound ? "SOUND ON" : "SOUND OFF");
  setText("#profile-music-state", state.music ? "MUSIC ON" : "MUSIC OFF");
}

export function renderProfileSummary() {
  const source = profileDisplaySource();
  const safeName = String(source.name || "PLAYER").trim() || "PLAYER";
  const displayName = safeName.toUpperCase();
  renderProfileHero(source, displayName);
  renderProfileStats(source);
  renderProfileOverview(source);
  renderProfileToggles();
  renderProfileStatistics();
  renderProfileHistory();
  host.renderAchievements();
}

export function formatStatDate(value) {
  if (!value) return "NOT RECORDED";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NOT RECORDED";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

function cleanHistory(entries) {
  return entries.filter((entry) => entry && typeof entry === "object").slice(0, 50);
}

function accountHistoryList(account) {
  const matchHistory = Array.isArray(account?.matchHistory) ? account.matchHistory : null;
  if (matchHistory && matchHistory.length) return cleanHistory(matchHistory);
  if (Array.isArray(account?.history)) return cleanHistory(account.history);
  return [];
}

function ownParticipant(entry, accountId) {
  if (!Array.isArray(entry.participants)) return null;
  return entry.participants.find((item) => item.accountId === accountId) || null;
}

function baseSummary(account) {
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

function recordedOwnValue(entry, accountId, key, fallbackKey) {
  const participant = ownParticipant(entry, accountId);
  const value = participant?.[key] ?? (fallbackKey ? entry?.[fallbackKey] : entry?.[key]);
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

function historyValues(history, accountId) {
  const cashValues = history.map((entry) => recordedOwnValue(entry, accountId, "endingCash")).filter((value) => value != null);
  const propertyValues = history.map((entry) => recordedOwnValue(entry, accountId, "propertyCount", "properties")).filter((value) => value != null);
  return {
    averageCash: cashValues.length ? Math.round(cashValues.reduce((sum, value) => sum + value, 0) / cashValues.length) : null,
    bestCash: cashValues.length ? Math.max(...cashValues) : null,
    bestProperties: propertyValues.length ? Math.max(...propertyValues) : null,
  };
}

function statValue(stats, key, format = String) {
  if (!Object.prototype.hasOwnProperty.call(stats, key)) return "NOT RECORDED";
  if (stats[key] == null) return "NOT RECORDED";
  if (!Number.isFinite(Number(stats[key]))) return "NOT RECORDED";
  return format(Number(stats[key]));
}

function statRecords(items) {
  return `<dl class="profile-stat-list">${items.map(([label, value]) => `<div class="profile-stat-record"><dt class="t-micro ink-3">${label}</dt><dd class="t-label f14 g100">${value}</dd></div>`).join("")}</dl>`;
}

function categoricalOutcome(entry, accountId) {
  const participant = ownParticipant(entry, accountId);
  if (participant?.bankrupt === true) return "BANKRUPT";
  if (entry.bankrupt === true) return "BANKRUPT";
  const placementOutcomeValue = placementOutcome(participant, entry);
  if (placementOutcomeValue) return placementOutcomeValue;
  return fallbackOutcome(entry);
}

function placementOutcome(participant, entry) {
  const placement = Number(participant?.finalPlacement ?? entry.finalPlacement);
  if (!Number.isInteger(placement) || placement <= 0) return "";
  if (placement === 1) return "WIN";
  return `PLACED #${placement}`;
}

function fallbackOutcome(entry) {
  const result = String(entry.result || "").toUpperCase();
  if (result === "WIN") return "WIN";
  if (entry.won === true) return "WIN";
  if (result === "ROUND") return "ROUND COMPLETE";
  if (entry.won === false) return "ROUND COMPLETE";
  return "NOT RECORDED";
}

function recentResultsHTML(ctx) {
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

function profilePersonalRecordsHTML(ctx) {
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

function profileStatValue(ctx, key, format) {
  if (!ctx.account) return "NOT RECORDED";
  return statValue(ctx.stats, key, format);
}

function statisticsGroupHTML(ctx, fields) {
  const items = fields.map(([label, key, format]) => [label, profileStatValue(ctx, key, format)]);
  return statRecords(items);
}

function statisticsTabsHTML(ctx) {
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

function listSize(list, fallback) {
  if (Array.isArray(list)) return list.length;
  return fallback;
}

function deedCount(participant, entry) {
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

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

function recordedText(recordValue, key, format = (value) => String(value)) {
  if (!recordValue || !Object.prototype.hasOwnProperty.call(recordValue, key) || recordValue[key] == null) return "NOT RECORDED";
  return format(recordValue[key]);
}

function detailField(label, value, tone = "g100") {
  return `<div class="profile-history-detail-field"><dt class="t-micro ink-3">${label}</dt><dd class="t-label f12 ${tone}">${value}</dd></div>`;
}

function ownParticipantResult(recordValue, accountId) {
  return ownParticipant(recordValue || {}, accountId);
}

function matchResult(recordValue, accountId) {
  if (!recordValue) return "NOT RECORDED";
  return categoricalOutcome(recordValue, accountId);
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  if (!seconds) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function resultTone(result) {
  if (result === "WIN") return "green";
  if (result === "BANKRUPT") return "red";
  return "g100";
}

function placementLabel(recordValue, participant) {
  const placement = participant?.finalPlacement ?? recordValue?.finalPlacement;
  if (placement == null) return "NOT RECORDED";
  const field = Array.isArray(recordValue?.participants) && recordValue.participants.length ? ` OF ${recordValue.participants.length}` : "";
  return `#${esc(placement)}${field}`;
}

function rulesLabel(recordValue) {
  const overrides = recordValue?.rulesetOverrides;
  if (!Array.isArray(overrides)) return "NOT RECORDED";
  return overrides.length ? `${overrides.length} HOUSE RULE${overrides.length === 1 ? "" : "S"}` : "STANDARD RULES";
}

function historySummaryFields(recordValue, participant, result) {
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

function placementRank(player) {
  const placement = Number(player?.finalPlacement);
  return Number.isInteger(placement) && placement > 0 ? placement : Infinity;
}

function byPlacement(a, b) {
  const left = placementRank(a);
  const right = placementRank(b);
  return left === right ? 0 : left - right;
}

function historyPlayerTags(player, you) {
  const youTag = you ? '<em class="profile-history-tag is-you">YOU</em>' : "";
  const bankruptTag = player.bankrupt === true ? '<em class="profile-history-tag is-bankrupt">BANKRUPT</em>' : "";
  return youTag + bankruptTag;
}

function historyPlayerRow(player, accountId) {
  const you = accountId != null && player.accountId === accountId;
  const rank = player.finalPlacement == null ? "NOT RECORDED" : `#${esc(player.finalPlacement)}`;
  const cash = player.endingCash == null ? "-" : esc(formatHistoryMoney(player.endingCash, "-"));
  const deeds = player.propertyCount == null ? "-" : `${esc(player.propertyCount)} ${Number(player.propertyCount) === 1 ? "DEED" : "DEEDS"}`;
  return `<li class="profile-history-player${you ? " is-you" : ""}"><strong class="profile-history-player-rank t-label f12">${rank}</strong><span class="profile-history-player-name t-label f12">${esc(player.displayNameAtMatch || "PLAYER")}${historyPlayerTags(player, you)}</span><span class="profile-history-player-cash t-label f12">${cash}</span><span class="profile-history-player-deeds t-micro ink-3">${deeds}</span></li>`;
}

function historyPlayerRows(recordValue, accountId) {
  const participants = recordValue?.participants;
  if (!Array.isArray(participants) || !participants.length) return "<li>NOT RECORDED</li>";
  return [...participants].sort(byPlacement).map((player) => historyPlayerRow(player, accountId)).join("");
}

function netField(label, list, accountId) {
  const entry = (Array.isArray(list) ? list : []).find((item) => item?.accountId === accountId);
  const net = Number(entry?.net);
  if (!entry || entry.net == null || !Number.isFinite(net)) return detailField(label, "NOT RECORDED");
  return detailField(label, esc(formatSignedMoney(net)), net > 0 ? "green" : net < 0 ? "red" : "g100");
}

function historyEconomyFields(recordValue, participant, accountId) {
  return [
    detailField("ENDING CASH", esc(recordedText(participant, "endingCash", (value) => formatHistoryMoney(value)))),
    detailField("PROPERTIES", historyPropertyCount(participant)),
    netField("CASINO NET", recordValue?.casino, accountId),
    netField("MARKET NET", recordValue?.market, accountId),
    detailField("TRADES", esc(recordedText(recordValue, "tradesCompleted"))),
    detailField("AUCTIONS", esc(recordedText(recordValue, "auctionsCompleted"))),
    detailField("CONTRACTS", esc(recordedText(recordValue, "playerContracts", (items) => Array.isArray(items) ? String(items.length) : "NOT RECORDED"))),
  ].join("");
}

function historyPropertyCount(participant) {
  const propertyCount = participant?.propertyCount ?? participant?.properties;
  if (propertyCount == null) return "NOT RECORDED";
  return esc(propertyCount);
}

function historyEventList(recordValue) {
  const events = recordValue?.globalEvents;
  if (!Array.isArray(events)) return "<p>NOT RECORDED</p>";
  if (!events.length) return "<p>NO GLOBAL EVENTS THIS ROUND</p>";
  return `<ul>${events.map((event) => `<li>${esc(historyEventName(event))}</li>`).join("")}</ul>`;
}

function historyEventName(event) {
  if (typeof event === "string") return event;
  if (event?.name) return event.name;
  if (event?.title) return event.title;
  return "EVENT";
}

function netWorthRoundLabel(row) {
  return `R${Math.max(0, Math.floor(Number(row?.round) || 0))}`;
}

function netWorthSeatSeries(participant, index, accountId, rows) {
  const isYou = participant?.accountId === accountId;
  return {
    id: participant?.accountId || `seat-${index}`,
    name: `${participant?.displayNameAtMatch || "PLAYER"}${isYou ? " (you)" : ""}`,
    values: rows.map((row) => (Array.isArray(row?.worth) ? row.worth[index] : null)),
  };
}

/** Net worth per round as a multi-line chart spec: you first (solid, primary), then the other seats. */
export function historyNetWorthChartSpec(record, accountId) {
  const rows = Array.isArray(record?.netWorthTimeline) ? record.netWorthTimeline : [];
  const participants = Array.isArray(record?.participants) ? record.participants : [];
  if (rows.length < 2 || !participants.length) return null;
  const seats = participants.slice(0, 6)
    .map((participant, index) => ({ participant, index }))
    .sort((a, b) => Number(b.participant?.accountId === accountId) - Number(a.participant?.accountId === accountId));
  return {
    kind: "line",
    unit: "dollars",
    title: "Net worth by round",
    labels: rows.map(netWorthRoundLabel),
    series: seats.map(({ participant, index }) => netWorthSeatSeries(participant, index, accountId, rows)),
  };
}

function historyWorthPanel(recordValue, accountId) {
  const rows = recordValue?.netWorthTimeline;
  if (!Array.isArray(rows)) return '<p class="profile-history-worth-empty">NOT RECORDED</p>';
  const spec = historyNetWorthChartSpec(recordValue, accountId);
  if (!spec) return '<p class="profile-history-worth-empty">NOT ENOUGH ROUNDS TO CHART</p>';
  const last = rows[rows.length - 1];
  const final = spec.series.map((series) => {
    const seat = recordValue.participants.findIndex((participant, index) => index < 6 && (participant?.accountId || `seat-${index}`) === series.id);
    const worth = Array.isArray(last?.worth) ? last.worth[seat] : null;
    return `${esc(series.name)} ${worth == null ? "-" : esc(formatHistoryMoney(worth))}`;
  }).join(" · ");
  return `<div class="profile-history-chart" data-profile-history-chart="${esc(recordValue.matchId)}"></div><p class="t-micro ink-3 profile-history-chart-note">FINAL NET WORTH · ${final}</p><p class="t-micro ink-3 profile-history-chart-note">NET WORTH = CASH + DEEDS + BUILDINGS − DEBTS · ONE POINT PER ROUND</p>`;
}

function historyDetailPanels(recordValue, accountId, participant) {
  const result = matchResult(recordValue, accountId);
  const summaryFields = historySummaryFields(recordValue, participant, result);
  const playerRows = historyPlayerRows(recordValue, accountId);
  const economyFields = historyEconomyFields(recordValue, participant, accountId);
  const events = historyEventList(recordValue);
  return [
    ["summary", "SUMMARY", `<dl class="profile-history-detail-grid">${summaryFields}</dl>`],
    ["players", "PLAYERS", `<ul class="profile-history-player-list">${playerRows}</ul>`],
    ["worth", "NET WORTH", historyWorthPanel(recordValue, accountId)],
    ["economy", "ECONOMY &amp; DEALS", `<dl class="profile-history-detail-grid">${economyFields}</dl>`],
    ["events", "EVENTS", `<div class="profile-history-event-list">${events}</div>`],
  ];
}

function historyDetailTabButtons(panels, detailId) {
  const buttons = panels.map(([key, label], index) => `<button type="button" role="tab" id="${detailId}-tab-${key}" aria-selected="${index === 0}" aria-controls="${detailId}-panel-${key}" tabindex="${index === 0 ? "0" : "-1"}" data-profile-history-detail-tab="${key}">${label}</button>`).join("");
  return buttons;
}

function historyDetailTabContents(panels, detailId) {
  const contents = panels.map(([key, , content], index) => `<section role="tabpanel" id="${detailId}-panel-${key}" aria-labelledby="${detailId}-tab-${key}" tabindex="0"${index ? " hidden" : ""}>${content}</section>`).join("");
  return contents;
}

function ownerDetailsPanels(recordValue, accountId, detailId) {
  const participant = ownParticipantResult(recordValue, accountId);
  const panels = historyDetailPanels(recordValue, accountId, participant);
  const buttons = historyDetailTabButtons(panels, detailId);
  const contents = historyDetailTabContents(panels, detailId);
  const source = recordValue ? "owner" : "unavailable";
  return `<div class="profile-history-details" id="${detailId}" data-profile-detail-source="${source}" hidden><div class="profile-history-detail-tabs" role="tablist" aria-label="Match details">${buttons}</div><div class="profile-detail-scroll" tabindex="0" aria-label="Scrollable match details">${contents}</div></div>`;
}

/** One labelled column of the collapsed row; a missing value reads as a dash but stays announced. */
function historyStat(label, value) {
  const shown = value == null ? '-<span class="sr-only">NOT RECORDED</span>' : esc(value);
  return `<span class="profile-history-stat"><span class="t-micro ink-3">${label}</span><strong class="t-label f12 g100">${shown}</strong></span>`;
}

/** Ending cash only comes from the owner's private record, never from the public summary row. */
function ownerCashValue(ownerRecord, accountId) {
  const cash = ownParticipant(ownerRecord || {}, accountId)?.endingCash;
  const number = cash == null ? null : Number(cash);
  return number !== null && Number.isFinite(number) ? number : null;
}

function ownerEndingCash(ownerRecord, accountId) {
  const value = ownerCashValue(ownerRecord, accountId);
  return value === null ? null : formatHistoryMoney(value);
}

const STANDARD_BOARD = "standard-40";

function boardOf(entry) {
  return typeof entry?.boardVariant === "string" ? entry.boardVariant : "";
}

function hasHouseRules(entry) {
  return Array.isArray(entry?.rulesetOverrides) && entry.rulesetOverrides.length > 0;
}

/** Small tags under the date: only what differs from a plain standard round, plus the best-cash round. */
function historyChips(entry, best) {
  const chips = [];
  if (best) chips.push('<span class="profile-history-chip is-best">BEST CASH</span>');
  if (hasHouseRules(entry)) chips.push('<span class="profile-history-chip">HOUSE RULES</span>');
  const board = boardOf(entry);
  if (board && board !== STANDARD_BOARD) chips.push(`<span class="profile-history-chip">${esc(board.toUpperCase())}</span>`);
  return chips.join("");
}

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
function syncHistoryChart(row) {
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

function restoreOpenHistoryRows(root) {
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

function emptyHistoryPanelHTML(account) {
  const message = account
    ? "NO COMPLETED ROUNDS YET. YOUR FIRST FINISH WILL APPEAR HERE."
    : "SIGN IN TO KEEP A SERVER-SYNCED ROUND HISTORY.";
  return `<section class="panel noise pad16 profile-empty-panel"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2></div><p class="t-body ink-2">${message}</p><p class="t-micro ink-3">Only completed server rounds appear here. Guest play remains available without an account.</p></section>`;
}

/* ---------- summary strip, filters, count ---------- */

function placementNumber(entry, accountId) {
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

function summaryStripHTML(summary) {
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

function resultKind(outcome) {
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

function historyToolbarHTML(history, hasRows) {
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

function historyFocusTarget(root) {
  const active = globalThis.document?.activeElement;
  if (!active || !root.contains(active)) return null;
  for (const attribute of FOCUS_ATTRIBUTES) {
    const value = active.getAttribute?.(attribute);
    if (value !== null && value !== undefined) return { attribute, value };
  }
  return null;
}

function restoreHistoryFocus(root, target) {
  if (!target) return;
  [...root.querySelectorAll(`[${target.attribute}]`)].find((candidate) => candidate.getAttribute(target.attribute) === target.value)?.focus({ preventScroll: true });
}

export function renderProfileHistory() {
  const root = $("#profile-history-content");
  if (!root) return;
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

function accountAvatarMarkup(visual) {
  if (visual.grid) return spriteFromGrid(visual.grid, 4);
  return avatarHTML({ color: visual.color }, 4, 0);
}

function renderSignedAccountPanel(account) {
  const visual = profileDisplaySource();
  setHTML("#account-avatar", accountAvatarMarkup(visual));
  replaceText("#account-display-name", account.displayName);
  replaceText("#account-username", `@${account.username}`);
  replaceText("#account-games", String(account.stats?.gamesPlayed || 0));
  replaceText("#account-wins", String(account.stats?.wins || 0));
  replaceText("#account-rate", accountRate(account.stats));
  const pending = account.accountDeactivated === true;
  const editButton = $("#account-edit-btn");
  if (editButton) {
    editButton.disabled = pending;
    editButton.setAttribute("aria-disabled", String(pending));
  }
  const badge = $("#account-panel-badge");
  if (badge) badge.textContent = pending ? "DELETION PENDING" : "ACCOUNT ACTIVE";
  renderAccountRights(account);
}

function syncAccountPanelVisibility(signedIn) {
  $("#account-guest-state")?.classList.toggle("is-hidden", signedIn);
  $("#account-signed-state")?.classList.toggle("is-hidden", !signedIn);
  setText("#account-panel-title", signedIn ? `@${state.account.account.username}` : "Guest mode");
}

function accountPendingDeletion(signedIn) {
  return signedIn && state.account.account.accountDeactivated === true;
}

function applyPendingDeletionLock() {
  const profileRoot = $("#view-profile");
  state.profileTab = "account";
  if (profileRoot) profileRoot.dataset.profileTab = "account";
  document.querySelectorAll("#profile-tabs [data-profile-tab]").forEach((button) => {
    const active = button.dataset.profileTab === "account";
    button.disabled = !active;
    button.setAttribute("aria-disabled", String(!active));
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("#view-profile .profile-tab-panel").forEach((panel) => panel.classList.toggle("is-hidden", panel.id !== "profile-panel-account"));
}

function clearPendingDeletionLock() {
  document.querySelectorAll("#profile-tabs [data-profile-tab]").forEach((button) => {
    button.disabled = false;
    button.removeAttribute("aria-disabled");
  });
}

export function renderAccountPanel() {
  const signedIn = Boolean(state.account?.account);
  syncAccountPanelVisibility(signedIn);
  const pending = accountPendingDeletion(signedIn);
  setText("#account-panel-badge", signedIn ? (pending ? "DELETION PENDING" : "ACCOUNT ACTIVE") : "LOCAL ONLY");
  if (pending) applyPendingDeletionLock();
  else clearPendingDeletionLock();
  renderProfileSummary();
  if (!signedIn) return;
  renderSignedAccountPanel(state.account.account);
}

function configureDesignButtons(atCap) {
  const newBtn = $("#pl-new-btn");
  if (newBtn) {
    newBtn.disabled = atCap;
    newBtn.querySelector(".t-label").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "+ NEW DESIGN";
  }
  const saveBtn = $("#pl-save-btn");
  if (saveBtn) {
    saveBtn.disabled = !state.profileDraft || atCap;
    saveBtn.querySelector(".cta-text").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "SAVE DESIGN";
  }
}

function emptyLibraryMessage() {
  return `<p class="pl-empty">No custom designs yet. Press <strong style="color:var(--gold-300)">+ NEW DESIGN</strong> to draw your first player.</p>`;
}

function draftCard() {
  const draft = state.profileDraft;
  if (!draft || state.editingProfileId) return null;
  return { id: "draft", designName: draft.designName || "UNTITLED DESIGN", color: draft.color, avatarGrid: draft.grid, isDraft: true };
}

function cardForProfile(profile, i, draft) {
  if (!draft || state.editingProfileId !== profile.id) {
    return { ...profile, designName: profileDesignName(profile), isEditing: false, seed: i };
  }
  return {
    ...profile,
    designName: draft.designName || "UNTITLED DESIGN",
    color: draft.color,
    avatarGrid: draft.grid,
    isEditing: true,
    seed: i,
  };
}

function tileClasses(p, selected) {
  const cls = ["pl-tile"];
  if (selected) cls.push("is-active");
  if (p.isDraft) cls.push("is-draft");
  if (p.isEditing) cls.push("is-editing");
  return cls.join(" ");
}

function tileStateLabel(selected, editing) {
  if (editing) return `<span class="t-micro ink-3">EDITING · LIVE PREVIEW</span>`;
  if (selected) return `<span class="t-micro ink-3">ACTIVE DESIGN</span>`;
  return `<span class="t-micro ink-3">TAP TO SELECT</span>`;
}

function tileSelectHTML(p, i, selected) {
  const entity = { color: p.color, avatarGrid: p.avatarGrid };
  const name = `<span class="pl-name-row"><span class="pl-name-chip" style="background:${p.color}" aria-hidden="true"></span><span class="t-label pl-tile-name">${esc(p.designName)}</span></span>`;
  const av = `<span class="pl-tile-av">${avatarHTML(entity, 3, i)}</span>`;
  if (p.isDraft) {
    return `<div class="pl-tile-select pl-tile-draft" aria-label="Unsaved design preview">${av}<span class="pl-tile-info">${name}<span class="t-micro g400">UNSAVED DRAFT · LIVE PREVIEW</span></span></div>`;
  }
  const status = tileStateLabel(selected, Boolean(p.isEditing));
  return `<button class="pl-tile-select" type="button" data-profile-select="${esc(p.id)}" aria-pressed="${selected}">${av}<span class="pl-tile-info">${name}${status}</span></button>`;
}

function tileActionsHTML(p) {
  if (p.isDraft) {
    return `<div class="pl-tile-actions"><span class="t-micro g400 pl-draft-badge">DRAFT</span></div>`;
  }
  return `<div class="pl-tile-actions"><button class="btn-dark" type="button" data-profile-edit="${esc(p.id)}"><span class="t-label">EDIT</span></button><button class="btn-dark pl-delete" type="button" data-profile-delete="${esc(p.id)}"><span class="t-label">DELETE</span></button></div>`;
}

function libraryTileHTML(p, i, activeId) {
  const selected = !p.isDraft && p.id === activeId;
  return `<div class="${tileClasses(p, selected)}">
      ${tileSelectHTML(p, i, selected)}
      ${tileActionsHTML(p)}
    </div>`;
}

export function renderProfileLibrary() {
  const atCap = state.profiles.length >= MAX_PROFILES;
  configureDesignButtons(atCap);
  const list = $("#pl-list");
  if (!list) return;
  if (!state.profiles.length) {
    if (!state.profileDraft) {
      list.innerHTML = emptyLibraryMessage();
      return;
    }
  }
  const activeId = typeof state.appearance === "string" ? state.appearance : null;
  const draft = state.profileDraft;
  const cards = state.profiles.map((profile, i) => cardForProfile(profile, i, draft));
  const draftEntry = draftCard();
  if (draftEntry) cards.unshift(draftEntry);
  list.innerHTML = cards.map((p, i) => libraryTileHTML(p, i, activeId)).join("");
}

function homeColor(saved, account, preset) {
  if (saved?.color) return saved.color;
  if (account?.color) return account.color;
  if (preset.color) return preset.color;
  return "#d74438";
}

function homeAvatarHTML(source, color, size) {
  if (source?.avatarGrid) return spriteFromGrid(source.avatarGrid, size);
  return avatarHTML({ color }, size, 0);
}

export function applyProfileToHomeUI() {
  const saved = selectedProfile();
  const account = state.account?.account || null;
  const name = sourceName(account);
  const color = homeColor(saved, account, getAppearanceMeta(state.appearance));
  const avatarSource = saved || account;

  document.querySelectorAll("[data-global-you-name]").forEach((nameNode) => {
    nameNode.textContent = name;
  });
  document.querySelectorAll("[data-global-you-avatar]").forEach((avatarNode) => {
    avatarNode.innerHTML = homeAvatarHTML(avatarSource, color, 3);
  });

  setText("#chair-name", `that's you, ${name}`);
  setHTML("#chair-avatar", homeAvatarHTML(avatarSource, color, 4));

  const resumeBtn = $("#resume-btn");
  if (resumeBtn) resumeBtn.classList.toggle("is-hidden", !host.loadSavedGame());
  renderGuestAliasField();
  host.renderHomeSignals();
}

function syncAliasInput(input, signedIn) {
  if (!input) return;
  if (signedIn) return;
  if (input.value === state.alias) return;
  input.value = state.alias;
}

export function renderGuestAliasField(errorText = "") {
  const signedIn = Boolean(state.account?.account);
  $("#home-alias-form")?.classList.toggle("is-hidden", signedIn);
  const aliasInput = $("#home-alias");
  syncAliasInput(aliasInput, signedIn);
  setText("#home-alias-error", errorText);
  if (aliasInput) {
    if (errorText) aliasInput.setAttribute("aria-describedby", "home-alias-error");
    else aliasInput.removeAttribute("aria-describedby");
  }
}

export function requireGuestAlias() {
  if (state.account?.account) return true;
  const alias = String(state.alias || "").trim();
  if (alias) return true;
  renderGuestAliasField("CREATE AN ALIAS BEFORE JOINING A TABLE.");
  $("#home-alias")?.focus({ preventScroll: true });
  return false;
}

function swatchHTML(c, d) {
  const active = c.toLowerCase() === d.color.toLowerCase();
  return `<button type="button" class="profile-swatch${active ? " is-active" : ""}" style="background:${c}" data-color="${c}" title="${c}" aria-label="Player color ${c}" aria-pressed="${active}"></button>`;
}

function faceSwatchHTML(c, d) {
  const active = d.tool === "paint" && c.toLowerCase() === d.paintColor.toLowerCase();
  return `<button type="button" class="face-swatch${active ? " is-active" : ""}" style="background:${c}" data-ink="${c}" title="${c}" aria-label="Paint color ${c}" aria-pressed="${active}"></button>`;
}

// One tab stop for the whole face grid (roving focus): the cell last focused, moved with the arrow keys.
let faceFocus = { x: 0, y: 0 };
export function setFaceFocus(x, y) { faceFocus = { x, y }; }

function faceCellHTML(c, x, y) {
  const style = c ? `background-color:${c};background-image:none` : "";
  const tab = x === faceFocus.x && y === faceFocus.y ? 0 : -1;
  return `<button type="button" class="face-cell" tabindex="${tab}" data-x="${x}" data-y="${y}" style="${style}" aria-label="Paint pixel row ${y + 1} column ${x + 1}"></button>`;
}

export function renderProfileEditor() {
  const d = state.profileDraft;
  if (!d) return;
  const deleteBtn = $("#profile-delete-btn");
  if (deleteBtn) deleteBtn.classList.toggle("is-hidden", !state.editingProfileId);
  const saveLabel = $("#pl-save-btn")?.querySelector(".cta-text");
  if (saveLabel) saveLabel.textContent = state.editingProfileId ? "Save Changes" : "Save Design";
  $("#profile-swatches").innerHTML = PROFILE_SWATCHES.map((c) => swatchHTML(c, d)).join("");
  $("#profile-color-picker").value = d.color;
  $("#profile-name").value = d.designName;

  $("#face-palette").innerHTML = FACE_PALETTE.map((c) => faceSwatchHTML(c, d)).join("");
  $("#face-color-picker").value = d.paintColor;
  $("#face-tool-paint").classList.toggle("is-active", d.tool === "paint");
  $("#face-tool-erase").classList.toggle("is-active", d.tool === "erase");

  const canvas = $("#face-canvas");
  canvas.innerHTML = d.grid
    .map((row, y) => row.map((c, x) => faceCellHTML(c, x, y)).join(""))
    .join("");

  updateProfilePreview();
  renderProfileSummary();
}

export function updateProfilePreview() {
  const d = state.profileDraft;
  if (!d) return;
  const av = $("#profile-preview-av");
  if (av) av.innerHTML = spriteFromGrid(d.grid, 6);
  const nameEl = $("#profile-preview-name");
  if (nameEl) nameEl.textContent = (d.designName || "UNTITLED DESIGN").toUpperCase();
  const chipEl = $("#profile-preview-chip");
  if (chipEl) chipEl.style.background = d.color;
  renderProfileLibrary();
  renderProfileSummary();
}

export function paintFaceCell(x, y) {
  const d = state.profileDraft;
  if (!d) return;
  const color = d.tool === "erase" ? null : d.paintColor;
  if (d.grid[y][x] === color) return;
  d.grid[y][x] = color;
  const cell = $(`#face-canvas .face-cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) {
    cell.style.backgroundColor = color || "";
    cell.style.backgroundImage = color ? "none" : "";
  }
  updateProfilePreview();
}
