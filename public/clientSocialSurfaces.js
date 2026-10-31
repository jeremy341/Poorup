// SOCIAL SURFACES: friends/rankings/player/rules pages and the
// parlor toast announcer. Server fetches and view switching are
// injected by the entry module; everything else is local DOM.
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


// Inside a game, Rankings and Social render the same content as their pages. Only the exit
// differs: pages leave through the site header, while the in-game copy returns to the table.
// Closing it never leaves the room. The seat, connection, turn timer and pending prompt stay put.
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
  return `<div class="social-signin-note"><span class="t-label f13 g100">ACCOUNT REQUIRED</span><p class="t-body ink-2">Create an account to keep friends, invitations, and social history across rooms.</p></div>`;
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
  return social.invites?.length ? social.invites.map((invite) => `<div class="social-invite-row"><div><strong class="t-label f12 g100">${esc(invite.roomName || "AFTER HOURS")}</strong><span class="t-micro ink-3">${String(invite.visibility || "public").toUpperCase()} ROOM · EXPIRES ${esc(socialDateLabel(invite.expiresAt) || "-")}</span></div><div class="social-request-actions"><button class="cta-red" type="button" data-social-invite="accept" data-invite-id="${esc(invite.id)}"><span class="cta-text cta-text-sm">JOIN</span></button><button class="btn-dark" type="button" data-social-invite="decline" data-invite-id="${esc(invite.id)}"><span class="t-label f11">DECLINE</span></button></div></div>`).join("") : `<p class="t-body ink-3 social-empty">NO ROOM INVITES.</p>`;
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
  const roomValue = home ? "-" : esc(state.roomCode || "PUBLIC");
  const seatedValue = home ? "-" : state.players.length;
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

function focusedSocialPlayerId(card, active) {
  if (!card.contains?.(active)) return null;
  return active.closest?.("[data-social-player]")?.dataset.socialPlayer ?? null;
}

function socialRequestFocusWanted(card, active) {
  if (!card.contains?.(active)) return false;
  return Boolean(active.dataset?.friendshipId || active.matches?.(".social-feed"));
}

function captureSocialFocus(card) {
  const active = document.activeElement;
  return {
    playerId: focusedSocialPlayerId(card, active),
    requestFocus: socialRequestFocusWanted(card, active),
    friendshipId: active?.dataset?.friendshipId,
    action: active?.dataset?.socialRequest,
    cancel: active?.hasAttribute?.("data-social-request-cancel"),
  };
}

function focusSocialReplacement(card, replacement) {
  (replacement || card.querySelector(".social-feed"))?.focus({ preventScroll: true });
}

function matchesSocialRequestControl(button, focus) {
  const sameControl = focus.cancel ? button.hasAttribute("data-social-request-cancel") : button.dataset.socialRequest === focus.action;
  return button.dataset.friendshipId === focus.friendshipId && sameControl && !button.disabled;
}

function restoreSocialFocus(card, focus) {
  if (focus.playerId) {
    focusSocialReplacement(card, [...card.querySelectorAll("[data-social-player]")].find(button => button.dataset.socialPlayer === focus.playerId));
  }
  if (focus.requestFocus) {
    const controls = focus.friendshipId ? [...card.querySelectorAll("[data-friendship-id]")] : [];
    focusSocialReplacement(card, controls.find(button => matchesSocialRequestControl(button, focus)));
  }
}

