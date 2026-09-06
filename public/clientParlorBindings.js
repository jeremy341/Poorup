/* ============================================================
   PARLOR SURFACE BINDINGS: the click/submit dispatch handlers for
   the rankings, social and player-card surfaces (both the in-game
   modal and the full-page variants) plus the profile player-list.
   Selector order inside each dispatch chain matches the old
   if-chain exactly. emitServer and leaveRoomForHome are injected.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { closeSurface } from "./clientSurfaces.js";
import { openAccountModal } from "./clientAccountIdentity.js";
import {
  announceSocialNotification,
  socialPlayerRowHTML,
  renderSocialSurface,
  openRankingsSurface,
  renderRankingsSurface,
  openPlayerSurface,
  renderPlayerSurface,
} from "./clientSocialSurfaces.js";

let host = { emitServer: noop, leaveRoomForHome: noop };

function noop() {}

function onPlayerListClick(event) {
  const player = event.target.closest("[data-player-id]");
  if (player) openPlayerSurface(player.dataset.playerId);
}

function rankingScopeInGame() {
  return ["setup", "lobby", "playing"].includes(state.phase);
}

function onRankingScope(scope, inGameModal) {
  if (inGameModal) {
    state.leaderboard.scope = scope.dataset.rankingScope;
    renderRankingsSurface("#rankings-card");
    return;
  }
  openRankingsSurface(state.leaderboard.metric, scope.dataset.rankingScope);
}

function onRankingMetric(metric, inGameModal) {
  if (inGameModal) {
    state.leaderboard.metric = metric.dataset.rankingMetric;
    renderRankingsSurface("#rankings-card");
    return;
  }
  openRankingsSurface(metric.dataset.rankingMetric);
}

function closeRankingsFromEvent(event) {
  if (event.currentTarget?.id === "rankings-page-content") leaveRoomForHome();
  else closeSurface("#rankings-modal");
}

function handleRankingClick(event) {
  const inGameModal = event.currentTarget?.id === "rankings-card" && rankingScopeInGame();
  const scope = event.target.closest("[data-ranking-scope]");
  if (scope) { onRankingScope(scope, inGameModal); return; }
  const metric = event.target.closest("[data-ranking-metric]");
  if (metric) { onRankingMetric(metric, inGameModal); return; }
  const player = event.target.closest("[data-ranking-player]");
  if (player) openPlayerSurface(player.dataset.rankingPlayer);
  if (event.target.closest(".rankings-close, #rankings-close")) closeRankingsFromEvent(event);
}

function rankingSearchSurface(event) {
  return event.currentTarget?.id === "rankings-page-content" ? "#rankings-page-content" : "#rankings-card";
}

function handleRankingSubmit(event) {
  if (!event.target.matches("[data-ranking-search-form]")) return;
  event.preventDefault();
  const input = event.target.querySelector("[data-ranking-search-input]");
  state.rankingSearchQuery = String(input?.value || "").trim();
  state.rankingSearchResults = [];
  const surface = rankingSearchSurface(event);
  if (state.rankingSearchQuery.length < 3) {
    renderRankingsSurface(surface);
    return;
  }
  host.emitServer("search-players", { query: state.rankingSearchQuery, exact: true }, (response) => {
    state.rankingSearchResults = response?.players || [];
    renderRankingsSurface(surface);
  });
}

function socialRenderTarget(event) {
  return event.currentTarget?.id === "social-page-content" ? "#social-page-content" : "#social-card";
}

function onSocialTab(event, tab) {
  state.socialTab = tab.dataset.socialTab;
  renderSocialSurface(socialRenderTarget(event));
}

function onSocialAccount() {
  openAccountModal("register");
}

function onSocialPlayer(player) {
  openPlayerSurface(player.dataset.socialPlayer);
}

function onSocialRequest(request) {
  const accept = request.dataset.socialRequest === "accept";
  host.emitServer("respond-friend-request", { friendshipId: request.dataset.friendshipId, accept }, () => {});
}

function onSocialInvite(invite) {
  const accept = invite.dataset.socialInvite === "accept";
  host.emitServer("respond-room-invite", { inviteId: invite.dataset.inviteId, accept }, () => {});
}

function onSocialRead(notification) {
  host.emitServer("mark-notification-read", { notificationId: notification.dataset.notificationRead }, () => {});
}

function onSocialClearRecent(event) {
  host.emitServer("clear-recent-players", {}, (response) => {
    if (response?.success === false) {
      announceSocialNotification({ body: response.error || "Recent players could not be cleared." });
      return;
    }
    state.social.recentPlayers = [];
    renderSocialSurface(socialRenderTarget(event));
  });
}

function onSocialRequestCancel(cancelRequest) {
  host.emitServer("cancel-friend-request", { friendshipId: cancelRequest.dataset.friendshipId }, () => {});
}

function closeSocialFromEvent(event) {
  if (event.currentTarget?.id === "social-page-content") leaveRoomForHome();
  else closeSurface("#social-modal");
}

const SOCIAL_CLICKS = [
  ["[data-social-tab]", (node, event) => onSocialTab(event, node)],
  ["[data-social-action=account]", () => onSocialAccount()],
  ["[data-social-player]", (node) => onSocialPlayer(node)],
  ["[data-social-request]", (node) => onSocialRequest(node)],
  ["[data-social-invite]", (node) => onSocialInvite(node)],
  ["[data-notification-read]", (node) => onSocialRead(node)],
  ["[data-social-clear-recent]", (node, event) => onSocialClearRecent(event)],
  ["[data-social-request-cancel]", (node) => onSocialRequestCancel(node)],
  [".social-close, #social-close", (node, event) => closeSocialFromEvent(event)],
];

function handleSocialClick(event) {
  for (const [selector, handler] of SOCIAL_CLICKS) {
    const node = event.target.closest(selector);
    if (!node) continue;
    handler(node, event);
    return;
  }
}

function socialSearchResultsHTML() {
  if (!state.socialSearchResults.length) return `<p class="t-micro ink-3 social-empty">NO PLAYERS FOUND.</p>`;
  return state.socialSearchResults.map((player) => socialPlayerRowHTML(player, "VIEW")).join("");
}

function onSocialSearchResponse(form, input, response) {
  state.socialSearchResults = response?.players || [];
  const results = form.querySelector("[data-social-search-results]");
  if (results) results.innerHTML = socialSearchResultsHTML();
  if (input) {
    input.value = state.socialSearchQuery;
    input.setAttribute("value", state.socialSearchQuery);
  }
  const surface = form.closest("#social-page-content") ? "#social-page-content" : "#social-card";
  renderSocialSurface(surface);
}

function handleSocialSubmit(event) {
  if (!event.target.matches("[data-social-search-form]")) return;
  event.preventDefault();
  const form = event.target;
  const input = form.querySelector("[data-social-search-input]");
  state.socialSearchQuery = input?.value || "";
  if (input) input.setAttribute("value", state.socialSearchQuery);
  host.emitServer("search-players", { query: input?.value || "" }, (response) => onSocialSearchResponse(form, input, response));
}

function playerModalGuards(event) {
  if (event.target.closest("#player-modal-close")) {
    closeSurface("#player-modal");
    return true;
  }
  if (event.target.closest("#player-modal-back")) {
    state.selectedPlayerView = "profile";
    renderPlayerSurface();
    return true;
  }
  const historyScope = event.target.closest("[data-player-history-scope]");
  if (historyScope) {
    state.selectedPlayerHistoryScope = historyScope.dataset.playerHistoryScope || "all";
    renderPlayerSurface();
    return true;
  }
  return false;
}

function playerActionEnabled(action) {
  if (!action) return false;
  if (action.disabled) return false;
  return Boolean(state.selectedPlayer);
}

function announcePlayerFailure(response, message) {
  if (response?.success === false) announceSocialNotification({ body: response.error || message });
}

function onPlayerFriend(targetId) {
  host.emitServer("send-friend-request", { targetAccountId: targetId }, (response) => announcePlayerFailure(response, "Friend request could not be sent."));
}

function onPlayerInvite(targetId) {
  host.emitServer("send-room-invite", { targetAccountId: targetId }, (response) => announcePlayerFailure(response, "Room invite could not be sent."));
}

function onPlayerHistory(targetId) {
  host.emitServer("get-match-history", { accountId: targetId }, (response) => {
    if (response?.success === false) {
      announceSocialNotification({ body: response.error || "Match history is unavailable." });
      return;
    }
    state.selectedPlayerHistory = response?.history || [];
    state.selectedPlayerView = "history";
    renderPlayerSurface();
  });
}

function onPlayerBlock(targetId) {
  host.emitServer("block-player", { otherAccountId: targetId }, (response) => {
    if (response?.success !== false) closeSurface("#player-modal");
  });
}

function onPlayerReport(targetId) {
  host.emitServer("report-player", { otherAccountId: targetId, reason: "player report from in-room card" }, (response) => {
    if (response?.success !== false) {
      announceSocialNotification({ body: "Report submitted to the parlor moderators." });
      closeSurface("#player-modal");
    }
  });
}

const PLAYER_ACTIONS = {
  friend: onPlayerFriend,
  invite: onPlayerInvite,
  history: onPlayerHistory,
  block: onPlayerBlock,
  report: onPlayerReport,
};

function handlePlayerCardClick(event) {
  if (playerModalGuards(event)) return;
  const action = event.target.closest("[data-player-action]");
  if (!playerActionEnabled(action)) return;
  const handler = PLAYER_ACTIONS[action.dataset.playerAction];
  if (handler) handler(state.selectedPlayer.accountId);
}

function leaveRoomForHome() {
  host.leaveRoomForHome();
}

function closeScrimSocial() {
  closeSurface("#social-modal");
}

function closeScrimRankings() {
  closeSurface("#rankings-modal");
}

function closeScrimPlayer() {
  closeSurface("#player-modal");
}

function bindRankingsListeners() {
  $("#player-list")?.addEventListener("click", onPlayerListClick);
  $("#rankings-card")?.addEventListener("click", handleRankingClick);
  $("#rankings-page-content")?.addEventListener("click", handleRankingClick);
  $("#rankings-card")?.addEventListener("submit", handleRankingSubmit);
  $("#rankings-page-content")?.addEventListener("submit", handleRankingSubmit);
}

function bindSocialListeners() {
  $("#social-card")?.addEventListener("click", handleSocialClick);
  $("#social-page-content")?.addEventListener("click", handleSocialClick);
  $("#social-card")?.addEventListener("submit", handleSocialSubmit);
  $("#social-page-content")?.addEventListener("submit", handleSocialSubmit);
  $("#social-scrim")?.addEventListener("click", closeScrimSocial);
}

function bindPlayerListeners() {
  $("#player-card")?.addEventListener("click", handlePlayerCardClick);
  $("#rankings-scrim")?.addEventListener("click", closeScrimRankings);
  $("#player-scrim")?.addEventListener("click", closeScrimPlayer);
}

export function bindParlorSurfaces(hooks) {
  host = { ...host, ...hooks };
  bindRankingsListeners();
  bindSocialListeners();
  bindPlayerListeners();
}
