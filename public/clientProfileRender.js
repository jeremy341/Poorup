/* ============================================================
   PROFILE SURFACES: identity display source, profile summary,
   statistics deck, history rows, library tiles, the face editor
   canvas renderers, and the guest-alias field. Socket-backed
   saves and view switching stay in the entry module; the
   achievements renderer is injected as a host callback.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state, getProfileById, getAppearanceMeta } from "./clientState.js";
import { spriteFromGrid, avatarHTML, hydrateSprites } from "./clientSprites.js";
import { CONNECTION_COPY } from "./clientTopNavRender.js";
import { MAX_PROFILES, profileDesignName } from "./clientSanitize.js";
import { renderAccountRights } from "./clientAccountRights.js";

const PROFILE_SWATCHES = ["#d74438", "#286ea1", "#d9a62f", "#35a653", "#a04e6f", "#3e7d7b", "#7b5029", "#cfa75f"];
const FACE_PALETTE = ["#f0d9ac", "#e8d3ab", "#cfa75f", "#c88f2e", "#9b783d", "#5c5033", "#01070a", "#ffffff", "#d74438", "#35a653", "#286ea1", "#d9a62f"];

function noop() {}
function noopNull() { return null; }

let host = { renderAchievements: noop, renderCollection: noop, loadSavedGame: noopNull, renderHomeSignals: noop };

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
  setText("#profile-hero-handle", account ? `@${account.username}` : "GUEST MODE");
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
  host.renderCollection();
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
  if (!Object.prototype.hasOwnProperty.call(stats, key) || stats[key] == null || !Number.isFinite(Number(stats[key]))) return "NOT RECORDED";
  return format(Number(stats[key]));
}

function statRecords(items) {
  return `<dl class="profile-stat-list">${items.map(([label, value]) => `<div class="profile-stat-record"><dt class="t-micro ink-3">${label}</dt><dd class="t-label f14 g100">${value}</dd></div>`).join("")}</dl>`;
}

function categoricalOutcome(entry, accountId) {
  const participant = ownParticipant(entry, accountId);
  if (participant?.bankrupt === true || entry.bankrupt === true) return "BANKRUPT";
  const placement = Number(participant?.finalPlacement ?? entry.finalPlacement);
  if (Number.isInteger(placement) && placement > 0) return placement === 1 ? "WIN" : `PLACED #${placement}`;
  if (String(entry.result || "").toUpperCase() === "WIN" || entry.won === true) return "WIN";
  if (String(entry.result || "").toUpperCase() === "ROUND" || entry.won === false) return "ROUND COMPLETE";
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

function statisticsTabsHTML(ctx) {
  const stats = ctx.stats;
  const values = statRecords([
    ["CASINO NET", ctx.account ? statValue(stats, "casinoNet", (value) => `$${value.toLocaleString()}`) : "NOT RECORDED"],
    ["MARKET P/L", ctx.account ? statValue(stats, "marketProfit", (value) => `$${value.toLocaleString()}`) : "NOT RECORDED"],
    ["PATROL BEST", ctx.account ? statValue(stats, "patrolBest") : "NOT RECORDED"],
    ["BANK LOANS REPAID", ctx.account ? statValue(stats, "bankLoanRepayments") : "NOT RECORDED"],
  ]);
  const activity = statRecords([
    ["EVENT SURVIVAL", ctx.account ? statValue(stats, "eventSurvival") : "NOT RECORDED"],
    ["AUCTION WINS", ctx.account ? statValue(stats, "auctionWins") : "NOT RECORDED"],
    ["LOANS GIVEN", ctx.account ? statValue(stats, "playerLoansGiven") : "NOT RECORDED"],
    ["EQUITY DEALS", ctx.account ? statValue(stats, "equityDeals") : "NOT RECORDED"],
  ]);
  const tabs = ["results", "economy", "deals-events"];
  const labels = ["RESULTS", "ECONOMY", "DEALS &amp; EVENTS"];
  return `<div class="profile-stat-tabs" role="tablist" aria-label="Statistics categories">${tabs.map((tab, index) => `<button class="profile-stat-tab${index === 0 ? " is-active" : ""}" type="button" role="tab" id="profile-stat-tab-${tab}" aria-selected="${index === 0}" aria-controls="profile-stat-panel-${tab}" tabindex="${index === 0 ? "0" : "-1"}" data-profile-stat-tab="${tab}">${labels[index]}</button>`).join("")}</div>
    <section class="profile-stat-tab-panel" role="tabpanel" id="profile-stat-panel-results" aria-labelledby="profile-stat-tab-results" tabindex="0">${recentResultsHTML(ctx)}${profilePersonalRecordsHTML(ctx)}</section>
    <section class="profile-stat-tab-panel" role="tabpanel" id="profile-stat-panel-economy" aria-labelledby="profile-stat-tab-economy" tabindex="0" hidden>${values}</section>
    <section class="profile-stat-tab-panel" role="tabpanel" id="profile-stat-panel-deals-events" aria-labelledby="profile-stat-tab-deals-events" tabindex="0" hidden>${activity}</section>`;
}

export function profileStatisticsHTML(ctx) {
  const account = ctx.account;
  const values = [
    ["ROUNDS", account ? String(ctx.games) : "—", "g100"],
    ["WINS", account ? String(ctx.wins) : "—", "green"],
    ["WIN RATE", account ? `${ctx.winShare}%` : "—", "g300"],
    ["BANKRUPTCIES", account ? String(ctx.bankruptcies) : "—", "g-muted"],
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

function detailField(label, value) {
  return `<div class="profile-history-detail-field"><dt class="t-micro ink-3">${label}</dt><dd class="t-label f12 g100">${value}</dd></div>`;
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

function ownerDetailsPanels(recordValue, accountId, detailId) {
  const participant = ownParticipantResult(recordValue, accountId);
  const result = matchResult(recordValue, accountId);
  const placement = participant?.finalPlacement ?? recordValue?.finalPlacement;
  const propertyCount = participant?.propertyCount ?? participant?.properties;
  const board = recordValue?.boardVariant ?? recordValue?.rulesetPreset ?? recordValue?.rulesetBase;
  const summaryFields = [
    detailField("MATCH", esc(recordedText(recordValue, "matchId"))),
    detailField("RESULT", esc(result)),
    detailField("DURATION", esc(recordedText(recordValue, "durationSeconds", formatDuration))),
    detailField("ROUNDS", esc(recordedText(recordValue, "roundCount"))),
    detailField("BOARD / RULES", board == null ? "NOT RECORDED" : esc(String(board).toUpperCase())),
    detailField("PLACEMENT", placement == null ? "NOT RECORDED" : `#${esc(placement)}`),
  ].join("");
  const playerRows = Array.isArray(recordValue?.participants) && recordValue.participants.length
    ? recordValue.participants.map((player) => `<li><span>${esc(player.displayNameAtMatch || "PLAYER")}</span><strong>${player.finalPlacement == null ? "NOT RECORDED" : `#${esc(player.finalPlacement)}`}</strong></li>`).join("")
    : "<li>NOT RECORDED</li>";
  const economyFields = [
    detailField("ENDING CASH", recordedText(participant, "endingCash", (value) => `$${Number(value).toLocaleString()}`)),
    detailField("PROPERTIES", propertyCount == null ? "NOT RECORDED" : esc(propertyCount)),
    detailField("CASINO NET", recordedText((recordValue?.casino || []).find((item) => item.accountId === accountId), "net", (value) => `$${Number(value).toLocaleString()}`)),
    detailField("MARKET NET", recordedText((recordValue?.market || []).find((item) => item.accountId === accountId), "net", (value) => `$${Number(value).toLocaleString()}`)),
    detailField("TRADES", recordedText(recordValue, "tradesCompleted")),
    detailField("CONTRACTS", recordedText(recordValue, "playerContracts", (items) => Array.isArray(items) ? String(items.length) : "NOT RECORDED")),
  ].join("");
  const events = Array.isArray(recordValue?.globalEvents) && recordValue.globalEvents.length
    ? `<ul>${recordValue.globalEvents.map((event) => `<li>${esc(typeof event === "string" ? event : event?.name || event?.title || "EVENT")}</li>`).join("")}</ul>`
    : "<p>NOT RECORDED</p>";
  const panels = [
    ["summary", "SUMMARY", `<dl class="profile-history-detail-grid">${summaryFields}</dl>`],
    ["players", "PLAYERS", `<ul class="profile-history-player-list">${playerRows}</ul>`],
    ["economy", "ECONOMY &amp; DEALS", `<dl class="profile-history-detail-grid">${economyFields}</dl>`],
    ["events", "EVENTS", `<div class="profile-history-event-list">${events}</div>`],
  ];
  const buttons = panels.map(([key, label], index) => `<button type="button" role="tab" id="${detailId}-tab-${key}" aria-selected="${index === 0}" aria-controls="${detailId}-panel-${key}" tabindex="${index === 0 ? "0" : "-1"}" data-profile-history-detail-tab="${key}">${label}</button>`).join("");
  const contents = panels.map(([key, , content], index) => `<section role="tabpanel" id="${detailId}-panel-${key}" aria-labelledby="${detailId}-tab-${key}" tabindex="0"${index ? " hidden" : ""}>${content}</section>`).join("");
  return `<div class="profile-history-details" id="${detailId}" data-profile-detail-source="${recordValue ? "owner" : "unavailable"}" hidden><div class="profile-history-detail-tabs" role="tablist" aria-label="Match details">${buttons}</div><div class="profile-detail-scroll" tabindex="0" aria-label="Scrollable match details">${contents}</div></div>`;
}

export function profileHistoryRowHTML(entry, index, total, accountId, ownerRecord = null) {
  const matchId = typeof entry.matchId === "string" ? entry.matchId : "";
  const date = formatStatDate(entry.completedAt || entry.playedAt);
  const outcome = matchResult(entry, accountId);
  const won = outcome === "WIN";
  const resultTone = won ? "green" : outcome === "BANKRUPT" ? "red" : "g100";
  const deeds = deedCount(ownParticipant(entry, accountId), entry);
  const playerCount = listSize(entry.participants, "NOT RECORDED");
  const lead = String(total - index).padStart(2, "0");
  const detailId = `profile-history-details-${safeId(matchId)}`;
  const deedLabel = deeds == null ? "NOT RECORDED" : esc(deeds);
  const eventCount = listSize(entry.globalEvents, "NOT RECORDED");
  const rowContent = `<span class="profile-history-index t-micro ink-3">${lead}</span><span class="profile-history-main"><strong class="t-label f12 ${resultTone}">${esc(outcome)}</strong><span class="t-micro ink-3">${esc(date)} · ${esc(playerCount)} PLAYERS</span></span><span class="profile-history-meta"><span class="t-micro ink-3">DEEDS ${deedLabel}</span><span class="t-micro ink-3">${esc(eventCount)} EVENTS</span></span>`;
  const summary = matchId
    ? `<button type="button" class="profile-history-toggle" aria-label="Show details for ${esc(date)}: ${esc(outcome)}" aria-expanded="false" aria-controls="${detailId}" data-profile-history-toggle="${esc(matchId)}">${rowContent}<span class="t-micro g400" aria-hidden="true">DETAILS +</span></button>`
    : `<div class="profile-history-summary">${rowContent}<span class="t-micro ink-3">DETAILS NOT RECORDED</span></div>`;
  return `<article class="profile-history-row${won ? " is-win" : ""}" data-profile-history-row="${esc(matchId)}">${summary}${matchId ? ownerDetailsPanels(ownerRecord, accountId, detailId) : ""}</article>`;
}

function emptyHistoryPanelHTML(account) {
  const message = account
    ? "NO COMPLETED ROUNDS YET. YOUR FIRST FINISH WILL APPEAR HERE."
    : "SIGN IN TO KEEP A SERVER-SYNCED ROUND HISTORY.";
  return `<section class="panel noise pad16 profile-empty-panel"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2></div><p class="t-body ink-2">${message}</p><p class="t-micro ink-3">Only completed server rounds appear here. Guest play remains available without an account.</p></section>`;
}

function historyPanelHTML(history, accountId) {
  const ownerRecords = new Map((Array.isArray(state.account?.account?.matchHistory) ? state.account.account.matchHistory : []).filter((entry) => typeof entry?.matchId === "string").map((entry) => [entry.matchId, entry]));
  const rows = history.map((entry, index) => profileHistoryRowHTML(entry, index, history.length, accountId, ownerRecords.get(entry.matchId) || null)).join("");
  return `<section class="panel noise pad16"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2><span class="t-micro ink-3">${history.length} SAVED</span></div><div class="profile-history-list">${rows}</div><p class="t-micro ink-3 profile-history-note">History is recorded when a server round finishes. Detailed participants, events, and economy results stay inside your private account record.</p></section>`;
}

export function renderProfileHistory() {
  const root = $("#profile-history-content");
  if (!root) return;
  const account = state.account?.account || null;
  const history = accountHistoryList(account);
  if (!account || !history.length) {
    root.innerHTML = emptyHistoryPanelHTML(account);
    hydrateSprites(root);
    return;
  }
  root.innerHTML = historyPanelHTML(history, account.id);
  hydrateSprites(root);
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
  return `<p class="pl-empty">No custom designs yet — press <strong style="color:var(--gold-300)">+ NEW DESIGN</strong> to draw your first player.</p>`;
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
  const name = `<span class="t-label pl-tile-name" style="color:${p.color}">${esc(p.designName)}</span>`;
  const av = `<span class="pl-tile-av">${avatarHTML(entity, 3, i)}</span>`;
  if (p.isDraft) {
    return `<div class="pl-tile-select pl-tile-draft" aria-label="Unsaved design preview">${av}<span class="pl-tile-info">${name}<span class="t-micro g400">UNSAVED DRAFT · LIVE PREVIEW</span></span></div>`;
  }
  const status = tileStateLabel(selected, Boolean(p.isEditing));
  return `<button class="pl-tile-select" type="button" data-profile-select="${p.id}" aria-pressed="${selected}">${av}<span class="pl-tile-info">${name}${status}</span></button>`;
}

function tileActionsHTML(p) {
  if (p.isDraft) {
    return `<div class="pl-tile-actions"><span class="t-micro g400 pl-draft-badge">DRAFT</span></div>`;
  }
  return `<div class="pl-tile-actions"><button class="btn-dark" type="button" data-profile-edit="${p.id}"><span class="t-label">EDIT</span></button><button class="btn-dark pl-delete" type="button" data-profile-delete="${p.id}"><span class="t-label">DELETE</span></button></div>`;
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
  syncAliasInput($("#home-alias"), signedIn);
  setText("#home-alias-error", errorText);
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

function faceCellHTML(c, x, y) {
  const style = c ? `background-color:${c};background-image:none` : "";
  return `<button type="button" class="face-cell" data-x="${x}" data-y="${y}" style="${style}" aria-label="Paint pixel row ${y + 1} column ${x + 1}"></button>`;
}

export function renderProfileEditor() {
  const d = state.profileDraft;
  if (!d) return;
  const deleteBtn = $("#profile-delete-btn");
  if (deleteBtn) deleteBtn.classList.toggle("is-hidden", !state.editingProfileId);
  const saveLabel = $("#pl-save-btn")?.querySelector(".cta-text");
  if (saveLabel) saveLabel.textContent = state.editingProfileId ? "Save Changes" : "Save Design";
  // identity swatches
  $("#profile-swatches").innerHTML = PROFILE_SWATCHES.map((c) => swatchHTML(c, d)).join("");
  $("#profile-color-picker").value = d.color;
  $("#profile-name").value = d.designName;

  // face palette
  $("#face-palette").innerHTML = FACE_PALETTE.map((c) => faceSwatchHTML(c, d)).join("");
  $("#face-color-picker").value = d.paintColor;
  $("#face-tool-paint").classList.toggle("is-active", d.tool === "paint");
  $("#face-tool-erase").classList.toggle("is-active", d.tool === "erase");

  // pixel canvas
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
  if (nameEl) {
    nameEl.textContent = (d.designName || "UNTITLED DESIGN").toUpperCase();
    nameEl.style.color = d.color;
  }
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
