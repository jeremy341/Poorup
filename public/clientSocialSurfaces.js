/* ============================================================
   SOCIAL SURFACES: friends/rankings/player/rules pages and the
   parlor toast announcer. Server fetches and view switching are
   injected by the entry module; everything else is local DOM.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { avatarHTML, hydrateSprites } from "./clientSprites.js";
import { state } from "./clientState.js";
import { openSurface } from "./clientSurfaces.js";
import { formatHistoryDate } from "./clientHistoryFormat.js";
import { PARLOR_PATROL_ENABLED } from "./clientParlorPatrolFlag.js";
import { mountResponsiveRankingControls } from "./clientResponsiveSocialSurfaces.js";
import { closeButtonHTML } from "./clientCloseButton.js";
import { getAccountAuthGeneration } from "./clientAccountIdentity.js";

function noop() {}
let host = { emitServer: noop, showView: noop };
export const SOCIAL_REQUEST_TIMEOUT_MS = 8000;
let socialRequestId = 0;
let socialRequestTimer = null;
let leaderboardRequestTimer = null;
const pendingFriendRequests = new Map();

function socialAuthToken() {
  return { accountId: state.account?.account?.id, generation: getAccountAuthGeneration() };
}

function socialAuthCurrent(token) {
  return Boolean(token?.accountId) && token.accountId === state.account?.account?.id && token.generation === getAccountAuthGeneration();
}

export function beginFriendRequestAction(id) {
  if (!id || !state.account?.account || friendRequestPending(id)) return null;
  const token = socialAuthToken();
  pendingFriendRequests.set(String(id), token);
  return token;
}

export function friendRequestPending(id) {
  return socialAuthCurrent(pendingFriendRequests.get(String(id)));
}

export function finishFriendRequestAction(id, token) {
  if (pendingFriendRequests.get(String(id)) !== token) return false;
  pendingFriendRequests.delete(String(id));
  return socialAuthCurrent(token);
}

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
  dismiss.setAttribute("aria-label", "Dismiss notification");
  dismiss.textContent = "×";
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

function pageFocusCanMove() {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  const owner = active.closest?.(".view");
  return Boolean(owner?.classList.contains("is-hidden"));
}

function focusSocialPage() {
  if (!pageFocusCanMove()) return;
  requestAnimationFrame(() => {
    const gate = $("#social-page-content [data-social-guest-gate]");
    const target = gate || $("#social-page-content .social-feed");
    target?.focus({ preventScroll: true });
  });
}

function focusRankingsPage() {
  if (!pageFocusCanMove()) return;
  requestAnimationFrame(() => $("#rankings-page-content [data-ranking-stage]")?.focus({ preventScroll: true }));
}

export function socialPlayerRowHTML(player, actionLabel = "VIEW") {
  if (!player) return "";
  const id = player.id || player.accountId;
  const mutual = Number(player.mutualFriends) || 0;
  return `<div class="social-player-row"><div class="social-player-avatar">${avatarHTML(player, 3, 0)}</div><div class="social-player-main"><strong class="t-label f12 g100">${esc(player.displayName || player.name || "PLAYER")}</strong><span class="t-micro ink-3">@${esc(player.username || "guest")}${mutual ? ` · ${mutual} MUTUAL` : ""}</span></div><button class="btn-dark social-player-open" type="button" data-social-player="${esc(id)}"><span class="t-label f11">${actionLabel}</span></button></div>`;
}


// Inside a game, Rankings and Social render the very same content as their
// pages. Only the way out differs: the pages leave through the site header, the
// in-game copy returns to the table. Closing it never leaves the room, and the
// seat, connection, turn timer and any pending prompt are untouched.
function tableReturnBarHTML(closeId, label) {
  const room = state.roomCode ? ` · ROOM ${esc(state.roomCode)}` : "";
  return `<div class="table-return-bar"><button class="btn-dark social-close table-return-btn" id="${closeId}" type="button" aria-label="Back to table. Closes ${label}; your seat and the game keep running."><span class="table-return-arrow" aria-hidden="true">‹</span><span class="t-label f11">BACK TO TABLE</span></button><span class="t-micro ink-3 table-return-note">TABLE STAYS LIVE${room} · YOUR SEAT AND TURN ARE UNAFFECTED</span></div>`;
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
  focusSocialPage();
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
  if (state.socialSearchLoading) return `<p class="t-micro ink-3" data-social-search-status aria-live="polite">SEARCHING…</p>`;
  if (state.socialSearchError) return `<p class="t-micro red" data-social-search-status role="alert">${esc(state.socialSearchError)}</p>`;
  if (!results.length) return String(state.socialSearchQuery || "").trim().length >= 3 ? `<p class="t-micro ink-3">NO EXACT USERNAME MATCH.</p>` : "";
  return results.map((player) => socialPlayerRowHTML(player, "VIEW")).join("");
}

function socialSnapshotHasRows() {
  return Object.values(state.social || {}).some((value) => Array.isArray(value) && value.length > 0);
}

function socialSyncStatusHTML() {
  if (!state.account?.account) return "";
  if (state.socialLoading) {
    return `<p class="t-micro ink-3 social-sync-status" data-social-sync-status aria-live="polite">SYNCING SOCIAL…${socialSnapshotHasRows() ? " LAST SYNC SHOWN BELOW." : ""}</p>`;
  }
  if (!state.socialError) return "";
  return `<div class="social-sync-status social-sync-error" data-social-sync-status role="alert"><p class="t-body ink-2">${esc(state.socialError)}${socialSnapshotHasRows() ? " LAST SYNC SHOWN BELOW." : ""}</p><button class="btn-dark" type="button" data-social-retry><span class="t-label f11">TRY AGAIN</span></button></div>`;
}

function socialDataAck(response, target, requestId, session, preserveFocus) {
  if (requestId !== socialRequestId || !socialAuthCurrent(session)) return;
  clearTimeout(socialRequestTimer);
  socialRequestTimer = null;
  state.socialLoading = false;
  if (response?.success && response.social) {
    state.social = response.social;
    state.socialError = "";
    state.socialStale = false;
    renderSocialSurface(target);
    if (target === "#social-page-content" && !preserveFocus) focusSocialPage();
    return;
  }
  state.socialError = response?.error || "Social data is temporarily unavailable. Try again.";
  state.socialStale = socialSnapshotHasRows();
  renderSocialSurface(target);
}

export function requestSocialData(target, { preserveFocus = false } = {}) {
  if (!state.account?.account) {
    // Guests get the public shell and account gate only. Do not request or
    // retain relationship data that cannot be displayed without an account.
    state.socialLoading = false;
    state.socialError = "";
    renderSocialSurface(target);
    return;
  }
  const requestId = socialRequestId + 1;
  socialRequestId = requestId;
  state.socialRequestId = requestId;
  const session = socialAuthToken();
  state.socialLoading = true;
  state.socialError = "";
  state.socialStale = socialSnapshotHasRows();
  clearTimeout(socialRequestTimer);
  renderSocialSurface(target);
  socialRequestTimer = setTimeout(() => socialDataAck({ success: false, error: "Social sync timed out. Try again." }, target, requestId, session, preserveFocus), SOCIAL_REQUEST_TIMEOUT_MS);
  host.emitServer("get-social-data", {}, (response) => socialDataAck(response, target, requestId, session, preserveFocus));
}

function socialFetchAndRender(target) {
  requestSocialData(target);
}

function leaderboardSnapshotAck(snapshot, target, requestId) {
  if (requestId !== state.leaderboard.requestId) return;
  clearTimeout(leaderboardRequestTimer);
  leaderboardRequestTimer = null;
  state.leaderboard.loading = false;
  applyLeaderboardSnapshot(snapshot);
  state.leaderboard.stale = !snapshot?.success;
  const pickerFocused = $(target)?.querySelector("[data-ranking-metric]") === document.activeElement;
  renderRankingsSurface(target);
  if (target === "#rankings-page-content" && !pickerFocused) focusRankingsPage();
}

export function requestLeaderboardSnapshot(target) {
  const requestId = state.leaderboard.requestId + 1;
  state.leaderboard.requestId = requestId;
  state.leaderboard.loading = true;
  state.leaderboard.error = "";
  state.leaderboard.stale = Boolean(leaderboardCurrentRows(state.leaderboard.snapshots || {}).length);
  clearTimeout(leaderboardRequestTimer);
  renderRankingsSurface(target);
  leaderboardRequestTimer = setTimeout(() => leaderboardSnapshotAck({ success: false, error: "Rankings sync timed out. Try again." }, target, requestId), SOCIAL_REQUEST_TIMEOUT_MS);
  host.emitServer("get-leaderboard-snapshot", { scope: state.leaderboard.scope, metric: state.leaderboard.metric }, (snapshot) => leaderboardSnapshotAck(snapshot, target, requestId));
}

function publicPlayerAck(response) {
  if (!publicPlayerResponseValid(response)) return;
  applyPublicPlayerCard(response);
}

function publicPlayerResponseValid(response) {
  if (!response?.success) return false;
  return Boolean(response.player);
}

function applyPublicPlayerCard(response) {
  const seat = state.selectedPlayer;
  state.selectedPlayer = { ...seat, ...response.player, id: seat?.id || response.player.id, serverId: seat?.serverId || seat?.id, accountId: response.player.id };
  state.selectedPlayerRelationship = response.relationship;
  renderPlayerSurface();
}

function signinBodyHTML() {
  return `<div class="social-signin-note"><span class="t-label f13 g100">ACCOUNT REQUIRED</span><p class="t-body ink-2">Create an account to keep friends, invitations, and social history across rooms.</p><button class="cta-red" type="button" data-social-action="account"><span class="cta-text cta-text-sm">CREATE ACCOUNT</span></button></div>`;
}

export function socialGuestGateHTML(surfaceKey = "social") {
  const titleId = `social-${surfaceKey}-guest-title`;
  return `<section class="social-guest-gate" data-social-guest-gate role="status" tabindex="-1" aria-labelledby="${titleId}">
    <div class="social-guest-gate-card">
      <span class="t-micro g400">ACCOUNT GATE</span>
      <h3 class="t-section g100" id="${titleId}">YOU DO NOT HAVE AN ACCOUNT</h3>
      <p class="t-body ink-2">Create an account to keep friends, invitations, and social history across rooms.</p>
      <button class="cta-red" type="button" data-social-action="account"><span class="cta-text cta-text-sm">CREATE ACCOUNT</span></button>
    </div>
  </section>`;
}

function friendsBodyHTML(social) {
  return social.friends?.length ? social.friends.map((player) => socialPlayerRowHTML(player)).join("") : `<p class="t-body ink-3 social-empty">NO FRIENDS YET. Search by username or open someone from the table.</p>`;
}

export function requestsBodyHTML(social) {
  const pending = id => friendRequestPending(id) ? ' disabled aria-busy="true"' : "";
  const incoming = social.requests?.map((request) => `<div class="social-request-row">${socialPlayerRowHTML(request.from, "VIEW")}<div class="social-request-actions"><button class="btn-dark social-request-accept" type="button" data-social-request="accept" data-friendship-id="${esc(request.id)}"${pending(request.id)}><span class="t-label f11">ACCEPT</span></button><button class="btn-dark" type="button" data-social-request="decline" data-friendship-id="${esc(request.id)}"${pending(request.id)}><span class="t-label f11">DECLINE</span></button></div></div>`).join("") || "";
  const outgoing = social.outgoing?.map((request) => `<div class="social-request-row">${socialPlayerRowHTML(request.to, "VIEW")}<div class="social-request-actions"><span class="t-micro ink-3">REQUEST SENT</span><button class="btn-dark" type="button" data-social-request-cancel data-friendship-id="${esc(request.id)}"${pending(request.id)}><span class="t-label f11">CANCEL</span></button></div></div>`).join("") || "";
  return incoming || outgoing ? `${incoming}${outgoing}` : `<p class="t-body ink-3 social-empty">NO PENDING REQUESTS.</p>`;
}

function socialDateLabel(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).toUpperCase();
}

function invitesBodyHTML(social) {
  return social.invites?.length ? social.invites.map((invite) => `<div class="social-invite-row"><div><strong class="t-label f12 g100">${esc(invite.roomName || "AFTER HOURS")}</strong><span class="t-micro ink-3">${String(invite.visibility || "public").toUpperCase()} ROOM · EXPIRES ${esc(socialDateLabel(invite.expiresAt) || "—")}</span></div><div class="social-request-actions"><button class="cta-red" type="button" data-social-invite="accept" data-invite-id="${esc(invite.id)}"><span class="cta-text cta-text-sm">JOIN</span></button><button class="btn-dark" type="button" data-social-invite="decline" data-invite-id="${esc(invite.id)}"><span class="t-label f11">DECLINE</span></button></div></div>`).join("") : `<p class="t-body ink-3 social-empty">NO ROOM INVITES.</p>`;
}

function recentBodyHTML(social) {
  let body = social.recentPlayers?.length       ? social.recentPlayers.map((player) => socialPlayerRowHTML(player, "REVISIT")).join("")       : `<p class="t-body ink-3 social-empty">NO RECENT PLAYERS YET. COMPLETE A MATCH TO BUILD YOUR TABLE HISTORY.</p>`;
  return `<div class="recent-players-wrap"><div class="recent-players-actions"><span class="t-micro ink-3">LAST 30 DAYS · 20 PLAYERS MAX</span><div class="recent-players-clear"><button class="btn-dark" type="button" data-social-clear-recent><span class="t-label f11">CLEAR RECENT PLAYERS</span></button><span class="t-micro ink-3">Removes this list only; friends stay.</span></div></div>${body}</div>`;
}

function notificationsBodyHTML(social) {
  return social.notifications?.length ? social.notifications.map((notification) => `<div class="social-notification-row${notification.readAt ? "" : " is-unread"}"><div><strong class="t-label f12 g100">${esc(notification.title)}</strong><span class="t-body ink-2">${esc(notification.body)}</span><span class="t-micro ink-3">${esc(socialDateLabel(notification.createdAt))}</span></div>${notification.readAt ? "" : `<button class="btn-dark" type="button" data-notification-read="${esc(notification.id)}"><span class="t-label f11">READ</span></button>`}</div>`).join("") : `<p class="t-body ink-3 social-empty">NO NOTIFICATIONS.</p>`;
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
  const closeBtn = pageSurface ? "" : tableReturnBarHTML("social-close", "Social");
  return { shellClass, closeBtn, friendsCount: listCount(social.friends), inboxCount: unreadCount(social) };
}

function socialRailContext(signedIn) {
  const networkLabel = signedIn ? "ACCOUNT SYNC" : "GUEST VIEW";
  const feedSource = signedIn ? "SERVER-SYNCED" : "ACCOUNT REQUIRED";
  const phaseLabel = state.phase === "home" ? "NO ROOM" : "IN ROOM";
  return { networkLabel, feedSource, phaseLabel };
}

function socialTableContext() {
  const home = state.phase === "home";
  const roomValue = home ? "—" : esc(state.roomCode || "PUBLIC");
  const seatedValue = home ? "—" : state.players.length;
  return { roomValue, seatedValue };
}

const SOCIAL_TABS = [["friends", "FRIENDS"], ["requests", "REQUESTS"], ["invites", "INVITES"], ["recent", "RECENT"], ["notifications", "INBOX"]];

function socialSurfaceView(card) {
  const social = state.social || {};
  const signedIn = Boolean(state.account?.account);
  const pageSurface = card.id === "social-page-content";
  const surfaceKey = pageSurface ? "page" : "modal";
  return {
    social, signedIn, pageSurface, surfaceKey, tabs: SOCIAL_TABS,
    count: requestsTotal(social), pending: pendingTotal(social),
    body: socialTabBody(social, signedIn), activeLabel: activeTabLabel(SOCIAL_TABS),
    searchResults: signedIn ? socialSearchResultsHTML() : "",
    searchValue: esc(state.socialSearchQuery || ""), hero: socialHeroContext(social, pageSurface),
    rail: socialRailContext(signedIn), info: socialTableContext(), syncStatus: socialSyncStatusHTML(),
  };
}

function socialSearchMarkup(view) {
  return `<div class="social-search-band panel noise"><form class="social-search" data-social-search-form id="social-${view.surfaceKey}-search-form"><div class="social-search-row"><label class="social-search-label" for="social-${view.surfaceKey}-search-input"><span class="t-micro g400">FIND A PLAYER</span><input class="field" id="social-${view.surfaceKey}-search-input" data-social-search-input name="username" autocomplete="off" placeholder="SEARCH USERNAME…" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" value="${view.searchValue}" aria-describedby="social-${view.surfaceKey}-search-help"><span class="t-micro ink-3" id="social-${view.surfaceKey}-search-help">Unique usernames only · 3–16 characters</span></label><button class="btn-dark social-search-submit" type="submit"><span class="t-label f11">FIND</span></button></div><div class="social-search-results" data-social-search-results id="social-${view.surfaceKey}-search-results">${view.searchResults}</div></form></div>`;
}

function socialTabsMarkup(view) {
  return view.tabs.map(([id, label]) => `<button class="social-tab${state.socialTab === id ? " is-active" : ""}" type="button" aria-pressed="${state.socialTab === id}" data-social-tab="${id}"><span class="t-label f11">${label}</span><span class="social-tab-count">${tabCount(id, view.social, view.count)}</span></button>`).join("");
}

function socialNetworkMarkup(view) {
  return `<div class="social-network-grid"><aside class="social-network-rail panel noise"><div class="social-rail-head"><span class="t-micro g400">NETWORK</span><span class="t-micro ink-3">${view.rail.networkLabel}</span></div><nav class="social-rail-nav" aria-label="Social views">${socialTabsMarkup(view)}</nav></aside><section class="social-feed panel noise" tabindex="0" aria-labelledby="social-${view.surfaceKey}-feed-title"><div class="social-feed-head"><div><span class="t-micro g400">ACTIVE FEED</span><h3 class="t-section g100" id="social-${view.surfaceKey}-feed-title">${view.activeLabel}</h3></div><span class="t-micro ink-3">${view.rail.feedSource}</span></div><div class="social-surface-body thin-scroll">${view.body}</div></section><aside class="social-context panel noise" aria-labelledby="social-${view.surfaceKey}-context-title"><div class="social-context-head"><div><span class="t-micro g400">TABLE CONTEXT</span><h3 class="t-section g100" id="social-${view.surfaceKey}-context-title">People nearby</h3></div><span class="t-micro ink-3">${view.rail.phaseLabel}</span></div><div class="social-context-stats"><div><span class="t-micro ink-3">ROOM</span><strong class="t-label f11 g100">${view.info.roomValue}</strong></div><div><span class="t-micro ink-3">SEATED</span><strong class="t-label f11 green">${view.info.seatedValue}</strong></div></div><div class="social-context-roster">${socialRoomRosterHTML()}</div><div class="social-context-foot"><span class="t-micro g400">PRIVACY</span><span class="t-body ink-2">Only public identity and relationship actions are shown here. Cash, loans, and hidden match details stay private.</span></div></aside></div>`;
}

function socialHeroMarkup(view) {
  const guestClass = view.signedIn ? "" : " is-guest";
  const guestContentState = view.signedIn ? "" : ' aria-hidden="true"';
  const gate = view.signedIn ? "" : socialGuestGateHTML(view.surfaceKey);
  return `<div class="${view.hero.shellClass}">${view.hero.closeBtn}<section class="social-hero panel noise"><div class="social-hero-mark"><img src="/assets/social-network.svg" alt="" width="32" height="32"></div><div class="social-hero-copy"><span class="t-micro g400">PARLOR SOCIAL · PLAYER INDEX</span><h2 class="t-section g100" id="social-${view.surfaceKey}-title">People who keep the table moving</h2><p class="t-body ink-2" id="social-${view.surfaceKey}-description">Find people by their unique username, then manage friends and room invites without leaving the parlor.</p></div><div class="social-hero-stats"><div><span class="t-micro ink-3">FRIENDS</span><strong class="t-label f20 g100">${view.hero.friendsCount}</strong></div><div><span class="t-micro ink-3">PENDING</span><strong class="t-label f20 g300">${view.pending}</strong></div><div><span class="t-micro ink-3">INBOX</span><strong class="t-label f20 green">${view.hero.inboxCount}</strong></div></div></section>${view.syncStatus}<div class="social-guest-shell${guestClass}"><div class="social-guest-content" data-social-guest-content${guestContentState}>${socialSearchMarkup(view)}${socialNetworkMarkup(view)}</div>${gate}</div></div>`;
}

export function renderSocialSurface(target = "#social-card") {
  const card = surfaceCard(target, "#social-card");
  if (!card) return;
  const active = document.activeElement;
  const focusedPlayerId = card.contains?.(active) ? active?.closest?.("[data-social-player]")?.dataset?.socialPlayer : null;
  const requestFocus = card.contains?.(active) && (active?.dataset?.friendshipId || active?.matches?.(".social-feed"));
  const friendshipId = active?.dataset?.friendshipId;
  const action = active?.dataset?.socialRequest;
  const cancel = active?.hasAttribute?.("data-social-request-cancel");
  const view = socialSurfaceView(card);
  card.innerHTML = socialHeroMarkup(view);
  const guestContent = card.querySelector("[data-social-guest-content]");
  if (guestContent) guestContent.inert = !view.signedIn;
  if (focusedPlayerId) {
    const replacement = [...card.querySelectorAll("[data-social-player]")].find(button => button.dataset.socialPlayer === focusedPlayerId);
    (replacement || card.querySelector(".social-feed"))?.focus({ preventScroll: true });
  }
  if (requestFocus) {
    const replacement = friendshipId && [...card.querySelectorAll("[data-friendship-id]")].find(button => button.dataset.friendshipId === friendshipId && (cancel ? button.hasAttribute("data-social-request-cancel") : button.dataset.socialRequest === action) && !button.disabled);
    (replacement || card.querySelector(".social-feed"))?.focus({ preventScroll: true });
  }
}


export function openInGameSocialSurface(kind) {
  if (!["setup", "lobby", "playing"].includes(state.phase)) return false;
  if (kind === "rankings") {
    renderRankingsSurface("#rankings-card");
    openSurface("#rankings-modal", "#rankings-close");
    requestLeaderboardSnapshot("#rankings-card");
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
  if (RANKING_ORDER.includes(metric)) return metric;
  return "wins";
}

function normalizeRankingScope(scope) {
  const allowed = ["all", "month", "friends"];
  if (allowed.includes(scope)) return scope;
  return "all";
}

function clearLeaderboardSnapshot(snapshot) {
  state.leaderboard.error = snapshot?.error || "Rankings are temporarily unavailable.";
  state.leaderboard.stale = Boolean(state.leaderboard.rows?.length || Object.keys(state.leaderboard.snapshots || {}).length);
}

function storeLeaderboardSnapshot(snapshot) {
  state.leaderboard.error = "";
  state.leaderboard.snapshots = snapshot.metrics || {};
  state.leaderboard.generatedAt = snapshot.generatedAt || null;
  state.leaderboard.scope = snapshot.scope || state.leaderboard.scope;
  const rows = state.leaderboard.snapshots[state.leaderboard.metric];
  if (rows) state.leaderboard.rows = rows;
}

function applyLeaderboardSnapshot(snapshot) {
  if (!snapshot?.success) return clearLeaderboardSnapshot(snapshot);
  storeLeaderboardSnapshot(snapshot);
}

export function openRankingsSurface(metric = "wins", scope = state.leaderboard.scope || "all") {
  state.leaderboard.metric = normalizeRankingMetric(metric);
  state.leaderboard.scope = normalizeRankingScope(scope);
  state.leaderboard.page = 0;
  host.showView("rankings");
  renderRankingsSurface("#rankings-page-content");
  focusRankingsPage();
  requestLeaderboardSnapshot("#rankings-page-content");
}

export const RANKING_LABELS = { wins: "WINS", rate: "WIN RATE", games: "GAMES", achievements: "ACHIEVEMENT SCORE", mythical: "MYTHICAL", bankruptcies: "BANKRUPTCIES", events: "EVENT SURVIVAL", auctions: "AUCTION WINS", rent: "RENT COLLECTED", casino: "CASINO NET", market: "MARKET PROFIT", playerloans: "PLAYER LOANS", equity: "EQUITY DEALS", loans: "LOAN DISCIPLINE", ...(PARLOR_PATROL_ENABLED ? { patrol: "PATROL BEST" } : {}) };
export const RANKING_ORDER = Object.keys(RANKING_LABELS);

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

const RANKING_DESCRIPTIONS = {
  wins: "Completed server rounds won. Ties are resolved by verified wins, then name.",
  rate: "Verified win percentage. Five completed games are required before a rate ranks.",
  games: "Completed server rounds. Preview, duplicate, abandoned, and bot-only games stay out.",
  achievements: "Rarity-weighted achievement score earned across completed rounds.",
  mythical: "Mythical achievements unlocked. These are announced server-wide when earned.",
  bankruptcies: "Rounds survived without being the first wallet to break.",
  events: "Global events survived, measured from server event outcomes.",
  auctions: "Verified auctions won while keeping bids and settlements legal.",
  rent: "Cash collected from property rent in completed rounds.",
  casino: "Net in-game casino result. Wager volume never grants rank points.",
  market: "Net in-game market result after disclosed fees and obligations.",
  playerloans: "Player-to-player loan offers completed and settled.",
  equity: "Equity deals completed with server-authoritative settlement.",
  loans: "Loan obligations paid on time, including proactive repayments.",
  patrol: "Best verified Patrol score from the home easter egg.",
};

function rankingDescription(metric) {
  return RANKING_DESCRIPTIONS[metric] || "Verified server records only.";
}

function rankingValueLabel(metric, value) {
  if (metric === "rate") return `${Number(value) || 0}%`;
  if (["rent", "casino", "market"].includes(metric)) return `$${(Number(value) || 0).toLocaleString()}`;
  return String(Number(value) || 0);
}

export const RANKING_PAGE_SIZE = 10;

export function rankingsPageSlice(rows, requestedPage = 0) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / RANKING_PAGE_SIZE));
  const page = Math.max(0, Math.min(pageCount - 1, Math.floor(Number(requestedPage) || 0)));
  const start = page * RANKING_PAGE_SIZE;
  return { rows: list.slice(start, start + RANKING_PAGE_SIZE), total, page, pageCount, start };
}

function leaderboardCurrentRows(snapshots) {
  const rows = snapshots[state.leaderboard.metric];
  if (rows) return rows;
  if (state.leaderboard.loading) return [];
  return state.leaderboard.rows || [];
}

function rankingSelfBits(currentRows) {
  const selfId = state.account?.account?.id;
  const selfUsername = state.account?.account?.username;
  const selfIndex = selfId || selfUsername
    ? currentRows.findIndex((row) => row.accountId === selfId || row.accountId === selfUsername || row.username === selfUsername)
    : -1;
  const selfRow = selfIndex >= 0 ? currentRows[selfIndex] : null;
  const selfRank = selfRow ? `#${selfIndex + 1}` : "—";
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
  if (state.leaderboard.loading) return `<p class="t-body ink-3 social-empty" aria-live="polite">LOADING VERIFIED RANKINGS…</p>`;
  if (state.leaderboard.error) return rankingErrorHTML(state.leaderboard.error);
  // Every empty ranking says what to do next; the narrower scopes offer the wider ledger as one tap.
  const scope = state.leaderboard.scope;
  if (scope === "friends") {
    return `<div class="social-empty"><p class="t-body ink-2">NONE OF YOUR FRIENDS ARE RANKED YET.</p><p class="t-body ink-3">Add friends from the Social tab, or look at everyone.</p><button class="btn-dark" type="button" data-ranking-scope="all"><span class="t-label f11">SHOW ALL-TIME RANKINGS</span></button></div>`;
  }
  if (scope === "month") {
    return `<div class="social-empty"><p class="t-body ink-2">NO VERIFIED MATCHES IN THE LAST 30 DAYS.</p><p class="t-body ink-3">Finish a match while signed in to get on this ledger, or look at the all-time view.</p><button class="btn-dark" type="button" data-ranking-scope="all"><span class="t-label f11">SHOW ALL-TIME RANKINGS</span></button></div>`;
  }
  return `<div class="social-empty"><p class="t-body ink-2">NO VERIFIED PLAYERS YET.</p><p class="t-body ink-3">Sign in and finish a match to claim the first spot on the ledger.</p></div>`;
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
  return `<button class="ranking-row" type="button" data-ranking-player="${esc(row.accountId)}"><span class="ranking-place t-label f13">${String(index + 1).padStart(2, "0")}</span><span class="ranking-avatar">${avatarHTML(row, 3, index)}</span><span class="ranking-player"><strong class="t-label f12 g100">${esc(row.displayName)}</strong><span class="t-micro ink-3">@${esc(row.username)} · ${row.games} GAMES · ${row.wins} WINS</span><span class="t-micro ranking-trend ranking-trend-${trend.direction}" aria-label="${trend.label}">${trend.label}${trend.delta}</span></span><strong class="ranking-value t-label f16 ${valueClass}">${rankingValueLabel(state.leaderboard.metric, row.value)}</strong></button>`;
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
  card.innerHTML = `<div class="${shellClass}">${closeBtn}<section class="rankings-hero panel noise"><div class="rankings-hero-mark"><img src="/assets/rankings-podium.svg" alt="" width="32" height="32"></div><div class="rankings-hero-copy"><span class="t-micro g400">PARLOR RECORDS · VERIFIED</span><h2 class="t-section g100" id="rankings-${surfaceKey}-title">Global Rankings</h2><p class="t-body ink-2" id="rankings-${surfaceKey}-description">One clear ledger for the people who keep finishing the table.</p></div><div class="rankings-hero-stats"><div class="rankings-hero-stat"><span class="t-micro ink-3">YOUR RANK</span><strong class="t-label f20 ${selfTone}">${selfRank}</strong><span class="t-micro ink-3">${selfStat}</span></div><div class="rankings-hero-stat"><span class="t-micro ink-3">PLAYERS</span><strong class="t-label f20 g100">${currentRows.length}</strong><span class="t-micro ink-3">VERIFIED ROWS</span></div><div class="rankings-hero-stat"><span class="t-micro ink-3">DATA</span><strong class="t-label f12 g300">${syncLabel}</strong><span class="t-micro ink-3">SERVER SNAPSHOT</span></div></div></section><div class="rankings-search-slot"></div><div class="rankings-main-grid" data-ranking-layout><section class="rankings-stage panel noise" data-ranking-stage tabindex="0" aria-labelledby="rankings-${surfaceKey}-ledger-title"><div class="rankings-stage-head"><div class="rankings-stage-copy"><span class="t-micro g400">PRIMARY LEDGER · ${scopeLabel()}</span><h3 class="t-section g100" id="rankings-${surfaceKey}-ledger-title">${RANKING_LABELS[state.leaderboard.metric]} standings</h3><p class="t-body ink-2" id="rankings-${surfaceKey}-metric-description" aria-live="polite">${rankingDescription(state.leaderboard.metric)}</p></div></div>${rankingMetricNavigationHTML(state.leaderboard.metric)}<div class="rankings-stage-toolbar"><div class="ranking-scopes" role="toolbar" aria-label="Ranking scope">${scopes}</div><span class="t-micro ink-3 ranking-stage-count" aria-live="polite">${currentRows.length} VERIFIED ROWS · SELECT A METRIC</span></div><div class="ranking-list thin-scroll" aria-label="${RANKING_LABELS[state.leaderboard.metric]} leaderboard">${rows}</div>${rankingPaginationHTML(currentRows)}</section></div></div>`;
  const metricCount = card.querySelector(".ranking-stage-count");
  if (metricCount) metricCount.textContent = `${currentRows.length} VERIFIED ROWS · PAGE ${currentPage.page + 1} OF ${currentPage.pageCount}`;
  mountResponsiveRankingControls(card, { pageSurface, surfaceKey, expanded: state.rankingSearchExpanded, query: state.rankingSearchQuery, results: rankingSearchResultsHTML() });
  if (pickerFocused) card.querySelector("[data-ranking-metric]")?.focus({ preventScroll: true });
}

const RULES_SECTIONS = [
  {
    id: "start-here",
    label: "START HERE",
    kicker: "01 · QUICK BRIEF",
    title: "One table. Last wallet standing.",
    status: "LIVE",
    summary: "Poorup is a real-time property game. The board variant sets the space count and seat limit. Roll, move clockwise, make the next legal decision, and keep the table moving.",
    content: `<div class="rules-callout"><strong class="t-label f13 g100">THE SHORT VERSION</strong><p class="t-body ink-2">Start on GO and move clockwise around your table's board. Every player takes a turn in order. Buy useful property, charge rent, manage cash, and survive the table longer than everyone else.</p></div><h3 class="t-section g300">A complete turn</h3><ol class="rules-steps"><li><span class="rules-step-number">01</span><div><strong class="t-label f12 g100">ROLL</strong><p class="t-body ink-2">The active player rolls the dice once and the token moves one space at a time.</p></div></li><li><span class="rules-step-number">02</span><div><strong class="t-label f12 g100">RESOLVE</strong><p class="t-body ink-2">Resolve the landed space, card, rent, tax, purchase, auction, or prison rule before ending the turn.</p></div></li><li><span class="rules-step-number">03</span><div><strong class="t-label f12 g100">CHOOSE</strong><p class="t-body ink-2">Buy, trade, accept a loan, or place a legal market action. After rolling, the active player may build until ending the turn. Selling buildings evenly and mortgaging an eligible deed are available on any turn.</p></div></li><li><span class="rules-step-number">04</span><div><strong class="t-label f12 g100">END</strong><p class="t-body ink-2">Press End Turn only after every required decision is complete. The next player then becomes active.</p></div></li></ol>`,
  },
  {
    id: "board-tiles",
    label: "BOARD & TILES",
    kicker: "02 · THE MAP",
    title: "Read the board clockwise",
    status: "LIVE",
    summary: "Standard 40 and Metro 52 use different space counts, corner indexes, and seat limits. The visual order and server index match for each board.",
    content: `<div class="rules-board-order"><div><span class="t-micro g400">STANDARD 40 · CLOCKWISE INDEX</span><strong class="t-label f20 g100">0 → 39</strong></div><div><span class="t-micro g400">STANDARD 40 · CORNERS</span><strong class="t-label f12 g100">GO · PASSING BY / PRISON · VACATION · GO TO PRISON</strong></div></div><p class="t-body ink-2">Standard 40 supports two to four players, with 10 spaces per side and corners at 0, 10, 20, and 30. Metro 52 supports up to six players, with 13 spaces per side and corners at 0, 13, 26, and 39. Use the active-board line above for the table's variant.</p><h3 class="t-section g300">Space families</h3><div class="rules-term-grid"><div><strong class="t-label f12 g100">PROPERTY</strong><p class="t-body ink-2">Buy deeds, collect rent, build evenly, and group properties by their color strip.</p></div><div><strong class="t-label f12 g100">SUPPORT</strong><p class="t-body ink-2">Airports, Electric Company, and Water Company use their own settlement rules.</p></div><div><strong class="t-label f12 g100">CARD</strong><p class="t-body ink-2">Surprise and Treasure draw from separate decks. Each card resolves on the server.</p></div><div><strong class="t-label f12 g100">TAX</strong><p class="t-body ink-2">Earnings Tax and Premium Tax remove cash. The active event can add a disclosed modifier.</p></div><div><strong class="t-label f12 g100">CORNER</strong><p class="t-body ink-2">GO pays on passage, Passing By has an outside lane and prison lane, Vacation uses the optional pool, and Go to Prison sends you to prison.</p></div><div><strong class="t-label f12 g100">NEUTRAL</strong><p class="t-body ink-2">Treasure, Surprise, and Vacation do not belong to a country group.</p></div></div>`,
  },
  {
    id: "turn-flow",
    label: "TURN FLOW",
    kicker: "03 · TABLE RHYTHM",
    title: "The next legal action is always the priority",
    status: "LIVE",
    summary: "Every turn follows the same short loop, and you cannot skip a purchase, card, auction or payment.",
    content: `<div class="rules-code-flow"><span>ROLL</span><i>→</i><span>MOVE</span><i>→</i><span>LAND</span><i>→</i><span>RESOLVE</span><i>→</i><span>END TURN</span></div><p class="t-body ink-2">Players have unlimited time for each turn. The only clock is inactivity: after 30 seconds with no input (or a hidden game tab) a 3-minute countdown starts, and a player who stays idle through it can be removed from the room.</p><h3 class="t-section g300">Blocking decisions</h3><ul class="rules-bullets"><li>A purchase decision must be accepted, passed, or sent to auction before the turn can end.</li><li>A card choice, debt payment, trade confirmation, or bankruptcy decision temporarily owns the focus.</li><li>Only the active player can roll or perform turn-scoped actions. Building and selling are available to that player after rolling and until turn end.</li><li>Mortgaging an owned deed may happen on any turn when collateral and debt rules allow it. The server rejects stale or out-of-turn requests for turn-scoped actions.</li></ul><div class="rules-inline-note"><span class="t-micro g400">ROUND</span><span class="t-body ink-2">A round completes when every active player has received one turn. Global-event timing uses this round counter.</span></div>`,
  },
  {
    id: "cash-bank",
    label: "CASH & BANK",
    kicker: "04 · THE LEDGER",
    title: "Every dollar has a reason",
    status: "LIVE",
    summary: "The bank pays rewards, collects taxes and settles purchases, and every important transfer shows in the log.",
    content: `<h3 class="t-section g300">Cash rules</h3><ul class="rules-bullets"><li>Each player starts with the lobby's Starting Cash value.</li><li>Passing GO pays $200. Landing exactly on GO pays the configured Double GO amount when enabled.</li><li>Cash can move through rent, cards, taxes, prizes, trades, loans, builds, mortgages, and the Vacation pool.</li><li>If you cannot pay, the game opens the debt and bankruptcy steps instead of letting your cash go negative.</li></ul><h3 class="t-section g300">Vacation pool</h3><p class="t-body ink-2">When Vacation Pool is on, configured taxes and penalties feed the center pool. Landing on Vacation claims the pool. The setting does not change the tile order or movement index.</p>`,
  },
  {
    id: "properties",
    label: "PROPERTIES",
    kicker: "05 · DEEDS",
    title: "Build a group, then make it work",
    status: "LIVE",
    summary: "Properties are grouped by their color strip. The strip is the association; the name, price, and rotation are presentation only.",
    content: `<h3 class="t-section g300">Buying</h3><p class="t-body ink-2">When you land on an unowned property, you can buy it at the printed price. With Player Finance enabled, open Purchase Funding for gifts or a temporary passive rent share. Accepting completes the named purchase immediately. If Auction is on and you pass, the deed can go to a server-run auction.</p><h3 class="t-section g300">Rent</h3><ul class="rules-bullets"><li>Rent depends on the deed, group ownership, and building level.</li><li>Owning every deed in a group activates the group's monopoly multiplier.</li><li>Mortgaged deeds do not collect normal rent until redeemed.</li><li>No Rent In Jail prevents an owner in prison from collecting rent during the configured turn.</li></ul><h3 class="t-section g300">Building</h3><p class="t-body ink-2">After rolling on your own turn, build houses and hotels before ending your turn. You may sell buildings evenly for half their cost on any turn. Build evenly across a complete group. There is no shared limit on houses or hotels. Each deed can have four houses, then one hotel.</p>`,
  },
  {
    id: "support-spaces",
    label: "SUPPORT SPACES",
    kicker: "06 · AIRPORTS & UTILITIES",
    title: "Support tiles amplify the table",
    status: "LIVE",
    summary: "Airports and utilities are independent support tiles. They are not country properties and do not change the board's physical dimensions.",
    content: `<div class="rules-term-grid"><div><strong class="t-label f12 g100">AIRPORTS</strong><p class="t-body ink-2">ACC, BKK, AMS, and MB Airport are separate deeds priced at $200. Airport effects and rent are resolved by the server.</p></div><div><strong class="t-label f12 g100">ELECTRIC COMPANY</strong><p class="t-body ink-2">A utility deed whose charge is calculated from the dice result and ownership state.</p></div><div><strong class="t-label f12 g100">WATER COMPANY</strong><p class="t-body ink-2">A utility deed with the same support-tile settlement contract and its own printed price.</p></div><div><strong class="t-label f12 g100">COLOR STRIPS</strong><p class="t-body ink-2">Only property strips define country groups. Airports and utilities never inherit a country group.</p></div></div><h3 class="t-section g300">Airport flights</h3><p class="t-body ink-2">When flights are enabled, the destination owner's arrival fee takes priority. Otherwise, an eligible origin owner's departure fee applies; without an eligible owner, the standard fare applies. You pay no fee when you are the payee.</p>`,
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
    content: `<h3 class="t-section g300">Trades</h3><ul class="rules-bullets"><li>Trading must be enabled in the room settings.</li><li>Choose deeds and cash, send the offer, and wait for the recipient's decision. A deed sale is a trade with a price agreed between the players.</li><li>Both players must still own the offered deeds and have the offered cash when accepted.</li><li>Sell every house or hotel in a color set before any deed in that set can be traded. Mortgaged deeds may be traded; the mortgage remains on the deed, with no separate transfer fee.</li><li>Close an incoming offer to keep it pending. Open it from Deals to accept, decline, or negotiate; senders can adjust or cancel their own offer.</li></ul><h3 class="t-section g300">Auctions</h3><ul class="rules-bullets"><li>An auction starts when a buyer passes an unowned deed and Auction is enabled.</li><li>Players bid with available cash. Each valid bid resets the five-second timer.</li><li>There is no pass action during an auction; a player who does not bid remains eligible until the timer expires.</li><li>The highest valid bid wins and is charged atomically when the timer expires.</li><li>Disconnects and late bids cannot create a second winner.</li></ul>`,
  },
  {
    id: "build-mortgage",
    label: "BUILD & MORTGAGE",
    kicker: "09 · ASSET CONTROL",
    title: "Liquidity has a cost",
    status: "LIVE",
    summary: "Build during your own turn; sell buildings evenly and mortgage an eligible deed on any turn. The deed manager keeps both actions visible.",
    content: `<h3 class="t-section g300">Houses and hotels</h3><p class="t-body ink-2">After you roll and before you end your own turn, you may build evenly across a complete group. You may sell houses or hotels to the bank on any turn, for half their cost, while keeping the group even. There is no shared building-supply limit. Construction is blocked when a global event freezes building. A hotel replaces four houses on the same deed.</p><h3 class="t-section g300">Mortgage</h3><ul class="rules-bullets"><li>You may mortgage a deed you own on any player's turn if it is not otherwise locked, but every building in its color set must first be sold.</li><li>Open debt, collateral, and ownership rules can block a mortgage.</li><li>A mortgaged deed does not collect normal rent.</li><li>Redeeming a mortgage is handled through the applicable debt rules, not as a discretionary build action.</li><li>Bank-loan collateral locks cannot be mortgaged or traded until the loan is settled.</li><li>Bankruptcy settlement liquidates or transfers assets through the server's declared order.</li></ul>`,
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
    label: "FINANCE & BANKRUPTCY",
    kicker: "11 · FINANCING",
    title: "Borrow only when the table can carry it",
    status: "LIVE",
    summary: "Player loans and bank loans are separate contracts. Both are recorded, visible, and resolved before a player can quietly spend beyond their means.",
  content: `<h3 class="t-section g300">Bank loans</h3><ul class="rules-bullets"><li>Bank loans are optional and use a maturity date, total interest, and collateral lock.</li><li>Collateral cannot be traded or mortgaged while pledged.</li><li>Global events may add a disclosed interest surcharge or pause new offers, but cannot rewrite a settled payment.</li><li>New collateral quotes lock each deed's printed price at agreement. At default, eligible collateral credits the unpaid balance up to that balance; no surplus cash is paid. Any residual debt stays in the debt settlement ledger. Legacy agreements keep their recorded terms.</li></ul><h3 class="t-section g300">Player loans</h3><p class="t-body ink-2">Player Finance allows player loans and temporary passive rent shares when the host enables it. Incoming current offers can be negotiated from the Deals rail; the sender can adjust or cancel before acceptance. Legacy active equity and convertible notes retain their recorded terms; old pending offers must be rebuilt or declined.</p><h3 class="t-section g300">Temporary rent shares</h3><p class="t-body ink-2">One owner and one investor agree 1–20 rounds (default 3) on any buyable deed, including airports and utilities. The investor receives the agreed percentage of rent actually collected, with no title, sale proceeds, voting or control. The owner pays construction costs and may build or sell buildings. Deed sale, mortgage and pledge stay blocked until expiry at the start of the recorded round. Expiry or either party leaving or going bankrupt ends the right without a capital refund. New rent shares cannot be resold. Purchase Funding uses these same terms.</p><h3 class="t-section g300">Wallet &amp; items</h3><p class="t-body ink-2">Press Cash On Hand to open the Wallet &amp; Items workbench. Account and Items are two views of the same private round ledger, so closing the modal never accepts, sells, or cancels anything. Rebates apply only to market-order and flight fees; rent, taxes, loans and wagers earn none. Surprise and Treasure rewards appear in Items. They can be used, traded, exchanged or sold when the table rules allow it.</p><h3 class="t-section g300">Bankruptcy</h3><p class="t-body ink-2">An unpaid player may sell, mortgage, trade, or borrow through the legal rescue path, but cannot end the turn while a payment remains open. After the debt is paid, a balance of exactly $0 is valid. If no legal rescue remains, the player declares bankruptcy: a human becomes a read-only spectator, their board token disappears, and the Sidebar shows <strong> SPECTATING</strong>. A solvent creditor receives eligible assets; bank or voluntary releases return assets to the bank.</p>`,
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
    summary: "The Casino and fictional Market are optional, server-settled room add-ons. They use players' in-game cash and remain off in classic rooms.",
    content: `<h3 class="t-section g300">Casino</h3><p class="t-body ink-2">European roulette uses red, black, and green/0 with fixed disclosed odds. Stakes come from your in-game cash. Bets are escrowed, resolved once by the server, and logged. Players cannot use loan-funded cash for wagers.</p><h3 class="t-section g300">Market</h3><p class="t-body ink-2">The fictional exchange starts with country, airport, utilities, and property indexes. BASIC supports buy and sell. MARGIN adds a maintenance obligation, SHORTING adds finite borrowable units and deterministic buy-ins, and DERIVATIVES adds fully collateralized calls and puts. Prices update at round boundaries and event settlement.</p><h3 class="t-section g300">Shared guardrails</h3><ul class="rules-bullets"><li>Both systems start off by default. Hosts may enable each separately with either starting preset.</li><li>Global Events can alter limits, fees, prices, and volatility, not hidden casino odds.</li><li>Transactions use server idempotency keys so retries cannot duplicate money.</li><li>Positions and bets appear in match history as aggregate results, without exposing other players' private details.</li></ul><div class="rules-planned"><span class="t-micro g400">OPTIONAL · VIRTUAL ECONOMY ONLY</span><span class="t-body ink-2">No deposits, withdrawals, cash-out, or cash-value prizes are part of this design.</span></div>`,
  },
  {
    id: "bots",
    label: "BOTS",
    kicker: "14 · DECISIONS",
    title: "CPU seats follow the same contracts",
    status: "LIVE",
    summary: "Bots are reserved seats in the lobby and use the same server rules as human players. They are not allowed to bypass turn gates or money checks.",
    content: `<ul class="rules-bullets"><li>Bots buy, pass, build, sell buildings, mortgage, unmortgage, trade, make enabled player-loan and temporary rent-share offers, and bid according to a bounded risk profile.</li><li>They can choose jail fine, Get Out of Prison card, bank-loan repayment, market sell/rebalancing, sponsorship actions, and debt bankruptcy when no legal rescue remains.</li><li>A bot preserves a cash buffer for rent, taxes, debt, and known obligations.</li><li>Bots never borrow money to gamble and cannot see private player information.</li><li>AI BOT uses the provider when available and falls back automatically to the deterministic House Brain when credits or service fail.</li><li>NO-AI BOT skips provider calls entirely. Both modes use the same server action events, table chat signals, and legality checks.</li></ul>`,
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
    summary: "Achievements are grouped by tablecraft, global events, social play, and secrets. Mythical achievements are rare and announced globally.",
    content: `<ul class="rules-bullets"><li>Click an achievement to open its readable detail dialog.</li><li>Filter by category, when earned, and rarity without leaving the Profile page.</li><li>Rarity uses text and color: Common, Uncommon, Rare, Epic, Legendary, and Mythical.</li><li>Mythical unlocks create one generic server-wide announcement for every currently connected player. The title stays private until the owner reveals it.</li><li>Achievement progress is never a hidden cash requirement and does not change the rules of a live match.</li></ul>`,
  },
  {
    id: "lobby-settings",
    label: "LOBBY SETTINGS",
    kicker: "17 · HOST CONTROL",
    title: "Every switch has a consequence",
    status: "LIVE",
    summary: "Hosts configure the table before the first round. The active rules snapshot stays visible in the lobby so nobody has to guess what changed.",
  content: `<div class="rules-settings-table"><div><strong class="t-label f12 g100">Max Players</strong><span class="t-body ink-2">2–4 seats on Standard 40, up to 6 on Metro 52.</span></div><div><strong class="t-label f12 g100">Bots</strong><span class="t-body ink-2">Reserve CPU seats up to the available capacity.</span></div><div><strong class="t-label f12 g100">Bot Brain</strong><span class="t-body ink-2">AI BOT uses the provider and falls back automatically to the no-AI House Brain when credits or service fail. NO-AI BOT never calls a provider.</span></div><div><strong class="t-label f12 g100">Bot Difficulty</strong><span class="t-body ink-2">House, Table, or Expert changes evaluation depth, never legality.</span></div><div><strong class="t-label f12 g100">Starting Cash</strong><span class="t-body ink-2">Bank handout when the round begins.</span></div><div><strong class="t-label f12 g100">Room Visibility</strong><span class="t-body ink-2">Public tables are joined from the directory and do not expose an invite code. Private tables use a six-character code.</span></div><div><strong class="t-label f12 g100">Vacation Pool</strong><span class="t-body ink-2">Taxes feed the Vacation pool when on.</span></div><div><strong class="t-label f12 g100">Double GO</strong><span class="t-body ink-2">Landing exactly on GO pays the configured bonus.</span></div><div><strong class="t-label f12 g100">Trading</strong><span class="t-body ink-2">Allow player-to-player offers.</span></div><div><strong class="t-label f12 g100">Auction</strong><span class="t-body ink-2">Send passed unowned deeds to auction.</span></div><div><strong class="t-label f12 g100">No Rent In Jail</strong><span class="t-body ink-2">Stop an imprisoned owner collecting rent that turn.</span></div><div><strong class="t-label f12 g100">Bank Loans</strong><span class="t-body ink-2">Allow emergency bank credit with collateral.</span></div><div><strong class="t-label f12 g100">Loan Severity</strong><span class="t-body ink-2">Fair, Predatory, or Extreme interest tier.</span></div><div><strong class="t-label f12 g100">Global Events</strong><span class="t-body ink-2">A single ON/OFF switch. The server derives rarity, duration, and severity from round progress.</span></div><div><strong class="t-label f12 g100">Turn Time</strong><span class="t-body ink-2">Turns have no timer. A player idle for 3 minutes can be removed by inactivity: the countdown starts after 30 seconds without input, or at once if the game tab is hidden, and everyone can see it.</span></div><div><strong class="t-label f12 g100">Bankruptcy</strong><span class="t-body ink-2">Settle an open payment through legal rescue actions or declare bankruptcy. Human bankrupt players become read-only spectators; bots are eliminated without spectator controls.</span></div></div>`,
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

// Expansion contract: keeping this chapter data-driven lets the Rules-book
// explain new presets without adding another top-level navigation surface.
RULES_SECTIONS.push({
    id: "rulesets-market",
  label: "RULESETS & SEASONS",
  kicker: "19 · EXPANSION",
  title: "Choose the table, then earn the record",
  status: "LIVE",
  summary: "Standard and Advanced set starting defaults. Both presets allow every optional economy system.",
  content: `<h3 class="t-section g300">Starting presets and custom rules</h3><ul class="rules-bullets"><li>New tables start with Standard defaults: buying deeds, rent, auctions, trades, building, mortgages, cards, prison and bankruptcy form the board-game core. Optional economy modules start off, and the host can enable any of them independently.</li><li>Advanced starts Player Finance on. Neither preset locks any feature: the host can mix player finance, bank loans, casino, market, flights, bank accounts and global events however they want. Explicit choices survive preset changes.</li><li>Player Finance controls new player loans, rent shares and gift or rent-share Purchase Funding. Existing active contracts remain viewable and repayable when it is off.</li><li>The board variant is separate: Standard 40 supports up to four seats; Metro 52 has 13 spaces per side and up to six seats.</li><li>Room snapshots show the server's effective rules. Historical active agreements retain their recorded terms.</li></ul><h3 class="t-section g300">Market complexity</h3><p class="t-body ink-2">With Market Access enabled, Basic enables buy/sell indexes. Margin adds a maintenance obligation, Shorting adds finite borrowable units and deterministic buy-ins, and Derivatives adds fully collateralized calls and puts. Every tier uses the same server candidate list for humans and bots.</p>`
});
const marketRulesChapter = RULES_SECTIONS.find((section) => section.id === "casino-market");
if (marketRulesChapter) marketRulesChapter.content = marketRulesChapter.content.replace("without margin, shorting, options, or real-world securities.", "with staged margin, shorting, and fully collateralized options when the host enables a higher Market Complexity tier; real-world securities remain excluded.");

RULES_SECTIONS.push({
  id: "wallet-items",
  label: "WALLET & ITEMS",
  kicker: "20 · INVENTORY",
  title: "Keep, use, or sell",
  status: "LIVE",
  summary: "The host can enable Item Rewards with either preset. Surprise and Treasure then include bonds and keepsakes. Open Wallet & Items to manage your inventory.",
  content: `<div class="rules-term-grid"><div><strong class="t-label f12 g100">PRISON KEY · SELL $25</strong><p class="t-body ink-2">Spend one before rolling on your turn in prison. It follows the existing prison-card rules.</p></div><div><strong class="t-label f12 g100">PARLOR BOND · SELL $50</strong><p class="t-body ink-2">Redeem for $100 after two rounds. Each bond shows its maturity round. Selling early pays $50.</p></div><div><strong class="t-label f12 g100">SILVER KEEPSAKE · SELL $75</strong><p class="t-body ink-2">Keep it or sell it to the bank. It has no additional use effect.</p></div></div><ul class="rules-bullets"><li>Item Rewards starts off. Classic prison cards still work when it is off, with no bank sale or added net worth.</li><li>Each item can be used or sold once. Items cannot be traded or exchanged. Unavailable actions show the reason.</li><li>Sales and mature bond redemptions can raise cash during debt rescue. Pending decisions can restrict use; the server checks each action.</li><li>Net worth includes the current realizable value: bonds count as $50 before maturity and $100 when mature. Reward reductions apply when items are granted.</li><li>Inventory is private, reconnects restore it, and a new match resets it. Bankruptcy and seat removal settle it once under the table's exit rules.</li></ul>`,
});

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
  const activeVariant = state.ruleset?.boardVariant || state.boardVariant || "standard-40";
  const isMetro = activeVariant === "metro-52";
  const activeContract = active.id === "board-tiles" ? `<div class="rules-inline-note"><span class="t-micro g400">ACTIVE BOARD</span><span class="t-body ink-2">${esc(String(activeVariant).toUpperCase())} · ${isMetro ? "52 SPACES · 13 PER SIDE · CORNERS 0/13/26/39 · UP TO 6 PLAYERS" : "40 SPACES · 10 PER SIDE · CORNERS 0/10/20/30 · 2–4 PLAYERS"}</span></div>` : "";
  return `<article class="rules-book-page noise" aria-labelledby="rules-book-page-heading"><div class="rules-book-page-scroll thin-scroll" id="rules-book-page-scroll"><div class="rules-article-head"><div><h2 class="t-section g100" id="rules-book-page-heading" tabindex="-1">${active.title}</h2><p class="t-body ink-2 rules-article-summary">${active.summary}</p></div></div>${activeContract}<div class="rules-article-body">${active.content}</div></div><footer class="rules-book-page-footer"><button class="btn-dark rules-page-turn" type="button" data-rules-section="${prevNav.id}" ${prevNav.disabled}><span aria-hidden="true">‹</span><span class="t-label f11">${prevNav.label}</span></button><span class="t-micro ink-3">${String(activeIndex + 1).padStart(2, "0")} / ${String(RULES_SECTIONS.length).padStart(2, "0")}</span><button class="btn-dark rules-page-turn" type="button" data-rules-section="${nextNav.id}" ${nextNav.disabled}><span aria-hidden="true">›</span><span class="t-label f11">${nextNav.label}</span></button></footer></article>`;
}

function rulesEmptyArticleHTML() {
  return `<article class="rules-book-page"><div class="rules-book-page-scroll"><div class="rules-empty"><span class="t-micro g400">NO MATCH IN THIS MANUAL</span><strong class="t-label f13 g100">Try another phrase.</strong></div></div></article>`;
}

// Chapters most players need are always listed; the optional systems sit behind one fold.
const MORE_SECTION_IDS = new Set(["global-events", "casino-market", "bots", "social-profile", "achievements", "lobby-settings", "reconnect-accessibility", "rulesets-market", "wallet-items"]);

function rulesIndexLinkHTML(section, index, active) {
  return `<button class="rules-index-link${indexLinkClasses(section, active)}" type="button" data-rules-section="${section.id}" aria-current="${indexAriaCurrent(section, active)}"><span class="rules-index-number">${String(index + 1).padStart(2, "0")}</span><span>${section.label}</span></button>`;
}

function rulesIndexLinksHTML(active) {
  const core = [];
  const more = [];
  RULES_SECTIONS.forEach((section, index) => {
    (MORE_SECTION_IDS.has(section.id) ? more : core).push(rulesIndexLinkHTML(section, index, active));
  });
  const open = active && MORE_SECTION_IDS.has(active.id);
  return `${core.join("")}<details class="rules-more"${open ? " open" : ""}><summary class="t-label f11">MORE SYSTEMS · ${more.length}</summary>${more.join("")}</details>`;
}

function indexLinkClasses(section, active) {
  const selected = section.id === active?.id ? " is-active" : "";
  return selected;
}

function indexAriaCurrent(section, active) {
  if (section.id === active?.id) return "page";
  return "false";
}

export function renderRulesSurface(target = "#rules-page-content") {
  const root = $(target);
  if (!root) return;
  const requested = rulesSectionById(state.rulesSection);
  const active = requested || RULES_SECTIONS[0];
  if (active) state.rulesSection = active.id;
  const activeIndex = active ? RULES_SECTIONS.findIndex((section) => section.id === active.id) : -1;
  const previous = previousSection(activeIndex);
  const next = nextSection(activeIndex);
  const prevNav = rulesPrevNav(previous);
  const nextNav = rulesNextNav(next);
  const article = active ? rulesArticleHTML(active, activeIndex, prevNav, nextNav) : rulesEmptyArticleHTML();
  const indexExpanded = state.rulesIndexExpanded === true;
  root.innerHTML = `<div class="rules-shell">
    <div class="rules-intro panel noise">
      <div class="rules-intro-icon"><img src="/assets/rules-book.svg" alt="" width="36" height="36"></div>
      <div class="rules-intro-copy"><h1 class="t-section g100" id="rules-page-title">How to play Poorup</h1><p class="t-body ink-2">Plain rules, one short chapter at a time.</p></div>
      <div class="rules-toolbar"><span class="t-micro ink-3">${RULES_SECTIONS.length} CHAPTERS</span></div>
    </div>
    <div class="rules-book-spread">
      <aside class="rules-index panel noise${indexExpanded ? " is-index-open" : ""}" aria-label="Rules sections"><div class="rules-index-head"><span class="t-micro g400">CONTENTS</span><button class="btn-dark rules-chapters-toggle" type="button" data-rules-chapters-toggle aria-controls="rules-index-nav" aria-expanded="${indexExpanded}"><span class="t-label f11">${indexExpanded ? "CLOSE CHAPTERS" : "CHAPTERS"}</span><span class="t-micro ink-3">${RULES_SECTIONS.length}</span></button></div><nav class="rules-index-nav" id="rules-index-nav" aria-label="Rules chapters">${rulesIndexLinksHTML(active)}</nav></aside>
      ${article}
    </div>
  </div>`;
  hydrateSprites(root);
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
  if (state.selectedPlayer.accountLinked && state.selectedPlayer.roomPlayerId) {
    host.emitServer("get-public-player-card", { roomPlayerId: state.selectedPlayer.roomPlayerId }, publicPlayerAck);
  } else if (state.selectedPlayer.accountId) {
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
  if (Number.isInteger(participant?.finalPlacement) && participant.finalPlacement > 0) return participant.finalPlacement === 1;
  if (entry.won === true) return true;
  return entry.result === 'WIN';
}

function placementHistoryResult(participant) {
  if (!Number.isInteger(participant?.finalPlacement)) return '';
  if (participant.finalPlacement <= 0) return '';
  if (participant.finalPlacement === 1) return 'WIN';
  return 'PLACE ' + participant.finalPlacement;
}

function declaredHistoryResult(entry) {
  if (entry.won === true) return 'WIN';
  if (entry.result === 'WIN') return 'WIN';
  if (entry.won === false) return 'LOSS';
  if (entry.result === 'LOSS' || entry.result === 'LOST') return 'LOSS';
  return 'RESULT NOT RECORDED';
}

// A bankrupt finish reads BANKRUPT here exactly as it does in the owner's own
// profile history, instead of a bare placement number.
function historyRowResult(participant, entry) {
  if (participant?.bankrupt === true) return 'BANKRUPT';
  const placement = placementHistoryResult(participant);
  if (placement) return placement;
  return declaredHistoryResult(entry);
}

function historyRowDate(entry) {
  return formatHistoryDate(entry.completedAt || entry.playedAt, 'UNKNOWN DATE');
}

function historyRowDeeds(participant, entry) {
  if (participant?.propertyCount != null) return participant.propertyCount;
  if (entry.properties != null) return entry.properties;
  return 'NOT RECORDED';
}

function playerHistoryMetaHTML(participants, deeds, events, combos) {
  const eventsTone = events !== 'NOT RECORDED' && events ? 'g300' : 'ink-3';
  const combosTone = combos !== 'NOT RECORDED' && combos ? 'g300' : 'ink-3';
  return '<div class="player-history-meta"><span class="t-micro ink-3">' + esc(String(participants)) + ' PLAYERS</span><span class="t-micro ink-3">' + esc(String(deeds)) + ' DEEDS</span><span class="t-micro ' + eventsTone + '">' + esc(String(events)) + ' EVENTS</span><span class="t-micro ' + combosTone + '">' + esc(String(combos)) + ' COMBOS</span></div></article>';
}

function historyRowHTML(entry, index, history, player) {
  const participant = historyParticipant(entry, player);
  const won = historyRowWon(participant, entry);
  const result = historyRowResult(participant, entry);
  const date = historyRowDate(entry);
  const deeds = historyRowDeeds(participant, entry);
  const participants = Array.isArray(entry.participants) ? entry.participants.length : 'NOT RECORDED';
  const events = Array.isArray(entry.globalEvents) ? entry.globalEvents.length : 'NOT RECORDED';
  const combos = Array.isArray(entry.eventCombinations) ? entry.eventCombinations.length : 'NOT RECORDED';
  const bankrupt = result === 'BANKRUPT';
  const tone = won ? 'green' : bankrupt ? 'red' : 'g100';
  return '<article class="player-history-row' + (won ? ' is-win' : '') + (bankrupt ? ' is-bankrupt' : '') + '"><div class="player-history-main"><span class="t-micro ink-3">' + esc(date) + ' · MATCH ' + String(history.length - index).padStart(2, '0') + '</span><strong class="t-label f12 ' + tone + '">' + esc(result) + '</strong></div>' + playerHistoryMetaHTML(participants, deeds, events, combos);
}

export function playerHistoryHTML(history, player) {
  const scope = state.selectedPlayerHistoryScope || "all";
  const filtered = history.filter((entry) => historyScopeMatch(entry, scope));
  if (!filtered.length) return '<p class="t-body ink-3 social-empty">NO MATCHES IN THIS HISTORY VIEW.</p>';
  // Number each match by its place in the full history, so a scope filter never renumbers rows.
  return filtered.map((entry) => historyRowHTML(entry, history.indexOf(entry), history, player)).join('');
}

function currentFriendStatus(accountId) {
  if (state.selectedPlayerRelationship !== "none") return state.selectedPlayerRelationship;
  const friends = state.social.friends || [];
  if (friends.some((friend) => friend.id === accountId || friend.publicId === accountId || friend.username === accountId)) return "accepted";
  return "none";
}

function friendButtonLabel(status) {
  if (status === "accepted") return "REMOVE FRIEND";
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
  const achievements = player.achievementsPrivate ? "PRIVATE" : player.achievementsFriendsOnly ? "FRIENDS ONLY" : (player.achievements?.length ?? "—");
  const mutual = player.mutualFriends ?? "—";
  return { games, wins, achievements, mutual };
}

function disabledWhen(off) {
  return off ? "disabled" : "";
}

function playerActionBits(player, canSocial, friendStatus) {
  const friendReady = canSocial && friendStatus !== "requested";
  return {
    friendAttr: disabledWhen(!friendReady),
    canSocialAttr: disabledWhen(!canSocial),
    historyAttr: disabledWhen(!canSocial || player.historyPrivate),
  };
}

function playerActionPanelHTML(player, canSocial, actions, friendLabel) {
  if (!canSocial) {
    const copy = player.id === "p1"
      ? "THIS IS YOUR PLAYER CARD · USE PROFILE FOR PRIVATE DETAILS"
      : player.bot
        ? "BOT SEAT · NO SOCIAL ACCOUNT LINKED"
        : "GUEST SEAT · SOCIAL ACTIONS NEED AN ACCOUNT";
    return `<p class="t-micro ink-3 player-profile-actions-note">${copy}</p>`;
  }
  return `<button class="cta-red" type="button" data-player-action="friend" ${actions.friendAttr}><span class="cta-text cta-text-sm">${friendLabel}</span></button><button class="btn-dark" type="button" data-player-action="invite" ${actions.canSocialAttr}><span class="t-label f11">INVITE TO ROOM</span></button><button class="btn-dark" type="button" data-player-action="history" ${actions.historyAttr}><span class="t-label f11">MATCH HISTORY</span></button><button class="btn-dark" type="button" data-player-action="block" ${actions.canSocialAttr}><span class="t-label f11">BLOCK</span></button><button class="btn-dark" type="button" data-player-action="report" ${actions.canSocialAttr}><span class="t-label f11">REPORT</span></button>`;
}

function placementLabel(participant) {
  if (participant?.finalPlacement === 1) return "WIN";
  if (participant?.finalPlacement) return "PLACE " + participant.finalPlacement;
  return "MATCH";
}

function playerMatchRowHTML(match, player) {
  const participants = match.participants || [];
  const participant = participants.find((entry) => entry.isViewedPlayer)
    || participants.find((entry) => entry.displayNameAtMatch === player.displayName);
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
  return [["all", "ALL"], ["with-me", "WITH ME"], ["global", "GLOBAL EVENTS"]].map(([id, label]) => `<button class="player-history-scope${state.selectedPlayerHistoryScope === id ? " is-active" : ""}" type="button" role="tab" data-player-history-scope="${id}" aria-selected="${state.selectedPlayerHistoryScope === id}"><span class="t-label f11">${label}</span></button>`).join("");
}

function renderPlayerHistoryView(card, player) {
  const history = state.selectedPlayerHistory || [];
  const name = esc(player.displayName || player.name);
  const scopes = historyScopesHTML();
  card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER RECORD · SHARED VIEW</div><h2 class="t-section g100" id="player-modal-title">${name}</h2><p class="t-body ink-2" id="player-modal-description">Recent match records visible to you.</p></div>${closeButtonHTML({ id: "player-modal-close", label: "Close player profile", className: "social-close" })}</div><div class="player-history-scopes" role="tablist" aria-label="Match history scope">${scopes}</div><div class="player-history-list thin-scroll">${playerHistoryHTML(history, player)}</div><button class="btn-dark social-back" id="player-modal-back" type="button"><span class="t-label f11">BACK TO PLAYER</span></button>`;
}

function isVoteKickPhase(phase) {
  return ["lobby", "playing"].includes(phase);
}

function isEligibleVoteKickTarget(player, localId, targetId) {
  if (player.bot) return false;
  if (player.bankrupt) return false;
  if (player.spectating) return false;
  return String(targetId) !== String(localId);
}

function isActiveHumanForVote(player) {
  return [!player.bot, !player.bankrupt, !player.spectating].every(Boolean);
}

function playerVoteKickHTML(player, localId, targetId) {
  if (!isVoteKickPhase(state.phase)) return "";
  if (!isEligibleVoteKickTarget(player, localId, targetId)) return "";
  const activeHumans = state.players.filter(isActiveHumanForVote);
  const voteDisabled = activeHumans.length < 3;
  const help = voteDisabled ? "A vote needs at least three human seats." : "A passed vote removes this seat from the room.";
  const disabled = voteDisabled ? 'disabled aria-describedby="player-votekick-help"' : "";
  return `<div class="player-profile-votekick"><button class="btn-dark" type="button" data-player-action="vote-kick" ${disabled}><span class="t-label f11">START VOTE KICK</span></button><span class="t-micro ink-3" id="player-votekick-help">${help}</span></div>`;
}

function playerProfileViewModel(player, accountId) {
  const friendStatus = currentFriendStatus(accountId);
  const friendLabel = friendButtonLabel(friendStatus);
  const isSelf = player.id === "p1";
  const canSocial = Boolean(player.accountId && !isSelf);
  const bits = playerIdentityBits(player);
  const facts = playerFactsBits(player);
  const actions = playerActionBits(player, canSocial, friendStatus);
  const localId = state.players[0]?.serverId || state.players[0]?.id;
  const targetId = player.serverId || player.roomPlayerId || player.id;
  return {
    player,
    bits,
    facts,
    canSocial,
    actions,
    friendLabel,
    voteAction: playerVoteKickHTML(player, localId, targetId),
  };
}

function playerProfileHTML(view) {
  const { player, bits, facts, canSocial, actions, friendLabel, voteAction } = view;
  return `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER CARD · IN THIS ROOM</div><h2 class="t-section g100" id="player-modal-title">${bits.name}</h2><p class="t-body ink-2" id="player-modal-description">Public details only. Private cash, loans, and hidden records stay hidden.</p></div>${closeButtonHTML({ id: "player-modal-close", label: "Close player profile", className: "social-close" })}</div><div class="player-profile-head"><div class="player-profile-avatar">${avatarHTML(player, 6, 0)}</div><div><strong class="t-label f14 g100">${bits.name}</strong><span class="t-micro ink-3">${bits.online}</span></div></div><div class="player-profile-facts"><div><span class="t-micro ink-3">GAMES</span><strong class="t-label f13 g100">${facts.games}</strong></div><div><span class="t-micro ink-3">WINS</span><strong class="t-label f13 green">${facts.wins}</strong></div><div><span class="t-micro ink-3">ACHIEVEMENTS</span><strong class="t-label f13 g300">${facts.achievements}</strong></div><div><span class="t-micro ink-3">MUTUAL FRIENDS</span><strong class="t-label f13 g300">${facts.mutual}</strong></div></div><div class="player-profile-actions">${playerActionPanelHTML(player, canSocial, actions, friendLabel)}</div>${voteAction}`;
}

function renderPlayerProfileView(card, player, accountId) {
  const view = playerProfileViewModel(player, accountId);
  card.innerHTML = playerProfileHTML(view);
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