export function renderSocialSurface(target = "#social-card") {
  const card = surfaceCard(target, "#social-card");
  if (!card) return;
  const focus = captureSocialFocus(card);
  const view = socialSurfaceView(card);
  card.innerHTML = socialHeroMarkup(view);
  const guestContent = card.querySelector("[data-social-guest-content]");
  if (guestContent) guestContent.inert = !view.signedIn;
  restoreSocialFocus(card, focus);
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
    label: "THE GOAL",
    kicker: "01 · THE GOAL",
    title: "Last player with money wins",
    summary: "Buy property, collect rent, and stay in the game longer than everyone else.",
    content: `<div class="rules-callout"><strong class="t-label f13 g100">THE SHORT VERSION</strong><p class="t-body ink-2">Roll the dice and move around the board. Buy the properties you land on. Other players pay you rent when they land on your property. The last player still in the game wins.</p></div><h3 class="t-section g300">What you need</h3><ul class="rules-bullets"><li>Two to four players on Standard 40, or up to six on Metro 52.</li><li>Each player starts with the starting cash the host sets. The default is $1,500.</li><li>The page below explains each part of the game in the order you will meet it.</li></ul>`,
  },
  {
    id: "board-tiles",
    label: "THE BOARD",
    kicker: "02 · THE BOARD",
    title: "Move clockwise around the board",
    summary: "Standard 40 and Metro 52 have different space counts and seat limits. The board you are playing on is shown in the lobby.",
    content: `<div class="rules-board-order"><div><span class="t-micro g400">STANDARD 40 · CLOCKWISE INDEX</span><strong class="t-label f20 g100">0 → 39</strong></div><div><span class="t-micro g400">STANDARD 40 · CORNERS</span><strong class="t-label f12 g100">GO · PASSING BY / PRISON · VACATION · GO TO PRISON</strong></div></div><p class="t-body ink-2">Standard 40 supports two to four players. It has 40 spaces, with 10 on each side. Metro 52 supports up to six players. It has 52 spaces, with 13 on each side.</p><h3 class="t-section g300">Kinds of space</h3><div class="rules-term-grid"><div><strong class="t-label f12 g100">PROPERTY</strong><p class="t-body ink-2">A deed you can buy. Rent is charged when someone lands on it.</p></div><div><strong class="t-label f12 g100">AIRPORT &amp; UTILITY</strong><p class="t-body ink-2">Airports and utilities are deeds too. They follow their own rent rules.</p></div><div><strong class="t-label f12 g100">CARD</strong><p class="t-body ink-2">Surprise and Treasure. Draw the top card and follow it.</p></div><div><strong class="t-label f12 g100">TAX</strong><p class="t-body ink-2">Earnings Tax and Premium Tax take cash from you.</p></div><div><strong class="t-label f12 g100">CORNER</strong><p class="t-body ink-2">GO, Passing By / Prison, Vacation, and Go to Prison.</p></div></div>`,
  },
  {
    id: "turn-flow",
    label: "YOUR TURN",
    kicker: "03 · YOUR TURN",
    title: "Each turn has four steps",
    summary: "Roll, move, decide, end. The game will not let you skip a required decision.",
    content: `<div class="rules-code-flow"><span>ROLL</span><i>→</i><span>MOVE</span><i>→</i><span>LAND</span><i>→</i><span>DECIDE</span><i>→</i><span>END TURN</span></div><ol class="rules-steps"><li><span class="rules-step-number">01</span><div><strong class="t-label f12 g100">ROLL</strong><p class="t-body ink-2">Roll the dice once. Your piece moves one space at a time.</p></div></li><li><span class="rules-step-number">02</span><div><strong class="t-label f12 g100">LAND</strong><p class="t-body ink-2">Follow the space you land on. You may need to buy, pay rent, draw a card, or pay a tax.</p></div></li><li><span class="rules-step-number">03</span><div><strong class="t-label f12 g100">DECIDE</strong><p class="t-body ink-2">Buy property, build houses, trade, or take a loan. Building is only allowed on your own turn, after you roll.</p></div></li><li><span class="rules-step-number">04</span><div><strong class="t-label f12 g100">END TURN</strong><p class="t-body ink-2">Press End Turn when you are done. The next player then takes their turn.</p></div></li></ol><h3 class="t-section g300">Good to know</h3><ul class="rules-bullets"><li>A purchase must be bought, passed to auction, or declined before you can end your turn.</li><li>A card, a debt you owe, or a trade offer you received can hold up your turn until you answer it.</li><li>Only the active player can roll or take turn actions.</li><li>Players have unlimited time for each turn. If you do nothing for 30 seconds, a 3-minute countdown starts. A player idle for 3 minutes can be removed by inactivity.</li></ul><div class="rules-inline-note"><span class="t-micro g400">ROUND</span><span class="t-body ink-2">A round ends when every player has had one turn. Global events count rounds.</span></div>`,
  },
  {
    id: "cash-bank",
    label: "MONEY",
    kicker: "04 · MONEY",
    title: "Money comes in and goes out",
    summary: "Passing GO pays you. Rent, taxes, fines, and purchases take money out. Every payment shows in the log.",
    content: `<h3 class="t-section g300">How you get money</h3><ul class="rules-bullets"><li>Passing GO pays $200.</li><li>Landing exactly on GO pays $400 when Double GO is on. Otherwise it pays $200.</li><li>Card rewards, rent from other players, and sales to the bank also add cash.</li></ul><h3 class="t-section g300">How you spend money</h3><ul class="rules-bullets"><li>Buying a deed costs its printed price.</li><li>Rent is paid to the owner of a deed you land on.</li><li>Earnings Tax costs $200. Premium Tax costs $75.</li><li>Getting out of jail with the fine costs $50.</li><li>Cards can also ask you to pay.</li></ul><h3 class="t-section g300">Vacation Pool</h3><p class="t-body ink-2">The Vacation Pool is on by default. Taxes and some penalties go into the pool in the center. The player who lands on Vacation collects the whole pool. The host can turn it off.</p><div class="rules-warning"><span class="t-micro red">YOU CAN'T GO NEGATIVE</span><span class="t-body ink-2">If a payment is more than your cash, the game stops and asks you to fix the debt. See End of Game.</span></div>`,
  },
  {
    id: "properties",
    label: "PROPERTY",
    kicker: "05 · PROPERTY",
    title: "Buy property and collect rent",
    summary: "Buy deeds you land on. Own every deed in a color group to raise the rent.",
    content: `<h3 class="t-section g300">Buying</h3><p class="t-body ink-2">When you land on a property nobody owns, you can buy it for the printed price. If Auction is on and you pass, the deed goes to auction. The highest bidder wins it.</p><h3 class="t-section g300">Rent</h3><ul class="rules-bullets"><li>The rent for each deed is shown on the deed. Rent goes up as the owner adds houses and hotels.</li><li>A color strip is the colored band on a deed. Deeds that share a color are one group.</li><li>Own every deed in a group to hold a monopoly. With Double Rent on, the rent doubles while you hold the whole group.</li><li>A mortgaged deed collects no rent until it is paid off.</li><li>Rent is calculated by the server, so it always matches the deed.</li></ul>`,
  },
  {
    id: "support-spaces",
    label: "AIRPORTS & UTILITIES",
    kicker: "06 · AIRPORTS & UTILITIES",
    title: "Airports and utilities",
    summary: "Airports and utilities are deeds that follow their own rent rules. They are not part of a color group.",
    content: `<div class="rules-term-grid"><div><strong class="t-label f12 g100">AIRPORTS</strong><p class="t-body ink-2">ACC, BKK, AMS, and MB Airport. Each costs $200. Rent goes up with each airport you own: $25, $50, $100, then $200 for all four.</p></div><div><strong class="t-label f12 g100">UTILITIES</strong><p class="t-body ink-2">Electric Company and Water Company. Each costs $150. Rent is a multiple of the dice roll, and owning both raises the multiple.</p></div></div><h3 class="t-section g300">Flights</h3><p class="t-body ink-2">Flights is an optional add-on, and it is off by default. When it is on, airports can charge fees for landing or taking off.</p>`,
  },
  {
    id: "build-mortgage",
    label: "HOUSES & MORTGAGES",
    kicker: "07 · HOUSES & MORTGAGES",
    title: "Build houses or borrow against a deed",
    summary: "Build during your turn. Mortgage a deed when you need cash fast.",
    content: `<h3 class="t-section g300">Houses and hotels</h3><ul class="rules-bullets"><li>Build only on your own turn, after you roll. You may build houses and hotels before ending your turn.</li><li>Build evenly. You cannot add a second house to one deed until every deed in the group has one.</li><li>Each deed can hold four houses. A fifth build makes one hotel, and the hotel replaces the four houses.</li><li>Selling a house or hotel returns half its cost. You can sell buildings evenly for half their cost on any turn, unless an event changes the rate.</li><li>There is no shared limit on houses or hotels.</li></ul><h3 class="t-section g300">Mortgage</h3><ul class="rules-bullets"><li>A mortgage is a loan from the bank, secured by one of your deeds. You get cash now.</li><li>Mortgaging an owned deed may happen on any turn.</li><li>While a deed is mortgaged, it collects no rent.</li><li>To mortgage a deed, sell every building in its color group first.</li><li>A mortgaged deed can still be traded.</li><li>A deed used as loan security cannot be mortgaged or traded until the loan is paid off.</li></ul>`,
  },
  {
    id: "trade-auction",
    label: "TRADES & AUCTIONS",
    kicker: "08 · TRADES & AUCTIONS",
    title: "Trade with players, or bid at auction",
    summary: "Trades need both players to agree. Auctions run on a short timer.",
    content: `<h3 class="t-section g300">Trades</h3><ul class="rules-bullets"><li>Trading must be on. The host sets it in the lobby.</li><li>Pick the deeds and cash you want to offer, then send the offer.</li><li>The other player accepts, declines, or counter-offers.</li><li>Before you trade a deed, sell every house and hotel in its color group.</li><li>Both players must still have the deeds and cash in the offer when it is accepted.</li></ul><h3 class="t-section g300">Auctions</h3><ul class="rules-bullets"><li>An auction starts when a player passes a deed nobody owns, and Auction is on.</li><li>Bid with the cash you have.</li><li>Each valid bid resets the five-second timer.</li><li>When the timer runs out, the highest bid wins and is paid.</li><li>There is no pass action during an auction. You can bid until the timer runs out.</li></ul>`,
  },
  {
    id: "cards",
    label: "SURPRISE & TREASURE",
    kicker: "09 · SURPRISE & TREASURE",
    title: "Draw a card and follow it",
    summary: "Surprise and Treasure are two separate decks. The card is shown, and the result is logged.",
    content: `<h3 class="t-section g300">When a card appears</h3><p class="t-body ink-2">Landing on Surprise draws from the Surprise deck. Landing on Treasure draws from the Treasure deck. The card is read out, its effect happens, and the result appears in the log.</p><h3 class="t-section g300">Common card effects</h3><ul class="rules-bullets"><li>Move to a named space. If you pass GO on the way, you collect $200.</li><li>Collect cash from the bank, or pay cash to the bank.</li><li>Collect from every player, or pay every player.</li><li>Pay repairs for each house and hotel you own.</li><li>Go directly to prison.</li><li>Keep a Get Out of Prison card for later use.</li></ul><div class="rules-inline-note"><span class="t-micro g400">ITEM REWARDS</span><span class="t-body ink-2">When Item Rewards is on, about 1 in 40 draws gives you an item instead of a card. See Items.</span></div>`,
  },
  {
    id: "prison-vacation",
    label: "PRISON & CORNERS",
    kicker: "10 · PRISON & CORNERS",
    title: "Prison and the corners",
    summary: "Passing By has two lanes. Going to prison and landing in prison are different things.",
    content: `<div class="rules-callout"><strong class="t-label f13 g100">PASSING BY</strong><p class="t-body ink-2">If you pass this corner on the outside lane, you are not in prison. If you land in the prison lane, you are in prison.</p></div><h3 class="t-section g300">Getting out of prison</h3><ul class="rules-bullets"><li>Pay the $50 fine.</li><li>Use a Get Out of Prison card.</li><li>After 3 turns in jail, the $50 fine is charged automatically if you can pay it.</li></ul><p class="t-body ink-2">Go to Prison sends you straight to prison. You do not collect the $200 for passing GO. Vacation is a neutral corner. With the Vacation Pool on, landing there collects the pool.</p>`,
  },
  {
    id: "wallet-items",
    label: "ITEMS",
    kicker: "11 · ITEMS",
    title: "Keep, use, or sell an item",
    summary: "Items come from the Surprise and Treasure decks when Item Rewards is on. Open Cash On Hand to see your Wallet & Items.",
    content: `<div class="rules-term-grid"><div><strong class="t-label f12 g100">PRISON KEY · SELL $25</strong><p class="t-body ink-2">Use it before you roll, on your turn in prison, to leave. It works like a Get Out of Prison card.</p></div><div><strong class="t-label f12 g100">PARLOR BOND · SELL $400</strong><p class="t-body ink-2">Sell it to the bank for $400 at any time. Or wait two rounds, then redeem it for $800.</p></div><div><strong class="t-label f12 g100">SILVER KEEPSAKE · SELL $600</strong><p class="t-body ink-2">A collectible with no use. Sell it to the bank for $600.</p></div></div><h3 class="t-section g300">Rules for items</h3><ul class="rules-bullets"><li>Item Rewards is off by default. The host can turn it on in the lobby.</li><li>Each item can be used or sold once.</li><li>Items cannot be traded or exchanged.</li><li>If an action is not available, the Wallet shows why.</li><li>Net worth counts a Parlor Bond at $400 until it matures, then at $800.</li><li>Your items are private. They come back if you reconnect. A new match starts with none.</li></ul><h3 class="t-section g300">Bank fees on sales</h3><p class="t-body ink-2">With Bank Accounts on, the bank keeps a fee when you sell an item. The fee depends on your account tier: 10% on Standard, 5% on Parlor Premium, and none on Parlor Black. On Standard, a Parlor Bond sells for $360. Redeeming a matured bond is not a sale, so it has no fee.</p><div class="rules-inline-note"><span class="t-micro g400">DEBT RESCUE</span><span class="t-body ink-2">If you owe money, selling or redeeming items is one way to pay it. This is debt rescue. See End of Game.</span></div>`,
  },
  {
    id: "loans",
    label: "BANK LOANS",
    kicker: "12 · BANK LOANS",
    title: "Borrow when you need cash",
    summary: "Bank loans and player loans are optional. Each one has a set amount, interest, and a due date.",
    content: `<h3 class="t-section g300">Bank loans</h3><ul class="rules-bullets"><li>Bank loans are optional. The host turns them on in the lobby.</li><li>The bank lends you cash and holds one of your deeds as security.</li><li>A loan has a due date and total interest, set when you take it out.</li><li>The deed cannot be traded or mortgaged until you repay the loan.</li><li>If you default, the deed is credited against the unpaid balance. You receive no extra cash, and any balance still owed stays on your record.</li><li>The host chooses the interest level: Fair, Predatory, or Extreme.</li></ul><h3 class="t-section g300">Player loans</h3><p class="t-body ink-2">Player loans are optional, and the host turns on Player Finance. You can offer cash to another player. They can accept, decline, or counter. You can change or cancel your offer until it is accepted.</p><h3 class="t-section g300">Rent shares</h3><p class="t-body ink-2">One player can pay another for a share of the rent from a deed. The share lasts 1 to 20 rounds, and the default is 3. The owner keeps the deed and does the building. The other player only gets the agreed share of rent. The share ends when its rounds run out, or when either player leaves or goes bankrupt.</p>`,
  },
  {
    id: "end-of-game",
    label: "END OF GAME",
    kicker: "13 · END OF GAME",
    title: "Debt, bankruptcy, and the winner",
    summary: "You cannot end your turn while you owe money. If you cannot pay, you go bankrupt and the game goes on.",
    content: `<h3 class="t-section g300">Owing money</h3><p class="t-body ink-2">If a payment is more than your cash, you must pay it before you can end your turn. You can fix it by selling buildings, selling or redeeming items, mortgaging deeds, trading, or taking a loan. This is called debt rescue.</p><h3 class="t-section g300">Bankruptcy</h3><ul class="rules-bullets"><li>If you cannot pay and have no way left to raise cash, you go bankrupt.</li><li>A human player becomes a read-only spectator. They can watch, but cannot play.</li><li>Your token leaves the board, and the Sidebar shows SPECTATING.</li><li>If someone is owed money, they receive your deeds and cash that can be transferred. If the bank is owed, the deeds return to the bank.</li><li>Bots that go bankrupt are removed from the table.</li></ul><h3 class="t-section g300">Winning</h3><p class="t-body ink-2">The last player still in the game wins.</p>`,
  },
  {
    id: "global-events",
    label: "GLOBAL EVENTS",
    kicker: "14 · GLOBAL EVENTS",
    title: "Rare events change the whole table",
    summary: "Global events are optional. They affect everyone at once and always show a banner.",
    content: `<h3 class="t-section g300">How events work</h3><ul class="rules-bullets"><li>Global events are off by default. The host turns them on with one switch.</li><li>Early rounds are calm. Negative events can start later.</li><li>A warning appears before a negative event starts.</li><li>Only one event normally runs at a time.</li><li>The banner shows how many rounds are left.</li></ul><h3 class="t-section g300">What an event can change</h3><p class="t-body ink-2">An event can change rent, building costs, taxes, loan interest, airport and utility rules, market prices, and casino limits. An event never changes a payment that has already happened.</p><div class="rules-warning"><span class="t-micro red">FAIR ODDS</span><span class="t-body ink-2">An event can change a casino limit or fee, but never the red, black, or green odds.</span></div>`,
  },
  {
    id: "casino-market",
    label: "CASINO & MARKET",
    kicker: "15 · CASINO & MARKET",
    title: "Optional side games",
    summary: "The casino and the market are optional. Both use in-game cash only.",
    content: `<h3 class="t-section g300">Casino</h3><p class="t-body ink-2">The casino is a roulette wheel with red, black, and green 0. Its odds are fixed and shown before you bet. You bet your in-game cash. The server holds the bet, settles it once, and logs the result. Loan money cannot be used for bets.</p><h3 class="t-section g300">Market</h3><p class="t-body ink-2">The market is a fictional exchange with made-up indexes for countries, airports, utilities, and property. Prices move at the end of each round. The host picks how advanced it is:</p><ul class="rules-bullets"><li>Basic: buy and sell.</li><li>Margin: buy with borrowed value. You must keep a minimum balance.</li><li>Shorting: bet that a price will fall. There is a limited supply to borrow.</li><li>Derivatives: options that are fully backed by cash you hold.</li></ul><div class="rules-planned"><span class="t-micro g400">VIRTUAL ONLY</span><span class="t-body ink-2">No real money. No deposits, withdrawals, or cash prizes.</span></div>`,
  },
  {
    id: "bots",
    label: "BOTS",
    kicker: "16 · BOTS",
    title: "Bots follow the same rules",
    summary: "Bots take seats in the lobby. They play by the same rules as people and cannot skip turns or cheat on money.",
    content: `<ul class="rules-bullets"><li>Bots buy, pass, build, sell, mortgage, trade, and bid at auction.</li><li>They keep a cash buffer for rent, taxes, and debts.</li><li>They never borrow to gamble, and they cannot see private information.</li><li>AI BOT uses an AI provider when one is available. If the provider fails, it switches to the built-in House Brain.</li><li>NO-AI BOT never calls a provider. It uses only the House Brain.</li></ul>`,
  },
  {
    id: "social-profile",
    label: "PROFILES & FRIENDS",
    kicker: "17 · PROFILES & FRIENDS",
    title: "Profiles, friends, and rankings",
    summary: "Your profile shows your public details, stats, and history. Search friends by username.",
    content: `<h3 class="t-section g300">Profiles</h3><p class="t-body ink-2">Your profile shows your public name, the design you picked, your stats, your match history, and your achievements. Passwords and private account details never appear on a profile.</p><h3 class="t-section g300">Friends</h3><ul class="rules-bullets"><li>Search for friends by their username, not their display name.</li><li>You can send friend requests, block players, report players, and invite friends to a room.</li><li>Click a player in a game to see their card. Your place in the game does not change.</li><li>Your match history is visible to you and your accepted friends. You can choose to share a public summary.</li></ul><h3 class="t-section g300">Rankings</h3><p class="t-body ink-2">Rankings use completed games. They show wins, win rate after five games, achievement score, loan discipline, and bankruptcies.</p>`,
  },
  {
    id: "achievements",
    label: "ACHIEVEMENTS",
    kicker: "18 · ACHIEVEMENTS",
    title: "Badges for special plays",
    summary: "Achievements are badges for things you do in games. They never change the rules of a match.",
    content: `<ul class="rules-bullets"><li>Click an achievement to read what it takes.</li><li>Filter by category, by whether you have earned it, and by rarity.</li><li>Rarity is shown as text and color: Common, Uncommon, Rare, Epic, Legendary, and Mythical.</li><li>A Mythical unlock is announced to every connected player. Your title stays hidden until you choose to show it.</li><li>Achievements never cost cash and never change a live match.</li></ul>`,
  },
  {
    id: "lobby-settings",
    label: "LOBBY SETTINGS",
    kicker: "19 · LOBBY SETTINGS",
    title: "What the host can change",
    summary: "The host sets these before the first round. The lobby shows the active settings so nobody has to guess.",
    content: `<div class="rules-settings-table"><div><strong class="t-label f12 g100">Max Players</strong><span class="t-body ink-2">2–4 seats on Standard 40, up to 6 on Metro 52.</span></div><div><strong class="t-label f12 g100">Bots</strong><span class="t-body ink-2">Fill empty seats with bots, up to the room's capacity.</span></div><div><strong class="t-label f12 g100">Bot Brain</strong><span class="t-body ink-2">AI BOT uses a provider and falls back to the House Brain. NO-AI BOT never calls a provider.</span></div><div><strong class="t-label f12 g100">Bot Difficulty</strong><span class="t-body ink-2">House, Table, or Expert. Higher levels think further ahead. They never break the rules.</span></div><div><strong class="t-label f12 g100">Starting Cash</strong><span class="t-body ink-2">The cash each player gets when the round begins. The default is $1,500.</span></div><div><strong class="t-label f12 g100">Room Visibility</strong><span class="t-body ink-2">Public rooms appear in the directory. Private rooms use a six-character code.</span></div><div><strong class="t-label f12 g100">Vacation Pool</strong><span class="t-body ink-2">On by default. Taxes feed the pool, and landing on Vacation collects it.</span></div><div><strong class="t-label f12 g100">Double GO</strong><span class="t-body ink-2">Landing exactly on GO pays $400 instead of $200.</span></div><div><strong class="t-label f12 g100">Trading</strong><span class="t-body ink-2">Lets players make offers to each other.</span></div><div><strong class="t-label f12 g100">Auction</strong><span class="t-body ink-2">On by default. Passed deeds go to auction.</span></div><div><strong class="t-label f12 g100">Double Rent</strong><span class="t-body ink-2">Off by default. Owning a whole color group doubles its rent.</span></div><div><strong class="t-label f12 g100">Bank Loans</strong><span class="t-body ink-2">Lets players borrow from the bank with a deed as security.</span></div><div><strong class="t-label f12 g100">Loan Severity</strong><span class="t-body ink-2">Fair, Predatory, or Extreme interest.</span></div><div><strong class="t-label f12 g100">Global Events</strong><span class="t-body ink-2">One on/off switch. Timing and strength follow the round count.</span></div><div><strong class="t-label f12 g100">Item Rewards</strong><span class="t-body ink-2">Off by default. Turns on items from the Surprise and Treasure decks.</span></div><div><strong class="t-label f12 g100">Bank Accounts</strong><span class="t-body ink-2">Off by default. Turns on account tiers with sale fees and rebates. See the table below.</span></div></div><h3 class="t-section g300">Bank account tiers</h3><div class="rules-term-grid"><div><strong class="t-label f12 g100">STANDARD · FREE</strong><p class="t-body ink-2">Sale fee 10%. No rebate.</p></div><div><strong class="t-label f12 g100">PARLOR PREMIUM · $200</strong><p class="t-body ink-2">Sale fee 5%. Rebate 10% on market and flight fees.</p></div><div><strong class="t-label f12 g100">PARLOR BLACK · $500</strong><p class="t-body ink-2">No sale fee. Rebate 20% on market and flight fees.</p></div></div><p class="t-body ink-2">Rent, taxes, loans, wagers, and upgrades never earn a rebate.</p><h3 class="t-section g300">Inactivity</h3><p class="t-body ink-2">Turns have no timer. If a player does nothing for 30 seconds, or at once if their game tab is hidden, a 3-minute countdown starts. Everyone can see it. If the player stays idle through it, they can be removed.</p>`,
  },
  {
    id: "reconnect-accessibility",
    label: "RECONNECT & ACCESS",
    kicker: "20 · RECONNECT & ACCESS",
    title: "Reconnecting and accessibility",
    summary: "If you disconnect, you come back to the same place in the game. Keyboard and reduced-motion settings work everywhere.",
    content: `<h3 class="t-section g300">Reconnecting</h3><p class="t-body ink-2">When you reconnect, you get the current board, your seat, the turn, any open payment, the event banner, and your items. Money and cards that already settled are not replayed.</p><h3 class="t-section g300">Accessibility</h3><ul class="rules-bullets"><li>Every action uses a normal button, link, input, or menu.</li><li>Focus rings stay visible.</li><li>Color is never the only signal. Labels, symbols, and text go with it.</li><li>Reduced motion turns off decorative movement. Changes in state still show.</li><li>Sound effects and music have separate on/off switches.</li></ul>`,
  },
  {
    id: "rulesets-market",
    label: "PRESETS",
    kicker: "21 · PRESETS",
    title: "Standard or Advanced",
    summary: "Standard and Advanced set starting defaults. Both presets allow every optional economy system.",
    content: `<h3 class="t-section g300">Two starting presets</h3><ul class="rules-bullets"><li>Standard turns on the classic game: buying, rent, auctions, trades, building, mortgages, cards, prison, and bankruptcy. Optional systems start off.</li><li>Advanced also turns on Player Finance.</li><li>Either preset lets you turn any optional system on or off yourself.</li><li>Your own choices stay when you change presets.</li><li>The lobby shows the rules in effect for the room.</li></ul><h3 class="t-section g300">Market advanced tiers</h3><p class="t-body ink-2">When Market Access is on, Basic is always available. The host can add Margin, Shorting, or Derivatives. Humans and bots use the same list of allowed trades.</p>`,
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
// profile history, not a bare placement number.
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
  const games = player.stats?.gamesPlayed ?? "-";
  const wins = player.stats?.wins ?? "-";
  const achievements = player.achievementsPrivate ? "PRIVATE" : player.achievementsFriendsOnly ? "FRIENDS ONLY" : (player.achievements?.length ?? "-");
  const mutual = player.mutualFriends ?? "-";
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
