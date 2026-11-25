// RANKINGS VIEW: the verified-ledger renderer, metric navigation, scopes,
// pagination and empty/error states for the page and in-game rankings cards.
import { esc } from "./clientDom.js";
import { avatarHTML } from "./clientSprites.js";
import { state } from "./clientState.js";
import { mountResponsiveRankingControls } from "./clientResponsiveSocialSurfaces.js";
import { surfaceCard, tableReturnBarHTML } from "./clientSharedSurfaceBits.js";
import {
  RANKING_LABELS, RANKING_ORDER, rankingDescription, rankingValueLabel,
  rankingsPageSlice, normalizeRankingMetric, leaderboardCurrentRows,
} from "./clientRankingModel.js";

function rankingPosition(metric) {
  const index = Math.max(0, RANKING_ORDER.indexOf(metric));
  return { index, label: `${String(index + 1).padStart(2, "0")} / ${String(RANKING_ORDER.length).padStart(2, "0")}` };
}

export function rankingMetricNavigationHTML(metric) {
  const position = rankingPosition(metric);
  const selected = normalizeRankingMetric(metric);
  const options = RANKING_ORDER.map(value => `<option value="${value}"${value === selected ? " selected" : ""}>${RANKING_LABELS[value]}</option>`).join("");
  return `<div class="ranking-metric-navigation"><label class="ranking-metric-picker"><span class="t-micro ink-3">RANKING METRIC</span><select class="field" data-ranking-metric>${options}</select></label><div class="ranking-stage-controls" role="group" aria-label="Change ranking category"><button class="btn-dark ranking-step" type="button" data-ranking-step="-1" aria-label="Previous ranking category"><span aria-hidden="true">‹</span><span class="sr-only">Previous ranking category</span></button><div class="ranking-position" aria-live="polite"><strong class="t-label f12 g100">${position.label}</strong><span class="t-micro ink-3">METRIC</span></div><button class="btn-dark ranking-step" type="button" data-ranking-step="1" aria-label="Next ranking category"><span aria-hidden="true">›</span><span class="sr-only">Next ranking category</span></button></div></div>`;
}

function rankingSelfBits(currentRows) {
  const selfId = state.account?.account?.id;
  const selfUsername = state.account?.account?.username;
  const selfIndex = selfId || selfUsername
    ? currentRows.findIndex((row) => row.accountId === selfId || row.accountId === selfUsername || row.username === selfUsername)
    : -1;
  const selfRow = selfIndex >= 0 ? currentRows[selfIndex] : null;
  const selfRank = selfRow ? `#${selfIndex + 1}` : "-";
  return { selfRow, selfRank };
}

function rankingSelfTone(selfRow) {
  if (selfRow) return "green";
  return "g-muted";
}

function rankingSelfStat(selfRow) {
  if (!selfRow) return state.account?.account ? "NOT RANKED YET" : "SIGN IN TO TRACK";
  const value = rankingValueLabel(state.leaderboard.metric, selfRow.value);
  return `${value} · ${RANKING_LABELS[state.leaderboard.metric]}`;
}

function scopeLabel() {
  if (state.leaderboard.scope === "month") return "30 DAYS";
  if (state.leaderboard.scope === "friends") return "FRIENDS";
  return "ALL TIME";
}

