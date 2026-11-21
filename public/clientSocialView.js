// SOCIAL VIEW: the friends/requests/invites/recent/inbox surface markup, its
// focus-preserving renderer and the guest gate shown to signed-out players.
import { esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { friendRequestPending } from "./clientSocialRuntime.js";
import { surfaceCard, tableReturnBarHTML, socialPlayerRowHTML } from "./clientSharedSurfaceBits.js";

function socialRoomRosterHTML() {
  const activeRoom = state.phase !== "home" && state.players?.length;
  if (!activeRoom) return `<div class="social-context-empty"><span class="t-micro g400">NO ACTIVE ROOM</span><span class="t-body ink-2">Join a table to see the people currently sharing it.</span></div>`;
  const roster = state.players.filter((player) => player.id !== "p1").slice(0, 8);
  return roster.length ? roster.map((player) => socialPlayerRowHTML({ ...player, id: player.serverId || player.id }, player.bot ? "BOT" : "VIEW")).join("") : `<div class="social-context-empty"><span class="t-micro ink-3">ONLY YOU AT THE TABLE</span></div>`;
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

export function socialSnapshotHasRows() {
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

function requestsBodyHTML(social) {
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
