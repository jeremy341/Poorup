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
  requestLeaderboardSnapshot,
  requestSeason,
  RANKING_ORDER,
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
    requestLeaderboardSnapshot("#rankings-card");
    return;
  }
  openRankingsSurface(state.leaderboard.metric, scope.dataset.rankingScope);
}

function focusRankingStep(surface, direction) {
  requestAnimationFrame(() => {
    const button = document.querySelector(`${surface} [data-ranking-step="${direction}"]`);
    button?.focus({ preventScroll: true });
  });
}

function onRankingStep(step, inGameModal, surface) {
  const current = Math.max(0, RANKING_ORDER.indexOf(state.leaderboard.metric));
  const next = (current + step + RANKING_ORDER.length) % RANKING_ORDER.length;
  state.leaderboard.metric = RANKING_ORDER[next];
  if (inGameModal) {
    renderRankingsSurface(surface);
    requestLeaderboardSnapshot(surface);
  } else {
    openRankingsSurface(state.leaderboard.metric, state.leaderboard.scope);
  }
  focusRankingStep(surface, String(step > 0 ? 1 : -1));
}

function closeRankingsFromEvent(event) {
  if (event.currentTarget?.id === "rankings-page-content") leaveRoomForHome();
  else closeSurface("#rankings-modal");
}

function handleRankingClick(event) {
  const inGameModal = event.currentTarget?.id === "rankings-card" && rankingScopeInGame();
  const surface = rankingSearchSurface(event);
  const step = event.target.closest("[data-ranking-step]");
  if (step) {
    onRankingStep(Number(step.dataset.rankingStep) || 1, inGameModal, surface);
    return;
  }
  if (event.target.closest("[data-ranking-retry]")) {
    requestLeaderboardSnapshot(surface);
    return;
  }
  const scope = event.target.closest("[data-ranking-scope]");
  if (scope) { onRankingScope(scope, inGameModal); return; }
  const player = event.target.closest("[data-ranking-player]");
  if (player) openPlayerSurface(player.dataset.rankingPlayer);
  const reward = event.target.closest("[data-season-claim]");
  if (reward) {
    host.emitServer("claim-season-reward", { rewardId: reward.dataset.seasonClaim }, (response) => {
      if (response?.success === false) announceSocialNotification({ body: response.error || "Reward could not be claimed." });
      else { state.cosmetics = response.cosmetics || state.cosmetics; announceSocialNotification({ title: "SEASON REWARD", body: response.created === false ? "Reward already claimed." : "Reward claimed and added to your collection." }); }
      requestSeason(rankingSearchSurface(event));
    });
  }
  if (event.target.closest(".rankings-close, #rankings-close")) closeRankingsFromEvent(event);
}

function handleRankingKeydown(event) {
  if (!event.target.closest("[data-ranking-stage]")) return;
  let step = 0;
  if (event.key === "ArrowLeft") step = -1;
  if (event.key === "ArrowRight") step = 1;
  if (event.key === "Home") step = -RANKING_ORDER.length;
  if (event.key === "End") step = RANKING_ORDER.length;
  if (!step) return;
  event.preventDefault();
  const current = Math.max(0, RANKING_ORDER.indexOf(state.leaderboard.metric));
  const next = event.key === "Home" ? 0 : event.key === "End" ? RANKING_ORDER.length - 1 : (current + step + RANKING_ORDER.length) % RANKING_ORDER.length;
  const direction = next > current || event.key === "End" ? 1 : -1;
  const surface = event.currentTarget?.id === "rankings-page-content" ? "#rankings-page-content" : "#rankings-card";
  const inGameModal = event.currentTarget?.id === "rankings-card" && rankingScopeInGame();
  state.leaderboard.metric = RANKING_ORDER[next];
  if (inGameModal) {
    renderRankingsSurface(surface);
    requestLeaderboardSnapshot(surface);
  } else {
    openRankingsSurface(state.leaderboard.metric, state.leaderboard.scope);
  }
  focusRankingStep(surface, String(direction));
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

function onSocialAccount(event) {
  openAccountModal("register", event?.target?.closest("[data-social-action=account]") || event?.currentTarget);
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
  ["[data-social-action=account]", (node, event) => onSocialAccount(event || node)],
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
  const accepted = state.selectedPlayerRelationship === "accepted"
    || (state.selectedPlayerRelationship === "none" && (state.social.friends || []).some((friend) => friend.id === targetId));
  const eventName = accepted ? "remove-friend" : "send-friend-request";
  const payload = accepted ? { otherAccountId: targetId } : { targetAccountId: targetId };
  host.emitServer(eventName, payload, (response) => {
    if (response?.success === false) {
      announcePlayerFailure(response, accepted ? "Friend could not be removed." : "Friend request could not be sent.");
      return;
    }
    state.selectedPlayerRelationship = accepted ? "none" : "requested";
    if (accepted) state.social.friends = (state.social.friends || []).filter((friend) => friend.id !== targetId);
    renderPlayerSurface();
  });
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
  $("#rankings-card")?.addEventListener("keydown", handleRankingKeydown);
  $("#rankings-page-content")?.addEventListener("keydown", handleRankingKeydown);
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