function generatedLabel() {
  if (leaderboardRefreshing()) return "REFRESHING…";
  if (leaderboardStale()) return "STALE · LAST SYNC";
  return state.leaderboard.generatedAt ? `SYNCED ${new Date(state.leaderboard.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "WAITING FOR SERVER";
}

function leaderboardRefreshing() {
  return state.leaderboard.loading && (state.leaderboard.stale || state.leaderboard.rows?.length);
}

function leaderboardStale() {
  return state.leaderboard.error && state.leaderboard.stale;
}

function rankingsShellClass(pageSurface) {
  if (pageSurface) return "rankings-page-shell is-page";
  return "rankings-page-shell is-modal";
}

function rankingsCloseButton(pageSurface) {
  if (pageSurface) return "";
  return tableReturnBarHTML("rankings-close", "Rankings");
}

function scopesTabs() {
  return [["all", "ALL TIME"], ["month", "30 DAYS"], ["friends", "FRIENDS"]].map(([id, label]) => `<button class="ranking-scope${state.leaderboard.scope === id ? " is-active" : ""}" type="button" data-ranking-scope="${id}" aria-pressed="${state.leaderboard.scope === id}"><span class="t-label f11">${label}</span></button>`).join("");
}

function ledgerEmptyHTML() {
  if (state.leaderboard.loading) {
    const placeholders = Array.from({ length: 4 }, () => `<span class="ranking-loading-row"><span></span><span></span><span></span></span>`).join("");
    return `<div class="social-empty ranking-loading" role="status" aria-live="polite"><p class="t-body ink-2">SYNCING VERIFIED RECORDS…</p><div class="ranking-loading-rows" aria-hidden="true">${placeholders}</div></div>`;
  }
  if (state.leaderboard.error) return rankingErrorHTML(state.leaderboard.error);
  // Every empty ranking says what to do next; the narrower scopes offer the wider ledger as one tap.
  const scope = state.leaderboard.scope;
  if (scope === "friends") {
    return `<div class="social-empty ranking-empty-state"><p class="t-body ink-2">NONE OF YOUR FRIENDS ARE RANKED YET.</p><p class="t-body ink-3">Add friends from the Social tab, or look at everyone.</p><button class="btn-dark" type="button" data-ranking-scope="all"><span class="t-label f11">SHOW ALL-TIME RANKINGS</span></button></div>`;
  }
  if (scope === "month") {
    return `<div class="social-empty ranking-empty-state"><p class="t-body ink-2">NO VERIFIED MATCHES IN THE LAST 30 DAYS.</p><p class="t-body ink-3">Finish a match while signed in to get on this ledger, or look at the all-time view.</p><button class="btn-dark" type="button" data-ranking-scope="all"><span class="t-label f11">SHOW ALL-TIME RANKINGS</span></button></div>`;
  }
  return `<div class="social-empty ranking-empty-state"><p class="t-body ink-2">NO VERIFIED PLAYERS YET.</p><p class="t-body ink-3">Sign in and finish a match to claim the first spot on the ledger.</p></div>`;
}

function rankingErrorHTML(message) {
  return `<div class="social-empty ranking-error" role="alert"><p class="t-body ink-2">${esc(message)}</p><button class="btn-dark" type="button" data-ranking-retry><span class="t-label f11">TRY AGAIN</span></button></div>`;
}

function ledgerStatusHTML() {
  if (state.leaderboard.loading) return `<p class="t-micro ink-3" data-ranking-status aria-live="polite">REFRESHING… LAST VERIFIED SNAPSHOT SHOWN.</p>`;
  if (state.leaderboard.error) return `${rankingErrorHTML(`${state.leaderboard.error} LAST VERIFIED SNAPSHOT SHOWN.`)}`;
  return "";
}

function rankingTrend(row) {
  const trend = row.trend || { direction: "flat", delta: 0 };
  const label = trend.direction === "up" ? "TREND UP" : trend.direction === "down" ? "TREND DOWN" : "TREND FLAT";
  const delta = trend.delta ? ` · ${trend.delta > 0 ? "+" : ""}${trend.delta}` : "";
  return { ...trend, label, delta };
}

function ledgerRowHTML(row, index) {
  const trend = rankingTrend(row);
  const valueClass = state.leaderboard.metric === "rate" ? "g300" : "green";
  const rankClass = index === 0 ? " is-first-place" : index === 1 ? " is-second-place" : index === 2 ? " is-third-place" : "";
  return `<button class="ranking-row${rankClass}" type="button" data-ranking-player="${esc(row.accountId)}"><span class="ranking-place t-label f13">${String(index + 1).padStart(2, "0")}</span><span class="ranking-avatar">${avatarHTML(row, 3, index)}</span><span class="ranking-player"><strong class="t-label f12 g100">${esc(row.displayName)}</strong><span class="t-micro ink-3">@${esc(row.username)} · ${row.games} GAMES · ${row.wins} WINS</span><span class="t-micro ranking-trend ranking-trend-${trend.direction}" aria-label="${trend.label}">${trend.label}${trend.delta}</span></span><strong class="ranking-value t-label f16 ${valueClass}">${rankingValueLabel(state.leaderboard.metric, row.value)}</strong></button>`;
}

function ledgerRowsHTML(currentRows) {
  if (!currentRows.length) return ledgerEmptyHTML();
  const window = rankingsPageSlice(currentRows, state.leaderboard.page);
  state.leaderboard.page = window.page;
  return `${ledgerStatusHTML()}${window.rows.map((row, index) => ledgerRowHTML(row, window.start + index)).join("")}`;
}

function rankingPaginationHTML(currentRows) {
  const window = rankingsPageSlice(currentRows, state.leaderboard.page);
  return `<nav class="ranking-pagination" aria-label="Leaderboard pages"><button class="btn-dark" type="button" data-ranking-page="-1" aria-label="Previous leaderboard page" ${window.page === 0 ? "disabled" : ""}><span class="t-label f11">PREVIOUS</span></button><span class="t-micro ink-3" aria-live="polite">PAGE ${window.page + 1} OF ${window.pageCount} · ${window.total} PLAYERS</span><button class="btn-dark" type="button" data-ranking-page="1" aria-label="Next leaderboard page" ${window.page >= window.pageCount - 1 ? "disabled" : ""}><span class="t-label f11">NEXT</span></button></nav>`;
}

function rankingSearchResultsHTML() {
if (state.rankingSearchLoading) return `<span class="t-micro ink-3" data-ranking-search-status aria-live="polite">SEARCHING…</span>`;
if (state.rankingSearchError) return `<span class="t-micro red" data-ranking-search-status role="alert">${esc(state.rankingSearchError)}</span>`;
return Array.isArray(state.rankingSearchResults) && state.rankingSearchResults.length
    ? state.rankingSearchResults.map((player) => `<button class="ranking-search-result" type="button" data-ranking-player="${esc(player.id)}"><span class="t-label f12 g100">${esc(player.displayName)}</span><span class="t-micro ink-3">@${esc(player.username)}</span><span class="t-label f11 g300">VIEW</span></button>`).join("")
    : state.rankingSearchQuery ? `<span class="t-micro ink-3">NO EXACT USERNAME MATCH.</span>` : "";
}

export function renderRankingsSurface(target = "#rankings-card") {
  const card = surfaceCard(target, "#rankings-card");
  const pickerFocused = card?.querySelector("[data-ranking-metric]") === document.activeElement;
  if (!card) return;
  const pageSurface = card.id === "rankings-page-content";
  const snapshots = state.leaderboard.snapshots || {};
  const currentRows = leaderboardCurrentRows(snapshots);
  const currentPage = rankingsPageSlice(currentRows, state.leaderboard.page);
  state.leaderboard.page = currentPage.page;
  const self = rankingSelfBits(currentRows);
  const selfRank = self.selfRank;
  const selfTone = rankingSelfTone(self.selfRow);
  const selfStat = rankingSelfStat(self.selfRow);
  const scopes = scopesTabs();
  const rows = ledgerRowsHTML(currentRows);
  const syncLabel = generatedLabel();
  const shellClass = rankingsShellClass(pageSurface);
  const closeBtn = rankingsCloseButton(pageSurface);
  const surfaceKey = pageSurface ? "page" : "modal";
  card.innerHTML = `<div class="${shellClass}">${closeBtn}<section class="rankings-hero panel noise"><div class="rankings-hero-mark"><img src="/assets/rankings-podium.svg" alt="" width="32" height="32"></div><div class="rankings-hero-copy"><h2 class="t-section g100" id="rankings-${surfaceKey}-title">Global Rankings</h2><span class="t-micro g400">PARLOR RECORDS · VERIFIED</span><p class="t-body ink-2" id="rankings-${surfaceKey}-description">One clear ledger for the people who keep finishing the table.</p></div><div class="rankings-hero-stats"><div class="rankings-hero-stat"><span class="t-micro ink-3">YOUR RANK</span><strong class="t-label f20 ${selfTone}">${selfRank}</strong><span class="t-micro ink-3">${selfStat}</span></div><div class="rankings-hero-stat"><span class="t-micro ink-3">PLAYERS</span><strong class="t-label f20 g100">${currentRows.length}</strong><span class="t-micro ink-3">VERIFIED ROWS</span></div><div class="rankings-hero-stat"><span class="t-micro ink-3">DATA</span><strong class="t-label f12 g300">${syncLabel}</strong><span class="t-micro ink-3">SERVER SNAPSHOT</span></div></div></section><div class="rankings-search-slot"></div><div class="rankings-main-grid" data-ranking-layout><section class="rankings-stage panel noise" data-ranking-stage tabindex="0" aria-labelledby="rankings-${surfaceKey}-ledger-title"><div class="rankings-stage-head"><div class="rankings-stage-copy"><h3 class="t-section g100" id="rankings-${surfaceKey}-ledger-title">${RANKING_LABELS[state.leaderboard.metric]} standings</h3><p class="t-body ink-2" id="rankings-${surfaceKey}-metric-description" aria-live="polite">${rankingDescription(state.leaderboard.metric)}</p></div></div>${rankingMetricNavigationHTML(state.leaderboard.metric)}<div class="rankings-stage-toolbar"><div class="ranking-scopes" role="toolbar" aria-label="Ranking scope">${scopes}</div><span class="t-micro ink-3 ranking-stage-count" aria-live="polite">${currentRows.length} VERIFIED ROWS · SELECT A METRIC</span></div><div class="ranking-list thin-scroll" role="region" aria-busy="${Boolean(state.leaderboard.loading)}" aria-label="${scopeLabel()} ${RANKING_LABELS[state.leaderboard.metric]} leaderboard">${rows}</div>${rankingPaginationHTML(currentRows)}</section></div></div>`;
  const metricCount = card.querySelector(".ranking-stage-count");
  if (metricCount) metricCount.textContent = `${currentRows.length} VERIFIED ROWS · PAGE ${currentPage.page + 1} OF ${currentPage.pageCount}`;
  mountResponsiveRankingControls(card, { pageSurface, surfaceKey, expanded: state.rankingSearchExpanded, query: state.rankingSearchQuery, results: rankingSearchResultsHTML() });
  if (pickerFocused) card.querySelector("[data-ranking-metric]")?.focus({ preventScroll: true });
}
