/* ============================================================
   SOCIAL SURFACES: friends/rankings/player/rules pages and the
   parlor toast announcer. Server fetches and view switching are
   injected by the entry module; everything else is local DOM.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { avatarHTML, hydrateSprites } from "./clientSprites.js";
import { state } from "./clientState.js";
import { openSurface } from "./clientSurfaces.js";

function noop() {}
let host = { emitServer: noop, showView: noop };

export function configureSocialSurfaces(hooks) {
  host = { ...host, ...hooks };
}


export function announceSocialNotification(n) {
  const kind = notificationKind(n);
  const copy = notificationCopy(n);
  announceToScreenReaders(copy.label, copy.detail, kind.isError);
  const stack = $("#toast-stack");
  if (!stack) return;
  mountParlorToast(stack, kind.kind, copy, kind.isError);
}

function notificationKind(n) {
  const kind = String(n?.kind || "");
  return { kind, isError: kind === "parlor-error" };
}

function notificationCopy(n) {
  const label = String(n?.title || "Parlor Notice").toUpperCase();
  const detail = String(n?.message || n?.body || "").replace(/\s+/g, " ");
  return { label, detail };
}

function announcementText(label, detail) {
  if (!detail) return label;
  return `${label}. ${detail}`;
}

function announceToScreenReaders(label, detail, isError) {
  const text = announcementText(label, detail);
  const systemAnnouncer = $("#system-announcer");
  if (systemAnnouncer) systemAnnouncer.textContent = text;
  if (!isError) return;
  const errorAnnouncer = $("#error-announcer");
  if (errorAnnouncer) errorAnnouncer.textContent = text;
}

function toastClass(kind, isError) {
  const mythical = kind === "mythical-achievement" ? " is-mythical" : "";
  const errorCls = isError ? " is-error" : "";
  return `parlor-toast${mythical}${errorCls}`;
}

function surfaceCard(target, fallback) {
  const card = $(target) || $(fallback);
  if (!card) return null;
  return card;
}

function toastEl(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function toastTitleEl(label, isError) {
  const title = toastEl("strong", "t-label f11 parlor-toast-title");
  if (isError) title.appendChild(toastGlyphEl());
  title.append(document.createTextNode(label));
  return title;
}

function toastGlyphEl() {
  const glyph = toastEl("span", "parlor-toast-glyph");
  glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML = '<svg viewBox="0 0 12 12" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" fill-rule="evenodd" d="M5 1h2l1 2 1 2 1 2 1 2 1 3H0l1-3 1-2 1-2 1-2zM5 4h2v3H5zm0 4h2v2H5z"/></svg>';
  return glyph;
}

function toastBodyEl(detail) {
  const body = toastEl("span", "t-body f12 parlor-toast-body");
  body.textContent = detail;
  return body;
}

function toastDismissEl() {
  const dismiss = toastEl("button", "parlor-toast-close");
  dismiss.type = "button";
  dismiss.tabIndex = -1;
  dismiss.setAttribute("aria-hidden", "true");
  dismiss.textContent = "\u00d7";
  return dismiss;
}

function autoDismissMs(kind, isError) {
  if (isError) return 6500;
  if (kind === "mythical-achievement") return 6500;
  return 4200;
}

function dismissToastLater(toast) {
  if (!toast.isConnected) return;
  if (toast.classList.contains("is-leaving")) return;
  clearTimeout(toast._autoTimer);
  toast.classList.add("is-leaving");
  syncToastStack();
  setTimeout(() => toast.remove(), 160);
}

function trimToastStack(stack) {
  while (stack.children.length > 4) stack.firstElementChild.remove();
}

function mountParlorToast(stack, kind, copy, isError) {
  const toast = toastEl("div");
  toast.className = toastClass(kind, isError);
  const title = toastTitleEl(copy.label, isError);
  const body = toastBodyEl(copy.detail);
  const dismiss = toastDismissEl();
  const dismissToast = () => dismissToastLater(toast);
  toast.append(title, body, dismiss);
  toast.addEventListener("click", dismissToast);
  dismiss.addEventListener("click", (event) => {
    event.stopPropagation();
    dismissToast();
  });
  stack.append(toast);
  trimToastStack(stack);
  syncToastStack();
  toast._autoTimer = setTimeout(dismissToast, autoDismissMs(kind, isError));
}

function syncToastStack() {
  const stack = $("#toast-stack");
  if (!stack) return;
  Array.from(stack.children)
    .filter((toast) => !toast.classList.contains("is-leaving"))
    .forEach((toast, index) => toast.style.setProperty("--toasts-before", String(index)));
}

export function parlorNotice(title, message) {
  announceSocialNotification({ kind: "parlor-error", title, message });
}

export function socialPlayerRowHTML(player, actionLabel = "VIEW") {
  if (!player) return "";
  const id = player.id || player.accountId;
  const mutual = Number(player.mutualFriends) || 0;
  return `<div class="social-player-row"><div class="social-player-avatar">${avatarHTML(player, 3, 0)}</div><div class="social-player-main"><strong class="t-label f12 g100">${esc(player.displayName || player.name || "PLAYER")}</strong><span class="t-micro ink-3">@${esc(player.username || "guest")}${mutual ? ` · ${mutual} MUTUAL` : ""}</span></div><button class="btn-dark social-player-open" type="button" data-social-player="${esc(id)}"><span class="t-label f11">${actionLabel}</span></button></div>`;
}


function socialRoomRosterHTML() {
  const activeRoom = state.phase !== "home" && state.players?.length;
  if (!activeRoom) return `<div class="social-context-empty"><span class="t-micro g400">NO ACTIVE ROOM</span><span class="t-body ink-2">Join a table to see the people currently sharing it.</span></div>`;
  const roster = state.players.filter((player) => player.id !== "p1").slice(0, 8);
  return roster.length ? roster.map((player) => socialPlayerRowHTML({ ...player, id: player.serverId || player.id }, player.bot ? "BOT" : "VIEW")).join("") : `<div class="social-context-empty"><span class="t-micro ink-3">ONLY YOU AT THE TABLE</span></div>`;
}

export function openSocialSurface(tab = "friends") {
  state.socialTab = ["friends", "requests", "invites", "recent", "notifications"].includes(tab) ? tab : "friends";
  host.showView("social");
  renderSocialSurface("#social-page-content");
  socialFetchAndRender("#social-page-content");
}

function listCount(list) {
  return (list || []).length;
}

function unreadCount(social) {
  return (social.notifications || []).filter((item) => !item.readAt).length;
}

function requestsTotal(social) {
  return listCount(social.requests) + listCount(social.invites);
}

function pendingTotal(social) {
  return listCount(social.requests) + listCount(social.outgoing);
}

function tabCount(id, social, count) {
  if (id === "friends") return listCount(social.friends);
  if (id === "requests") return count;
  if (id === "invites") return listCount(social.invites);
  if (id === "recent") return listCount(social.recentPlayers);
  return unreadCount(social);
}

function activeTabLabel(tabs) {
  const found = tabs.find(([id]) => id === state.socialTab);
  return found ? found[1] : "FRIENDS";
}

function socialSearchResultsHTML() {
  const results = state.socialSearchResults || [];
  if (!results.length) return "";
  return results.map((player) => socialPlayerRowHTML(player, "VIEW")).join("");
}

function socialDataAck(response, target) {
  if (response?.success && response.social) {
    state.social = response.social;
    renderSocialSurface(target);
  }
}

function socialFetchAndRender(target) {
  host.emitServer("get-social-data", {}, (response) => socialDataAck(response, target));
}

function leaderboardSnapshotAck(snapshot, target) {
  state.leaderboard.loading = false;
  applyLeaderboardSnapshot(snapshot);
  renderRankingsSurface(target);
}

function requestLeaderboardSnapshot(target) {
  state.leaderboard.loading = true;
  host.emitServer("get-leaderboard-snapshot", { scope: state.leaderboard.scope }, (snapshot) => leaderboardSnapshotAck(snapshot, target));
}

function publicPlayerAck(response) {
  if (response?.success && response.player) {
    state.selectedPlayer = { ...state.selectedPlayer, ...response.player };
    state.selectedPlayerRelationship = response.relationship;
    renderPlayerSurface();
  }
}

function signinBodyHTML() {
  return `<div class="social-signin-note"><span class="t-label f13 g100">ACCOUNT REQUIRED</span><p class="t-body ink-2">Create an account to keep friends, invitations, and social history across rooms.</p><button class="cta-red" type="button" data-social-action="account"><span class="cta-text cta-text-sm">CREATE ACCOUNT</span></button></div>`;
}

function friendsBodyHTML(social) {
  return social.friends?.length ? social.friends.map((player) => socialPlayerRowHTML(player)).join("") : `<p class="t-body ink-3 social-empty">NO FRIENDS YET. Search by username or open someone from the table.</p>`;
}

function requestsBodyHTML(social) {
  const incoming = social.requests?.map((request) => `<div class="social-request-row">${socialPlayerRowHTML(request.from, "VIEW")}<div class="social-request-actions"><button class="cta-red" type="button" data-social-request="accept" data-friendship-id="${esc(request.id)}"><span class="cta-text cta-text-sm">ACCEPT</span></button><button class="btn-dark" type="button" data-social-request="decline" data-friendship-id="${esc(request.id)}"><span class="t-label f11">DECLINE</span></button></div></div>`).join("") || "";
  const outgoing = social.outgoing?.map((request) => `<div class="social-request-row">${socialPlayerRowHTML(request.to, "VIEW")}<div class="social-request-actions"><span class="t-micro ink-3">REQUEST SENT</span><button class="btn-dark" type="button" data-social-request-cancel data-friendship-id="${esc(request.id)}"><span class="t-label f11">CANCEL</span></button></div></div>`).join("") || "";
  return incoming || outgoing ? `${incoming}${outgoing}` : `<p class="t-body ink-3 social-empty">NO PENDING REQUESTS.</p>`;
}

function invitesBodyHTML(social) {
  return social.invites?.length ? social.invites.map((invite) => `<div class="social-invite-row"><div><strong class="t-label f12 g100">${esc(invite.roomName || "AFTER HOURS")}</strong><span class="t-micro ink-3">${String(invite.visibility || "public").toUpperCase()} ROOM · EXPIRES ${esc(String(invite.expiresAt || "").slice(0, 16))}</span></div><div class="social-request-actions"><button class="cta-red" type="button" data-social-invite="accept" data-invite-id="${esc(invite.id)}"><span class="cta-text cta-text-sm">JOIN</span></button><button class="btn-dark" type="button" data-social-invite="decline" data-invite-id="${esc(invite.id)}"><span class="t-label f11">DECLINE</span></button></div></div>`).join("") : `<p class="t-body ink-3 social-empty">NO ROOM INVITES.</p>`;
}

function recentBodyHTML(social) {
  let body = social.recentPlayers?.length       ? social.recentPlayers.map((player) => socialPlayerRowHTML(player, "REVISIT")).join("")       : `<p class="t-body ink-3 social-empty">NO RECENT PLAYERS YET. COMPLETE A MATCH TO BUILD YOUR TABLE HISTORY.</p>`;
  return `<div class="recent-players-wrap"><div class="recent-players-actions"><span class="t-micro ink-3">LAST 30 DAYS · 20 PLAYERS MAX</span><button class="btn-dark" type="button" data-social-clear-recent><span class="t-label f11">CLEAR RECENT</span></button></div>${body}</div>`;
}

function notificationsBodyHTML(social) {
  return social.notifications?.length ? social.notifications.map((notification) => `<div class="social-notification-row${notification.readAt ? "" : " is-unread"}"><div><strong class="t-label f12 g100">${esc(notification.title)}</strong><span class="t-body ink-2">${esc(notification.body)}</span><span class="t-micro ink-3">${esc(String(notification.createdAt || "").slice(0, 16))}</span></div>${notification.readAt ? "" : `<button class="btn-dark" type="button" data-notification-read="${esc(notification.id)}"><span class="t-label f11">READ</span></button>`}</div>`).join("") : `<p class="t-body ink-3 social-empty">NO NOTIFICATIONS.</p>`;
}

function socialTabBody(social, signedIn) {
  if (!signedIn) return signinBodyHTML();
  if (state.socialTab === "friends") return friendsBodyHTML(social);
  if (state.socialTab === "requests") return requestsBodyHTML(social);
  if (state.socialTab === "invites") return invitesBodyHTML(social);
  if (state.socialTab === "recent") return recentBodyHTML(social);
  return notificationsBodyHTML(social);
}

function socialHeroContext(social, pageSurface) {
  const shellClass = pageSurface ? "social-page-shell is-page" : "social-page-shell is-modal";
  const closeBtn = pageSurface ? "" : '<button class="btn-dark social-close" id="social-close" type="button"><span class="t-label f11">CLOSE</span></button>';
  return { shellClass, closeBtn, friendsCount: listCount(social.friends), inboxCount: unreadCount(social) };
}

function socialRailContext(signedIn) {
  const networkLabel = signedIn ? "ACCOUNT SYNC" : "GUEST VIEW";
  const feedSource = signedIn ? "SERVER-SYNCED" : "READ-ONLY SEARCH";
  const phaseLabel = state.phase === "home" ? "NO ROOM" : "IN ROOM";
  return { networkLabel, feedSource, phaseLabel };
}

function socialTableContext() {
  const home = state.phase === "home";
  const roomValue = home ? "—" : esc(state.roomCode || "PUBLIC");
  const seatedValue = home ? "—" : state.players.length;
  return { roomValue, seatedValue };
}

export function renderSocialSurface(target = "#social-card") {
  const card = surfaceCard(target, "#social-card");
  if (!card) return;
  const social = state.social || {};
  const signedIn = Boolean(state.account?.account);
  const pageSurface = card.id === "social-page-content";
  const surfaceKey = pageSurface ? "page" : "modal";
  const tabs = [["friends", "FRIENDS"], ["requests", "REQUESTS"], ["invites", "INVITES"], ["recent", "RECENT"], ["notifications", "INBOX"]];
  const count = requestsTotal(social);
  const pending = pendingTotal(social);
  const body = socialTabBody(social, signedIn);
  const activeLabel = activeTabLabel(tabs);
  const searchResults = socialSearchResultsHTML();
  const searchValue = esc(state.socialSearchQuery || "");
  const hero = socialHeroContext(social, pageSurface);
  const rail = socialRailContext(signedIn);
  const info = socialTableContext();
  card.innerHTML = `<div class="${hero.shellClass}"><section class="social-hero panel noise"><div class="social-hero-mark"><img src="/assets/social-network.svg" alt="" width="32" height="32"></div><div class="social-hero-copy"><span class="t-micro g400">PARLOR SOCIAL · PLAYER INDEX</span><h2 class="t-section g100" id="social-${surfaceKey}-title">People who keep the table moving</h2><p class="t-body ink-2" id="social-${surfaceKey}-description">Find people by their unique username, then manage friends and room invites without leaving the parlor.</p></div><div class="social-hero-stats"><div><span class="t-micro ink-3">FRIENDS</span><strong class="t-label f20 g100">${hero.friendsCount}</strong></div><div><span class="t-micro ink-3">PENDING</span><strong class="t-label f20 g300">${pending}</strong></div><div><span class="t-micro ink-3">INBOX</span><strong class="t-label f20 green">${hero.inboxCount}</strong></div></div>${hero.closeBtn}</section><div class="social-search-band panel noise"><form class="social-search" data-social-search-form id="social-${surfaceKey}-search-form"><label class="social-search-label" for="social-${surfaceKey}-search-input"><span class="t-micro g400">FIND A PLAYER</span><input class="field" id="social-${surfaceKey}-search-input" data-social-search-input name="username" autocomplete="off" placeholder="SEARCH USERNAME…" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" value="${searchValue}" aria-describedby="social-${surfaceKey}-search-help"><span class="t-micro ink-3" id="social-${surfaceKey}-search-help">Unique usernames only · 3–16 characters</span></label><button class="btn-dark social-search-submit" type="submit"><span class="t-label f11">FIND</span></button><div class="social-search-results" data-social-search-results id="social-${surfaceKey}-search-results">${searchResults}</div></form></div><div class="social-network-grid"><aside class="social-network-rail panel noise"><div class="social-rail-head"><span class="t-micro g400">NETWORK</span><span class="t-micro ink-3">${rail.networkLabel}</span></div><nav class="social-rail-nav" role="tablist" aria-label="Social views">${tabs.map(([id, label]) => `<button class="social-tab${state.socialTab === id ? " is-active" : ""}" type="button" role="tab" aria-selected="${state.socialTab === id}" data-social-tab="${id}"><span class="t-label f11">${label}</span><span class="social-tab-count">${tabCount(id, social, count)}</span></button>`).join("")}</nav></aside><section class="social-feed panel noise" aria-labelledby="social-${surfaceKey}-feed-title"><div class="social-feed-head"><div><span class="t-micro g400">ACTIVE FEED</span><h3 class="t-section g100" id="social-${surfaceKey}-feed-title">${activeLabel}</h3></div><span class="t-micro ink-3">${rail.feedSource}</span></div><div class="social-surface-body thin-scroll">${body}</div></section><aside class="social-context panel noise" aria-labelledby="social-${surfaceKey}-context-title"><div class="social-context-head"><div><span class="t-micro g400">TABLE CONTEXT</span><h3 class="t-section g100" id="social-${surfaceKey}-context-title">People nearby</h3></div><span class="t-micro ink-3">${rail.phaseLabel}</span></div><div class="social-context-stats"><div><span class="t-micro ink-3">ROOM</span><strong class="t-label f11 g100">${info.roomValue}</strong></div><div><span class="t-micro ink-3">SEATED</span><strong class="t-label f11 green">${info.seatedValue}</strong></div></div><div class="social-context-roster">${socialRoomRosterHTML()}</div><div class="social-context-foot"><span class="t-micro g400">PRIVACY</span><span class="t-body ink-2">Only public identity and relationship actions are shown here. Cash, loans, and hidden match details stay private.</span></div></aside></div></div>`;
}


export function openInGameSocialSurface(kind) {
  if (!["setup", "lobby", "playing"].includes(state.phase)) return false;
  if (kind === "rankings") {
    renderRankingsSurface("#rankings-card");
    openSurface("#rankings-modal", "#rankings-close");
  } else if (kind === "social") {
    renderSocialSurface("#social-card");
    openSurface("#social-modal", "#social-close");
    socialFetchAndRender("#social-card");
  } else {
    return false;
  }
  return true;
}

function normalizeRankingMetric(metric) {
  const allowed = ["wins", "games", "rate", "achievements", "mythical", "bankruptcies", "events", "auctions", "rent", "casino", "market", "playerloans", "equity", "loans", "patrol"];
  if (allowed.includes(metric)) return metric;
  return "wins";
}

function normalizeRankingScope(scope) {
  const allowed = ["all", "month", "friends"];
  if (allowed.includes(scope)) return scope;
  return "all";
}

function applyLeaderboardSnapshot(snapshot) {
  if (!snapshot?.success) return;
  state.leaderboard.snapshots = snapshot.metrics || {};
  state.leaderboard.generatedAt = snapshot.generatedAt || null;
  state.leaderboard.scope = snapshot.scope || state.leaderboard.scope;
  const rows = state.leaderboard.snapshots[state.leaderboard.metric];
  if (rows) state.leaderboard.rows = rows;
}

export function openRankingsSurface(metric = "wins", scope = state.leaderboard.scope || "all") {
  state.leaderboard.metric = normalizeRankingMetric(metric);
  state.leaderboard.scope = normalizeRankingScope(scope);
  host.showView("rankings");
  renderRankingsSurface("#rankings-page-content");
  requestLeaderboardSnapshot("#rankings-page-content");
}

const RANKING_LABELS = { wins: "WINS", rate: "WIN RATE", games: "GAMES", achievements: "ACHIEVEMENT SCORE", mythical: "MYTHICAL", bankruptcies: "BANKRUPTCIES", events: "EVENT SURVIVAL", auctions: "AUCTION WINS", rent: "RENT COLLECTED", casino: "CASINO NET", market: "MARKET PROFIT", playerloans: "PLAYER LOANS", equity: "EQUITY DEALS", loans: "LOAN DISCIPLINE", patrol: "PATROL BEST" };

function rankingValueLabel(metric, value) {
  if (metric === "rate") return `${Number(value) || 0}%`;
  if (["rent", "casino", "market"].includes(metric)) return `$${(Number(value) || 0).toLocaleString()}`;
  return String(Number(value) || 0);
}

function rankingMetricColumnHTML(metric, rows) {
  const label = RANKING_LABELS[metric];
  const topRows = rows.slice(0, 3);
  return `<section class="ranking-metric-column" aria-labelledby="ranking-column-${metric}"><div class="ranking-column-head"><div><span class="t-micro g400">${label}</span><strong class="t-label f12 g100" id="ranking-column-${metric}">${topRows.length ? `TOP ${topRows.length}` : "NO VERIFIED PLAYERS"}</strong></div><button class="btn-dark ranking-column-action" type="button" data-ranking-metric="${metric}" aria-label="View full ${label.toLowerCase()} ranking"><span class="t-label f11">VIEW</span></button></div><div class="ranking-column-list">${topRows.length ? topRows.map((row, index) => `<button class="ranking-mini-row" type="button" data-ranking-player="${esc(row.accountId)}"><span class="ranking-mini-place">${String(index + 1).padStart(2, "0")}</span><span class="ranking-mini-avatar">${avatarHTML(row, 2, index)}</span><span class="ranking-mini-name"><strong class="t-label f11 g100">${esc(row.displayName)}</strong><span class="t-micro ink-3">@${esc(row.username)}</span></span><strong class="ranking-mini-value t-label f12 ${metric === "rate" ? "g300" : "green"}">${rankingValueLabel(metric, row.value)}</strong></button>`).join("") : `<span class="ranking-column-empty t-micro ink-3">NO VERIFIED DATA</span>`}</div></section>`;
}

function leaderboardCurrentRows(snapshots) {
  const rows = snapshots[state.leaderboard.metric];
  if (rows) return rows;
  return state.leaderboard.rows || [];
}

function columnRows(snapshots, metric, currentRows) {
  const rows = snapshots[metric];
  if (rows) return rows;
  if (metric === state.leaderboard.metric) return currentRows;
  return [];
}

function rankingSelfBits(currentRows) {
  const selfId = state.account?.account?.id;
  const selfIndex = selfId ? currentRows.findIndex((row) => row.accountId === selfId) : -1;
  const selfRow = selfIndex >= 0 ? currentRows[selfIndex] : null;
  const selfRank = selfRow ? `#${selfIndex + 1}` : "—";
  return { selfRow, selfRank };
}

function rankingSelfTone(selfRow) {
  if (selfRow) return "green";
  return "g-muted";
}

function rankingSelfStat(selfRow) {
  if (!selfRow) return "SIGN IN TO TRACK";
  const value = rankingValueLabel(state.leaderboard.metric, selfRow.value);
  return `${value} · ${RANKING_LABELS[state.leaderboard.metric]}`;
}

function scopeLabel() {
  if (state.leaderboard.scope === "month") return "30 DAYS";
  if (state.leaderboard.scope === "friends") return "FRIENDS";
  return "ALL TIME";
}

function generatedLabel() {
  return state.leaderboard.generatedAt ? `SYNCED ${new Date(state.leaderboard.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "WAITING FOR SERVER";
}

function rankingsShellClass(pageSurface) {
  if (pageSurface) return "rankings-page-shell is-page";
  return "rankings-page-shell is-modal";
}

function rankingsCloseButton(pageSurface) {
  if (pageSurface) return "";
  return '<button class="btn-dark social-close" id="rankings-close" type="button"><span class="t-label f11">CLOSE</span></button>';
}

function metricsTabs() {
  return Object.entries(RANKING_LABELS).map(([id, label]) => `<button class="ranking-metric${state.leaderboard.metric === id ? " is-active" : ""}" type="button" data-ranking-metric="${id}" aria-pressed="${state.leaderboard.metric === id}"><span class="t-label f11">${label}</span></button>`).join("");
}

function scopesTabs() {
  return [["all", "ALL TIME"], ["month", "30 DAYS"], ["friends", "FRIENDS"]].map(([id, label]) => `<button class="ranking-scope${state.leaderboard.scope === id ? " is-active" : ""}" type="button" data-ranking-scope="${id}" aria-pressed="${state.leaderboard.scope === id}"><span class="t-label f11">${label}</span></button>`).join("");
}

function ledgerRowsHTML(currentRows) {
  return state.leaderboard.loading ? `<p class="t-body ink-3 social-empty">LOADING VERIFIED RANKINGS…</p>` : currentRows.length ? currentRows.map((row, index) => `<button class="ranking-row" type="button" data-ranking-player="${esc(row.accountId)}"><span class="ranking-place t-label f13">${String(index + 1).padStart(2, "0")}</span><span class="ranking-avatar">${avatarHTML(row, 3, index)}</span><span class="ranking-player"><strong class="t-label f12 g100">${esc(row.displayName)}</strong><span class="t-micro ink-3">@${esc(row.username)} · ${row.games} GAMES · ${row.wins} WINS</span></span><strong class="ranking-value t-label f16 ${state.leaderboard.metric === "rate" ? "g300" : "green"}">${rankingValueLabel(state.leaderboard.metric, row.value)}</strong></button>`).join("") : `<p class="t-body ink-3 social-empty">NO VERIFIED PLAYERS YET.</p>`;
}

function rankingSearchResultsHTML() {
return Array.isArray(state.rankingSearchResults) && state.rankingSearchResults.length
    ? state.rankingSearchResults.map((player) => `<button class="ranking-search-result" type="button" data-ranking-player="${esc(player.id)}"><span class="t-label f12 g100">${esc(player.displayName)}</span><span class="t-micro ink-3">@${esc(player.username)}</span><span class="t-label f11 g300">VIEW</span></button>`).join("")
    : state.rankingSearchQuery ? `<span class="t-micro ink-3">NO EXACT USERNAME MATCH.</span>` : "";
}

export function renderRankingsSurface(target = "#rankings-card") {
  const card = surfaceCard(target, "#rankings-card");
  if (!card) return;
  const pageSurface = card.id === "rankings-page-content";
  const surfaceKey = pageSurface ? "page" : "modal";
  const snapshots = state.leaderboard.snapshots || {};
  const currentRows = leaderboardCurrentRows(snapshots);
  const self = rankingSelfBits(currentRows);
  const selfRank = self.selfRank;
  const selfTone = rankingSelfTone(self.selfRow);
  const selfStat = rankingSelfStat(self.selfRow);
  const metrics = metricsTabs();
  const scopes = scopesTabs();
  const rows = ledgerRowsHTML(currentRows);
  const syncLabel = generatedLabel();
  const shellClass = rankingsShellClass(pageSurface);
  const closeBtn = rankingsCloseButton(pageSurface);
  card.innerHTML = `<div class="${shellClass}"><section class="rankings-hero panel noise"><div class="rankings-hero-mark"><img src="/assets/rankings-podium.svg" alt="" width="32" height="32"></div><div class="rankings-hero-copy"><span class="t-micro g400">PARLOR RECORDS · VERIFIED</span><h2 class="t-section g100" id="rankings-${surfaceKey}-title">Global Rankings</h2><p class="t-body ink-2" id="rankings-${surfaceKey}-description">A wide standings ledger for the people who keep finishing the table.</p></div><div class="rankings-hero-stats"><div class="rankings-hero-stat"><span class="t-micro ink-3">YOUR RANK</span><strong class="t-label f20 ${selfTone}">${selfRank}</strong><span class="t-micro ink-3">${selfStat}</span></div><div class="rankings-hero-stat"><span class="t-micro ink-3">PLAYERS</span><strong class="t-label f20 g100">${currentRows.length}</strong><span class="t-micro ink-3">VERIFIED ROWS</span></div><div class="rankings-hero-stat"><span class="t-micro ink-3">DATA</span><strong class="t-label f12 g300">${syncLabel}</strong><span class="t-micro ink-3">SERVER SNAPSHOT</span></div></div>${closeBtn}</section><section class="rankings-metric-deck" aria-label="Top players across every ranking">${Object.keys(RANKING_LABELS).map((metric) => rankingMetricColumnHTML(metric, columnRows(snapshots, metric, currentRows))).join("")}</section><div class="rankings-main-grid"><section class="rankings-ledger panel noise" aria-labelledby="rankings-${surfaceKey}-ledger-title"><div class="rankings-ledger-head"><div><span class="t-micro g400">FULL PLAYER LEDGER</span><h3 class="t-section g100" id="rankings-${surfaceKey}-ledger-title">${RANKING_LABELS[state.leaderboard.metric]} standings</h3></div><span class="t-micro ink-3">SORTED DESCENDING · ${scopeLabel()}</span></div><div class="ranking-scopes" role="tablist" aria-label="Ranking scope">${scopes}</div><div class="ranking-metrics" role="tablist" aria-label="Primary ranking metric">${metrics}</div><div class="ranking-list thin-scroll">${rows}</div></section><aside class="rankings-context panel noise" aria-labelledby="rankings-${surfaceKey}-context-title"><div class="t-micro g400">HOW TO READ THE LEDGER</div><h3 class="t-section g100" id="rankings-${surfaceKey}-context-title">The table remembers</h3><p class="t-body ink-2">Only completed server rounds count. Win rate needs five completed games; achievement score uses rarity-weighted points. Rankings use verified server records only.</p><div class="rankings-context-list"><div><span class="t-micro ink-3">TIE BREAK</span><strong class="t-label f12 g100">WINS, THEN NAME</strong></div><div><span class="t-micro ink-3">PRIVACY</span><strong class="t-label f12 g100">PUBLIC STATS ONLY</strong></div><div><span class="t-micro ink-3">ECONOMY</span><strong class="t-label f12 g300">OPTIONAL ADD-ONS</strong></div></div><div class="rankings-context-foot"><span class="t-micro g400">DATA WINDOW</span><span class="t-body ink-2">${state.leaderboard.scope === "month" ? "Last 30 days of completed matches." : state.leaderboard.scope === "friends" ? "You and accepted friends only." : "All verified completed matches."}</span></div></aside></div></div>`;
  const rankingResults = rankingSearchResultsHTML();
  const rankingSearch = document.createElement("section");
  rankingSearch.className = "rankings-search-band panel noise";
  rankingSearch.innerHTML = `<form class="rankings-search" data-ranking-search-form><label class="rankings-search-label" for="rankings-${surfaceKey}-search"><span class="t-micro g400">FIND A PLAYER</span><input class="field" id="rankings-${surfaceKey}-search" data-ranking-search-input autocomplete="off" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" placeholder="EXACT USERNAME…" value="${esc(state.rankingSearchQuery || "")}"><span class="t-micro ink-3">Exact username lookup · public identity only</span></label><button class="btn-dark rankings-search-submit" type="submit"><span class="t-label f11">FIND</span></button><div class="rankings-search-results">${rankingResults}</div></form>`;
  card.querySelector(".rankings-hero")?.insertAdjacentElement("afterend", rankingSearch);
}

const RULES_SECTIONS = [
  {
    id: "start-here",
    label: "START HERE",
    kicker: "01 · QUICK BRIEF",
    title: "One table. Forty spaces. Last wallet standing.",
    status: "LIVE",
    summary: "Poorup is a real-time property game for two to four players. Roll, move clockwise, make the next legal decision, and keep the table moving.",
    content: `<div class="rules-callout"><strong class="t-label f13 g100">THE SHORT VERSION</strong><p class="t-body ink-2">Start on GO at space 0. Salvador is space 1. Every player takes a turn in order. Buy useful property, charge rent, manage cash, and survive the table longer than everyone else.</p></div><h3 class="t-section g300">A complete turn</h3><ol class="rules-steps"><li><span class="rules-step-number">01</span><div><strong class="t-label f12 g100">ROLL</strong><p class="t-body ink-2">The active player rolls the dice once. The server moves the token one space at a time.</p></div></li><li><span class="rules-step-number">02</span><div><strong class="t-label f12 g100">RESOLVE</strong><p class="t-body ink-2">Resolve the landed space, card, rent, tax, purchase, auction, or prison rule before ending the turn.</p></div></li><li><span class="rules-step-number">03</span><div><strong class="t-label f12 g100">CHOOSE</strong><p class="t-body ink-2">Buy, build, mortgage, trade, accept a loan, place a legal market action, or pass when the game allows it.</p></div></li><li><span class="rules-step-number">04</span><div><strong class="t-label f12 g100">END</strong><p class="t-body ink-2">Press End Turn only after every required decision is complete. The next player then becomes active.</p></div></li></ol><div class="rules-inline-note"><span class="t-micro g400">SOURCE OF TRUTH</span><span class="t-body ink-2">The server owns balances, movement, ownership, event outcomes, and settlement. The browser renders the latest snapshot.</span></div>`,
  },
  {
    id: "board-tiles",
    label: "BOARD & TILES",
    kicker: "02 · THE MAP",
    title: "Read the board clockwise",
    status: "LIVE",
    summary: "The board has forty spaces. The visual order and server index are the same, starting at GO space 0 and moving right across the top edge.",
    content: `<div class="rules-board-order"><div><span class="t-micro g400">CLOCKWISE INDEX</span><strong class="t-label f20 g100">0 → 39</strong></div><div><span class="t-micro g400">CORNERS</span><strong class="t-label f12 g100">GO · PASSING BY / PRISON · VACATION · GO TO PRISON</strong></div></div><h3 class="t-section g300">Space families</h3><div class="rules-term-grid"><div><strong class="t-label f12 g100">PROPERTY</strong><p class="t-body ink-2">Buy deeds, collect rent, build evenly, and group properties by their color strip.</p></div><div><strong class="t-label f12 g100">SUPPORT</strong><p class="t-body ink-2">Airports, Electric Company, and Water Company use their own settlement rules.</p></div><div><strong class="t-label f12 g100">CARD</strong><p class="t-body ink-2">Surprise and Treasure draw from separate decks. Each card resolves on the server.</p></div><div><strong class="t-label f12 g100">TAX</strong><p class="t-body ink-2">Earnings Tax and Premium Tax remove cash. The active event can add a disclosed modifier.</p></div><div><strong class="t-label f12 g100">CORNER</strong><p class="t-body ink-2">GO pays on passage, Passing By has an outside lane and prison lane, Vacation uses the optional pool, and Go to Prison sends you to prison.</p></div><div><strong class="t-label f12 g100">NEUTRAL</strong><p class="t-body ink-2">Treasure, Surprise, and Vacation do not belong to a country group.</p></div></div>`,
  },
  {
    id: "turn-flow",
    label: "TURN FLOW",
    kicker: "03 · TABLE RHYTHM",
    title: "The next legal action is always the priority",
    status: "LIVE",
    summary: "Poorup uses a small state machine so movement never skips a purchase, card, auction, or payment decision.",
    content: `<div class="rules-code-flow"><span>ROLL</span><i>→</i><span>MOVE</span><i>→</i><span>LAND</span><i>→</i><span>RESOLVE</span><i>→</i><span>END TURN</span></div><h3 class="t-section g300">Blocking decisions</h3><ul class="rules-bullets"><li>A purchase decision must be accepted, passed, or sent to auction before the turn can end.</li><li>A card choice, debt payment, trade confirmation, or bankruptcy decision temporarily owns the focus.</li><li>Only the active player can roll or perform turn-scoped actions. The server rejects stale or out-of-turn requests.</li><li>The turn timer, when enabled, advances through the same legal resolution path rather than skipping settlement.</li></ul><div class="rules-inline-note"><span class="t-micro g400">ROUND</span><span class="t-body ink-2">A round completes when every active player has received one turn. Global-event timing uses this round counter.</span></div>`,
  },
  {
    id: "cash-bank",
    label: "CASH & BANK",
    kicker: "04 · THE LEDGER",
    title: "Every dollar has a reason",
    status: "LIVE",
    summary: "Cash is server-authoritative. The bank pays rewards, collects taxes, settles purchases, and records every important transfer in the log.",
    content: `<h3 class="t-section g300">Cash rules</h3><ul class="rules-bullets"><li>Each player starts with the lobby's Starting Cash value.</li><li>Passing GO pays $200. Landing exactly on GO pays the configured Double GO amount when enabled.</li><li>Cash can move through rent, cards, taxes, prizes, trades, loans, builds, mortgages, and the Vacation pool.</li><li>Payments settle atomically. If available cash is insufficient, the game opens the legal debt or bankruptcy path instead of silently going negative.</li></ul><h3 class="t-section g300">Vacation pool</h3><p class="t-body ink-2">When Vacation Pool is on, configured taxes and penalties feed the center pool. Landing on Vacation claims the pool. The setting does not change the tile order or movement index.</p><div class="rules-warning"><span class="t-micro red">DO NOT ASSUME</span><span class="t-body ink-2">A visual cash number is not a permission to spend. The server checks current cash again when an action settles.</span></div>`,
  },
  {
    id: "properties",
    label: "PROPERTIES",
    kicker: "05 · DEEDS",
    title: "Build a group, then make it work",
    status: "LIVE",
    summary: "Properties are grouped by their color strip. The strip is the association; the name, price, and rotation are presentation only.",
    content: `<h3 class="t-section g300">Buying</h3><p class="t-body ink-2">When you land on an unowned property, you can buy it at the printed price. If Auction is on and you pass, the deed can go to a server-run auction.</p><h3 class="t-section g300">Rent</h3><ul class="rules-bullets"><li>Rent depends on the deed, group ownership, and building level.</li><li>Owning every deed in a group activates the group's monopoly multiplier.</li><li>Mortgaged deeds do not collect normal rent until redeemed.</li><li>No Rent In Jail prevents an owner in prison from collecting rent during the configured turn.</li></ul><h3 class="t-section g300">Building</h3><p class="t-body ink-2">Build evenly across a complete group. Houses use the shared house bank. Four houses can become a hotel when a hotel is available. House and hotel limits are lobby settings.</p>`,
  },
  {
    id: "support-spaces",
    label: "SUPPORT SPACES",
    kicker: "06 · AIRPORTS & UTILITIES",
    title: "Support tiles amplify the table",
    status: "LIVE",
    summary: "Airports and utilities are independent support tiles. They are not country properties and do not change the board's physical dimensions.",
    content: `<div class="rules-term-grid"><div><strong class="t-label f12 g100">AIRPORTS</strong><p class="t-body ink-2">ACC, BKK, AMS, and MB Airport are separate deeds priced at $200. Airport effects and rent are resolved by the server.</p></div><div><strong class="t-label f12 g100">ELECTRIC COMPANY</strong><p class="t-body ink-2">A utility deed whose charge is calculated from the dice result and ownership state.</p></div><div><strong class="t-label f12 g100">WATER COMPANY</strong><p class="t-body ink-2">A utility deed with the same support-tile settlement contract and its own printed price.</p></div><div><strong class="t-label f12 g100">COLOR STRIPS</strong><p class="t-body ink-2">Only property strips define country groups. Airports and utilities never inherit a country group.</p></div></div>`,
  },
  {
    id: "cards",
    label: "SURPRISE & TREASURE",
    kicker: "07 · CARD DECKS",
    title: "A draw is a decision, not decoration",
    status: "LIVE",
    summary: "Surprise and Treasure are separate decks with classic-style movement, cash, repairs, jail, and player interaction effects.",
    content: `<h3 class="t-section g300">When a card appears</h3><p class="t-body ink-2">Landing on Surprise draws from the Surprise deck. Landing on Treasure draws from the Treasure deck. The server removes the card, resolves its action, and records the result.</p><h3 class="t-section g300">Card result patterns</h3><ul class="rules-bullets"><li>Move to a named space, with GO payment when the move passes GO.</li><li>Collect or pay a cash amount.</li><li>Collect from every player or pay every player.</li><li>Pay a repair amount per house or hotel based on your current buildings.</li><li>Go directly to prison or receive a Get Out of Prison card.</li><li>Return the card to the bottom of its deck after settlement.</li></ul><div class="rules-inline-note"><span class="t-micro g400">RESULT COPY</span><span class="t-body ink-2">Dynamic card results show the actual amount paid or received, not only the card's formula.</span></div>`,
  },
  {
    id: "trade-auction",
    label: "TRADES & AUCTIONS",
    kicker: "08 · NEGOTIATION",
    title: "Make deals without losing the ledger",
    status: "LIVE",
    summary: "Trading is player-driven, while auctions are server-timed. Both systems lock the assets they are settling before cash changes hands.",
    content: `<h3 class="t-section g300">Trades</h3><ul class="rules-bullets"><li>Trading must be enabled in the room settings.</li><li>Choose deeds and cash, send the offer, and wait for the recipient's decision.</li><li>Both players must still own the offered deeds and have the offered cash when accepted.</li><li>Houses and hotels must be resolved according to the deed rules before a property can move.</li></ul><h3 class="t-section g300">Auctions</h3><ul class="rules-bullets"><li>An auction starts when a buyer passes an unowned deed and Auction is enabled.</li><li>Players bid with available cash. The timer and leading bid are visible to the table.</li><li>The winner pays the final bid atomically or the server advances to the next valid bidder.</li><li>Disconnects and late bids cannot create a second winner.</li></ul>`,
  },
  {
    id: "build-mortgage",
    label: "BUILD & MORTGAGE",
    kicker: "09 · ASSET CONTROL",
    title: "Liquidity has a cost",
    status: "LIVE",
    summary: "Build when a group is complete and mortgage only when you understand the recovery cost. The deed manager keeps both actions visible.",
    content: `<h3 class="t-section g300">Houses and hotels</h3><p class="t-body ink-2">Construction is even across a group, limited by the shared bank, and blocked when a global event freezes building. A hotel replaces four houses on the same deed.</p><h3 class="t-section g300">Mortgage</h3><ul class="rules-bullets"><li>Mortgage releases emergency cash but disables normal rent.</li><li>Redeeming a mortgage costs the mortgage value plus the configured interest.</li><li>Bank-loan collateral locks cannot be mortgaged or traded until the loan is settled.</li><li>Bankruptcy settlement liquidates or transfers assets through the server's declared order.</li></ul>`,
  },
  {
    id: "prison-vacation",
    label: "PRISON & CORNERS",
    kicker: "10 · CORNER RULES",
    title: "Passing by is two lanes in one corner",
    status: "LIVE",
    summary: "The Passing By / Prison corner is one board space with an outside lane and an interior prison lane. Landing on it and passing it are different outcomes.",
    content: `<div class="rules-callout"><strong class="t-label f13 g100">PASSING BY LANE</strong><p class="t-body ink-2">A player who simply passes the corner continues around the outside lane. They are not in prison.</p><strong class="t-label f13 g100">PRISON LANE</strong><p class="t-body ink-2">A player sent to prison or landing on the prison area is shown inside the bars. Their movement and rent rules follow the prison state.</p></div><h3 class="t-section g300">Leaving prison</h3><ul class="rules-bullets"><li>Pay the configured fine.</li><li>Use a Get Out of Prison card.</li><li>Roll the required doubles path when the rules allow it.</li></ul><p class="t-body ink-2">Go to Prison sends the player directly to prison without collecting a passage reward. Vacation is a neutral corner and can hold the optional pool.</p>`,
  },
  {
    id: "loans",
    label: "LOANS & BANKRUPTCY",
    kicker: "11 · FINANCING",
    title: "Borrow only when the table can carry it",
    status: "LIVE",
    summary: "Player loans and bank loans are separate contracts. Both are recorded, visible, and resolved before a player can quietly spend beyond their means.",
    content: `<h3 class="t-section g300">Bank loans</h3><ul class="rules-bullets"><li>Bank loans are optional and use a maturity date, premium, and collateral lock.</li><li>Collateral cannot be traded or mortgaged while pledged.</li><li>Global events may add a disclosed surcharge or pause new offers, but cannot rewrite a settled payment.</li><li>Default enters the server bankruptcy path and liquidates the declared collateral.</li></ul><h3 class="t-section g300">Player loans</h3><p class="t-body ink-2">A player-to-player loan or equity deal is a social contract recorded in the room history. The server validates the transfer, but players negotiate the terms.</p><h3 class="t-section g300">Bankruptcy</h3><p class="t-body ink-2">Elimination removes a busted player from the active turn order. Debt Deal mode can transfer assets and keep the player in the table when the room setting allows it.</p>`,
  },
  {
    id: "global-events",
    label: "GLOBAL EVENTS",
    kicker: "12 · HEADLINES",
    title: "Rare headlines change the weather",
    status: "LIVE",
    summary: "Global Events are optional, server-authoritative, and shared by the whole table. They scale with round progress instead of exposing a pile of tuning sliders.",
    content: `<h3 class="t-section g300">Lifecycle</h3><div class="rules-code-flow"><span>ELIGIBLE</span><i>→</i><span>WARNING</span><i>→</i><span>ACTIVE</span><i>→</i><span>RECOVERY</span><i>→</i><span>ENDED</span></div><ul class="rules-bullets"><li>Early rounds establish the economy. Negative crises are not eligible immediately.</li><li>A warning appears before a negative modifier activates.</li><li>One event normally runs at a time. Curated combinations are capped and named.</li><li>Duration, rarity, and severity derive from round progress and event tier.</li><li>The banner, event log, and reconnect snapshot show the same remaining-round count.</li></ul><h3 class="t-section g300">What events can touch</h3><p class="t-body ink-2">Events may affect rent, construction, taxes, loans, support tiles, casino limits, market prices, volatility, and recovery. They never silently change a committed transaction.</p><div class="rules-warning"><span class="t-micro red">FAIRNESS RULE</span><span class="t-body ink-2">A casino event can change a disclosed limit or fee. It cannot secretly change the red, black, or green odds.</span></div>`,
  },
  {
    id: "casino-market",
    label: "CASINO & MARKET",
    kicker: "13 · ECONOMY ADD-ONS",
    title: "Optional systems, clearly marked",
    status: "LIVE",
    summary: "The Casino and fictional Market are optional, server-settled room add-ons. They use board money only and remain off in classic rooms.",
    content: `<h3 class="t-section g300">Casino</h3><p class="t-body ink-2">European roulette uses red, black, and green/0 with fixed disclosed odds. It uses fictional board money only. Bets are escrowed, resolved once by the server, and logged. Players cannot use loan-funded cash for wagers.</p><h3 class="t-section g300">Market</h3><p class="t-body ink-2">The fictional exchange starts with country, airport, utilities, and property indexes. Players buy and sell without margin, shorting, options, or real-world securities. Prices update at round boundaries and event settlement.</p><h3 class="t-section g300">Shared guardrails</h3><ul class="rules-bullets"><li>Both systems are OFF by default in classic rooms.</li><li>Global Events can alter limits, fees, prices, and volatility, not hidden casino odds.</li><li>Transactions use server idempotency keys so retries cannot duplicate money.</li><li>Positions and bets appear in match history as aggregate results, without exposing other players' private details.</li></ul><div class="rules-planned"><span class="t-micro g400">OPTIONAL · VIRTUAL ECONOMY ONLY</span><span class="t-body ink-2">No deposits, withdrawals, cash-out, or cash-value prizes are part of this design.</span></div>`,
  },
  {
    id: "bots",
    label: "BOTS",
    kicker: "14 · DECISIONS",
    title: "CPU seats follow the same contracts",
    status: "LIVE",
    summary: "Bots are reserved seats in the lobby and use the same server rules as human players. They are not allowed to bypass turn gates or money checks.",
    content: `<ul class="rules-bullets"><li>Bots buy, pass, build, mortgage, trade, and bid according to a bounded risk profile.</li><li>A bot preserves a cash buffer for rent, taxes, and known obligations.</li><li>Bots never borrow money to gamble and cannot see private player information.</li><li>Bot decisions are resolved through the same action events, making them visible in the log and replayable in tests.</li><li>Future AI decision providers remain behind a deterministic fallback so a provider outage cannot stall a table.</li></ul>`,
  },
  {
    id: "social-profile",
    label: "SOCIAL & PROFILES",
    kicker: "15 · PARLOR PEOPLE",
    title: "Stay in the table while you connect",
    status: "LIVE",
    summary: "Social and profile surfaces are independent top-level pages, while in-game player cards keep friend actions inside the game shell.",
    content: `<h3 class="t-section g300">Profiles</h3><p class="t-body ink-2">A profile contains public identity, selected design, statistics, match history, and achievements. Passwords and private account data never appear on another player's public card.</p><h3 class="t-section g300">Friends</h3><ul class="rules-bullets"><li>Search uses the unique username, not the display name.</li><li>Friend requests, blocks, reports, and room invites are server records.</li><li>Clicking an in-game player opens a read-only card with social actions. The player stays in the lobby or round.</li><li>Match history is private to its owner and accepted friends by default; the owner can opt into a public summary.</li></ul><h3 class="t-section g300">Rankings</h3><p class="t-body ink-2">Rankings are global, read-only projections of completed server games, wins, five-game-qualified win rate, rarity-weighted achievement score, loan discipline, and bankruptcies.</p>`,
  },
  {
    id: "achievements",
    label: "ACHIEVEMENTS",
    kicker: "16 · RECORDS",
    title: "Badges remember the strange plays",
    status: "LIVE",
    summary: "Achievements are grouped by tablecraft, global events, social play, secrets, and Patrol. Mythical achievements are rare and announced globally.",
    content: `<ul class="rules-bullets"><li>Click an achievement to open its readable detail dialog.</li><li>Filter by category, when earned, and rarity without leaving the Profile page.</li><li>Rarity uses text and color: Common, Uncommon, Rare, Epic, Legendary, and Mythical.</li><li>Mythical unlocks create one generic server-wide announcement for every currently connected player. The title stays private until the owner reveals it.</li><li>Achievement progress is never a hidden cash requirement and does not change the rules of a live match.</li></ul>`,
  },
  {
    id: "lobby-settings",
    label: "LOBBY SETTINGS",
    kicker: "17 · HOST CONTROL",
    title: "Every switch has a consequence",
    status: "LIVE",
    summary: "Hosts configure the table before the first round. The active rules snapshot stays visible in the lobby so nobody has to guess what changed.",
    content: `<div class="rules-settings-table"><div><strong class="t-label f12 g100">Max Players</strong><span class="t-body ink-2">2–4 seats at the table.</span></div><div><strong class="t-label f12 g100">Bots</strong><span class="t-body ink-2">Reserve CPU seats up to the available capacity.</span></div><div><strong class="t-label f12 g100">Starting Cash</strong><span class="t-body ink-2">Bank handout when the round begins.</span></div><div><strong class="t-label f12 g100">Room Visibility</strong><span class="t-body ink-2">Public tables are joined from the directory and do not expose an invite code. Private tables use a six-character code.</span></div><div><strong class="t-label f12 g100">Vacation Pool</strong><span class="t-body ink-2">Taxes feed the Vacation pool when on.</span></div><div><strong class="t-label f12 g100">Double GO</strong><span class="t-body ink-2">Landing exactly on GO pays the configured bonus.</span></div><div><strong class="t-label f12 g100">Trading</strong><span class="t-body ink-2">Allow player-to-player offers.</span></div><div><strong class="t-label f12 g100">Auction</strong><span class="t-body ink-2">Send passed unowned deeds to auction.</span></div><div><strong class="t-label f12 g100">No Rent In Jail</strong><span class="t-body ink-2">Stop an imprisoned owner collecting rent that turn.</span></div><div><strong class="t-label f12 g100">Bank Loans</strong><span class="t-body ink-2">Allow emergency bank credit with collateral.</span></div><div><strong class="t-label f12 g100">Loan Severity</strong><span class="t-body ink-2">Fair, Predatory, or Extreme premium tier.</span></div><div><strong class="t-label f12 g100">Global Events</strong><span class="t-body ink-2">A single ON/OFF switch. The server derives rarity, duration, and severity from round progress.</span></div><div><strong class="t-label f12 g100">House / Hotel Limit</strong><span class="t-body ink-2">Shared bank supply for construction.</span></div><div><strong class="t-label f12 g100">Turn Timer</strong><span class="t-body ink-2">Off, 30 seconds, 60 seconds, or 2 minutes.</span></div><div><strong class="t-label f12 g100">Bankruptcy</strong><span class="t-body ink-2">Eliminate a busted player or resolve a debt deal.</span></div></div>`,
  },
  {
    id: "reconnect-accessibility",
    label: "RECONNECT & ACCESS",
    kicker: "18 · TRUST",
    title: "The table should survive the real world",
    status: "LIVE",
    summary: "Poorup is designed for a remote game night: reconnects, clear announcements, keyboard navigation, and reduced motion are part of the rules surface.",
    content: `<h3 class="t-section g300">Reconnect</h3><p class="t-body ink-2">A reconnect receives the latest server snapshot, room membership, turn stage, open obligation, event banner, and player appearance. It does not replay settled cash or card transactions.</p><h3 class="t-section g300">Accessibility</h3><ul class="rules-bullets"><li>All actions use native buttons, links, inputs, or selects.</li><li>Focus rings remain visible and blocking surfaces manage keyboard focus.</li><li>State is not communicated by color alone. Labels, symbols, and status text accompany color.</li><li>Reduced-motion preferences disable decorative movement while preserving state changes.</li><li>Audio effects and music are independent, global toggles with accessible names.</li></ul>`,
  },
];

function rulesSectionById(id) {
  return RULES_SECTIONS.find((section) => section.id === id) || RULES_SECTIONS[0];
}

export function openRulesSurface(section = "start-here") {
  state.rulesSection = rulesSectionById(section).id;
  host.showView("rules");
  renderRulesSurface("#rules-page-content");
  requestAnimationFrame(() => {
    const target = $("#rules-book-page-scroll");
    const heading = $("#rules-book-page-heading");
    if (!target) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    heading?.focus({ preventScroll: true });
  });
}

function rulesQuery() {
  return String(state.rulesQuery || "").trim().toLowerCase();
}

function sectionMatches(section, query) {
  if (!query) return true;
  const text = [section.label, section.title, section.summary, section.content].join(" ").toLowerCase();
  return text.includes(query);
}

function resolveActiveSection(requested, filteredSections, query) {
  if (sectionMatches(requested, query)) return requested;
  return filteredSections[0] || null;
}

function previousSection(activeIndex) {
  if (activeIndex <= 0) return null;
  return RULES_SECTIONS[activeIndex - 1];
}

function nextSection(activeIndex) {
  const last = RULES_SECTIONS.length - 1;
  if (activeIndex < 0) return null;
  if (activeIndex >= last) return null;
  return RULES_SECTIONS[activeIndex + 1];
}

function rulesPrevNav(previous) {
  const id = previous?.id || "";
  const disabled = previous ? "" : "disabled";
  const label = previous ? `PREVIOUS · ${previous.label}` : "FIRST CHAPTER";
  return { id, disabled, label };
}

function rulesNextNav(next) {
  const id = next?.id || "";
  const disabled = next ? "" : "disabled";
  const label = next ? `NEXT · ${next.label}` : "LAST CHAPTER";
  return { id, disabled, label };
}

function rulesArticleHTML(active, activeIndex, prevNav, nextNav) {
  return `<article class="rules-book-page noise" aria-labelledby="rules-book-page-heading"><div class="rules-book-page-scroll thin-scroll" id="rules-book-page-scroll"><div class="rules-article-head"><div><span class="t-micro g400">${active.kicker}</span><h2 class="t-section g100" id="rules-book-page-heading" tabindex="-1">${active.title}</h2><p class="t-body ink-2 rules-article-summary">${active.summary}</p></div><div class="rules-article-meta"><span class="rules-status rules-status-${active.status.toLowerCase()}">${active.status}</span><span class="t-micro ink-3">${String(activeIndex + 1).padStart(2, "0")} / ${String(RULES_SECTIONS.length).padStart(2, "0")}</span></div></div><div class="rules-article-body">${active.content}</div></div><footer class="rules-book-page-footer"><button class="btn-dark rules-page-turn" type="button" data-rules-section="${prevNav.id}" ${prevNav.disabled} aria-label="Previous chapter"><span aria-hidden="true">‹</span><span class="t-label f11">${prevNav.label}</span></button><span class="t-micro ink-3">CHAPTER ${String(activeIndex + 1).padStart(2, "0")} · FIELD MANUAL</span><button class="btn-dark rules-page-turn" type="button" data-rules-section="${nextNav.id}" ${nextNav.disabled} aria-label="Next chapter"><span class="t-label f11">${nextNav.label}</span><span aria-hidden="true">›</span></button></footer></article>`;
}

function rulesEmptyArticleHTML() {
  return `<article class="rules-book-page"><div class="rules-book-page-scroll"><div class="rules-empty"><span class="t-micro g400">NO MATCH IN THIS MANUAL</span><strong class="t-label f13 g100">Try another phrase.</strong></div></div></article>`;
}

function indexLinkClasses(section, active, query) {
  const selected = section.id === active?.id ? " is-active" : "";
  const filtered = sectionMatches(section, query) ? "" : " is-filtered";
  return `${selected}${filtered}`;
}

function indexAriaCurrent(section, active) {
  if (section.id === active?.id) return "page";
  return "false";
}

export function renderRulesSurface(target = "#rules-page-content") {
  const root = $(target);
  if (!root) return;
  const query = rulesQuery();
  const filteredSections = RULES_SECTIONS.filter((section) => sectionMatches(section, query));
  const requested = rulesSectionById(state.rulesSection);
  const active = resolveActiveSection(requested, filteredSections, query);
  if (active) state.rulesSection = active.id;
  const activeIndex = active ? RULES_SECTIONS.findIndex((section) => section.id === active.id) : -1;
  const previous = previousSection(activeIndex);
  const next = nextSection(activeIndex);
  const prevNav = rulesPrevNav(previous);
  const nextNav = rulesNextNav(next);
  const article = active ? rulesArticleHTML(active, activeIndex, prevNav, nextNav) : rulesEmptyArticleHTML();
  const searchValue = esc(state.rulesQuery || "");
  root.innerHTML = `<div class="rules-shell">
    <div class="rules-intro panel noise">
      <div class="rules-intro-icon"><img src="/assets/rules-book.svg" alt="" width="36" height="36"></div>
      <div class="rules-intro-copy"><div class="t-micro g400">AFTER-HOURS FIELD MANUAL</div><h1 class="t-section g100" id="rules-page-title">Poorup Rules</h1><p class="t-body ink-2">A readable guide to the board, the economy, the people, and the systems that keep a table fair.</p></div>
      <div class="rules-intro-meta"><span class="t-micro ink-3">REFERENCE BUILD</span><strong class="t-label f12 g100">v2.4 · LIVE CONTRACTS</strong></div>
    </div>
    <div class="rules-toolbar panel noise" role="search"><label class="rules-search-label" for="rules-search"><span class="t-micro g400">FIND IN RULES</span><input class="field" id="rules-search" type="search" value="${searchValue}" placeholder="SEARCH THE FIELD MANUAL…" autocomplete="off"></label><span class="t-micro ink-3 rules-search-count" id="rules-search-count">${filteredSections.length} SECTIONS</span></div>
    <div class="rules-book-spread">
      <aside class="rules-index panel noise" aria-label="Rules sections"><div class="rules-index-head"><span class="t-micro g400">CONTENTS</span><span class="t-micro ink-3">${RULES_SECTIONS.length} CHAPTERS</span></div><nav class="rules-index-nav" aria-label="Rules chapters">${RULES_SECTIONS.map((section, index) => `<button class="rules-index-link${indexLinkClasses(section, active, query)}" type="button" data-rules-section="${section.id}" aria-current="${indexAriaCurrent(section, active)}"><span class="rules-index-number">${String(index + 1).padStart(2, "0")}</span><span>${section.label}</span><span class="rules-status rules-status-${section.status.toLowerCase()}">${section.status}</span></button>`).join("")}</nav></aside>
      ${article}
    </div>
  </div>`;
  hydrateSprites(root);
  const count = root.querySelector("#rules-search-count");
  if (count) count.textContent = `${filteredSections.length} SECTIONS`;
}

export function openPlayerSurface(playerId) {
  const player = state.players.find((candidate) => String(candidate.serverId || candidate.id) === String(playerId));
  state.selectedPlayer = player ? { ...player } : { id: playerId, accountId: playerId, displayName: "PLAYER", color: "#cfa75f" };
  state.selectedPlayerRelationship = "none";
  state.selectedPlayerView = "profile";
  state.selectedPlayerHistory = null;
  state.selectedPlayerHistoryScope = "all";
  renderPlayerSurface();
  openSurface("#player-modal", "#player-modal-close");
  if (state.selectedPlayer.accountId) {
    host.emitServer("get-public-player-card", { accountId: state.selectedPlayer.accountId }, publicPlayerAck);
  }
}

function historyScopeMatch(entry, scope) {
  if (scope === "global") return globalEventRow(entry);
  if (scope === "with-me") return sharedRowWithViewer(entry);
  return true;
}

function globalEventRow(entry) {
  if (!Array.isArray(entry.globalEvents)) return false;
  return entry.globalEvents.length > 0;
}

function viewerAccountId() {
  return state.account?.account?.id || "__owner__";
}

function sharedRowWithViewer(entry) {
  if (!Array.isArray(entry.participants)) return false;
  const viewer = viewerAccountId();
  return entry.participants.some((item) => item.sharedWithViewer === true || item.accountId === viewer);
}

function historyParticipant(entry, player) {
  if (!Array.isArray(entry.participants)) return null;
  const id = player.accountId || player.id;
  return entry.participants.find((item) => item.isViewedPlayer === true || item.accountId === id) || null;
}

function historyRowWon(participant, entry) {
  if (participant) return participant.finalPlacement === 1;
  if (entry.won === true) return true;
  return entry.result === 'WIN';
}

function historyRowDate(entry) {
  return String(entry.completedAt || entry.playedAt || '').slice(0, 10) || 'UNKNOWN DATE';
}

function historyRowDeeds(participant, entry) {
  if (participant?.propertyCount != null) return participant.propertyCount;
  if (entry.properties != null) return entry.properties;
  return 0;
}

function playerHistoryMetaHTML(participants, deeds, events, combos) {
  const eventsTone = events ? 'g300' : 'ink-3';
  const combosTone = combos ? 'g300' : 'ink-3';
  return '<div class="player-history-meta"><span class="t-micro ink-3">' + participants + ' PLAYERS</span><span class="t-micro ink-3">' + deeds + ' DEEDS</span><span class="t-micro ' + eventsTone + '">' + events + ' EVENTS</span><span class="t-micro ' + combosTone + '">' + combos + ' COMBOS</span></div></article>';
}

function historyRowHTML(entry, index, history, player) {
  const participant = historyParticipant(entry, player);
  const won = historyRowWon(participant, entry);
  const date = historyRowDate(entry);
  const deeds = historyRowDeeds(participant, entry);
  const participants = Array.isArray(entry.participants) ? entry.participants.length : '—';
  const events = Array.isArray(entry.globalEvents) ? entry.globalEvents.length : 0;
  const combos = Array.isArray(entry.eventCombinations) ? entry.eventCombinations.length : 0;
  return '<article class="player-history-row' + (won ? ' is-win' : '') + '"><div class="player-history-main"><span class="t-micro ink-3">' + date + ' · MATCH ' + String(history.length - index).padStart(2, '0') + '</span><strong class="t-label f12 ' + (won ? 'green' : 'g100') + '">' + (won ? 'WIN' : 'ROUND COMPLETE') + '</strong></div>' + playerHistoryMetaHTML(participants, deeds, events, combos);;
}

function playerHistoryHTML(history, player) {
  const scope = state.selectedPlayerHistoryScope || "all";
  const filtered = history.filter((entry) => historyScopeMatch(entry, scope));
  if (!filtered.length) return '<p class="t-body ink-3 social-empty">NO MATCHES IN THIS HISTORY VIEW.</p>';
  return filtered.map((entry, index) => historyRowHTML(entry, index, history, player)).join('');
}

function currentFriendStatus(accountId) {
  if (state.selectedPlayerRelationship !== "none") return state.selectedPlayerRelationship;
  const friends = state.social.friends || [];
  if (friends.some((friend) => friend.id === accountId)) return "accepted";
  return "none";
}

function friendButtonLabel(status) {
  if (status === "accepted") return "FRIENDS";
  if (status === "requested") return "REQUEST SENT";
  return "SEND FRIEND REQUEST";
}

function playerIdentityBits(player) {
  const name = esc(player.displayName || player.name);
  const online = player.online === false ? "OFFLINE" : "IN THIS ROOM";
  return { name, online };
}

function playerFactsBits(player) {
  const games = player.stats?.gamesPlayed ?? "—";
  const wins = player.stats?.wins ?? "—";
  const achievements = player.achievementsPrivate ? "PRIVATE" : (player.achievements?.length ?? "—");
  const mutual = player.mutualFriends ?? "—";
  return { games, wins, achievements, mutual };
}

function disabledWhen(off) {
  return off ? "disabled" : "";
}

function playerActionBits(player, canSocial, friendStatus) {
  const friendReady = canSocial && friendStatus !== "accepted" && friendStatus !== "requested";
  return {
    friendAttr: disabledWhen(!friendReady),
    canSocialAttr: disabledWhen(!canSocial),
    historyAttr: disabledWhen(!canSocial || player.historyPrivate),
  };
}

function placementLabel(participant) {
  if (participant?.finalPlacement === 1) return "WIN";
  if (participant?.finalPlacement) return "PLACE " + participant.finalPlacement;
  return "MATCH";
}

function playerMatchRowHTML(match, player) {
  const participants = match.participants || [];
  const participant = participants.find((entry) => entry.displayNameAtMatch === player.displayName);
  const placement = placementLabel(participant);
  const date = esc(String(match.completedAt || "").slice(0, 10));
  const tone = placement === "WIN" ? "green" : "g100";
  const players = (match.participants || []).length;
  const events = (match.globalEvents || []).length;
  return '<div class="player-profile-match"><span class="t-micro ink-3">' + date + '</span><strong class="t-label f11 ' + tone + '">' + placement + '</strong><span class="t-micro ink-3">' + players + ' PLAYERS · ' + events + ' EVENTS</span></div>';
}

function renderRecentMatches(card, player) {
  if (!Array.isArray(player.recentMatches)) return;
  const recent = player.recentMatches.slice(0, 3).map((match) => playerMatchRowHTML(match, player)).join("");
  const matches = recent || '<span class="t-micro ink-3">NO PUBLIC MATCHES YET.</span>';
  card.insertAdjacentHTML("beforeend", '<section class="player-profile-recent"><div class="t-micro g400">RECENT MATCHES</div>' + matches + '</section>');
}

function historyScopesHTML() {
  return [["all", "ALL"], ["with-me", "WITH ME"], ["global", "GLOBAL EVENTS"]].map(([id, label]) => `<button class="player-history-scope${state.selectedPlayerHistoryScope === id ? " is-active" : ""}" type="button" data-player-history-scope="${id}" aria-pressed="${state.selectedPlayerHistoryScope === id}"><span class="t-label f11">${label}</span></button>`).join("");
}

function renderPlayerHistoryView(card, player) {
  const history = state.selectedPlayerHistory || [];
  const name = esc(player.displayName || player.name);
  const scopes = historyScopesHTML();
  card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER RECORD · SHARED VIEW</div><h2 class="t-section g100" id="player-modal-title">${name}</h2><p class="t-body ink-2" id="player-modal-description">Recent completed matches visible to you.</p></div><button class="btn-dark social-close" id="player-modal-close" type="button"><span class="t-label f11">CLOSE</span></button></div><div class="player-history-scopes" role="tablist" aria-label="Match history scope">${scopes}</div><div class="player-history-list thin-scroll">${playerHistoryHTML(history, player)}</div><button class="btn-dark social-back" id="player-modal-back" type="button"><span class="t-label f11">BACK TO PLAYER</span></button>`;
}

function renderPlayerProfileView(card, player, accountId) {
  const friendStatus = currentFriendStatus(accountId);
  const friendLabel = friendButtonLabel(friendStatus);
  const isSelf = player.id === "p1";
  const canSocial = Boolean(player.accountId && !isSelf);
  const bits = playerIdentityBits(player);
  const facts = playerFactsBits(player);
  const actions = playerActionBits(player, canSocial, friendStatus);
  card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER CARD · IN THIS ROOM</div><h2 class="t-section g100" id="player-modal-title">${bits.name}</h2><p class="t-body ink-2" id="player-modal-description">Public details only. Private cash, loans, and hidden records stay hidden.</p></div><button class="btn-dark social-close" id="player-modal-close" type="button"><span class="t-label f11">CLOSE</span></button></div><div class="player-profile-head"><div class="player-profile-avatar">${avatarHTML(player, 6, 0)}</div><div><strong class="t-label f14 g100">${bits.name}</strong><span class="t-micro ink-3">${bits.online}</span></div></div><div class="player-profile-facts"><div><span class="t-micro ink-3">GAMES</span><strong class="t-label f13 g100">${facts.games}</strong></div><div><span class="t-micro ink-3">WINS</span><strong class="t-label f13 green">${facts.wins}</strong></div><div><span class="t-micro ink-3">ACHIEVEMENTS</span><strong class="t-label f13 g300">${facts.achievements}</strong></div><div><span class="t-micro ink-3">MUTUAL FRIENDS</span><strong class="t-label f13 g300">${facts.mutual}</strong></div></div><div class="player-profile-actions"><button class="cta-red" type="button" data-player-action="friend" ${actions.friendAttr}><span class="cta-text cta-text-sm">${friendLabel}</span></button><button class="btn-dark" type="button" data-player-action="invite" ${actions.canSocialAttr}><span class="t-label f11">INVITE TO ROOM</span></button><button class="btn-dark" type="button" data-player-action="history" ${actions.historyAttr}><span class="t-label f11">MATCH HISTORY</span></button><button class="btn-dark" type="button" data-player-action="block" ${actions.canSocialAttr}><span class="t-label f11">BLOCK</span></button><button class="btn-dark" type="button" data-player-action="report" ${actions.canSocialAttr}><span class="t-label f11">REPORT</span></button></div>`;
  renderRecentMatches(card, player);
}

export function renderPlayerSurface() {
  const card = $("#player-card");
  const player = state.selectedPlayer;
  if (!card || !player) return;
  const accountId = player.accountId || player.id;
  if (state.selectedPlayerView === "history") {
    renderPlayerHistoryView(card, player);
    return;
  }
  renderPlayerProfileView(card, player, accountId);
}
