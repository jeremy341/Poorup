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
import { createVoteKickUi } from "./clientVoteKickUi.js";
import {
  announceSocialNotification,
  renderSocialSurface,
  openRankingsSurface,
  renderRankingsSurface,
  openPlayerSurface,
  renderPlayerSurface,
  requestLeaderboardSnapshot,
  requestSeason,
  requestSocialData,
  RANKING_ORDER,
} from "./clientSocialSurfaces.js";

let host = { emitServer: noop, leaveRoomForHome: noop };
let roomVoteKickUi = null;
const SOCIAL_ACTION_TIMEOUT_MS = 8000;
let rankingSearchRequestId = 0;
let rankingSearchTimer = null;
let socialSearchRequestId = 0;
let socialSearchTimer = null;

function noop() {}

function beginPendingAction(button) {
  if (!button || button.disabled || button.dataset.pending === "true") return false;
  const label = button.querySelector(".cta-text, .t-label");
  button.dataset.pending = "true";
  if (label) button.dataset.pendingLabel = label.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (label) label.textContent = "PROCESSING…";
  button._pendingTimer = setTimeout(() => {
    if (button.dataset.pending !== "true") return;
    finishPendingAction(button);
    announceSocialNotification({ body: "That social action timed out. Try again." });
  }, SOCIAL_ACTION_TIMEOUT_MS);
  return true;
}

function finishPendingAction(button, labelText = "") {
  if (!button) return;
  clearTimeout(button._pendingTimer);
  button._pendingTimer = null;
  const label = button.querySelector(".cta-text, .t-label");
  const original = button.dataset.pendingLabel;
  delete button.dataset.pending;
  delete button.dataset.pendingLabel;
  button.removeAttribute("aria-busy");
  if (label) label.textContent = labelText || original || label.textContent;
  button.disabled = false;
}

function pendingActionError(button, response, fallback) {
  finishPendingAction(button);
  announceSocialNotification({ body: response?.error || fallback });
}

function surfaceForNode(node, fallback = "#social-card") {
  return node?.closest?.("#social-page-content") ? "#social-page-content" : fallback;
}

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
  if (event.target.closest("[data-season-retry]")) {
    requestSeason(surface);
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
  rankingSearchRequestId += 1;
  const requestId = rankingSearchRequestId;
  state.rankingSearchLoading = false;
  state.rankingSearchError = "";
  clearTimeout(rankingSearchTimer);
  if (state.rankingSearchQuery.length < 3) {
    renderRankingsSurface(surface);
    return;
  }
  state.rankingSearchLoading = true;
  renderRankingsSurface(surface);
  rankingSearchTimer = setTimeout(() => onRankingSearchResponse(surface, requestId, { success: false, error: "Player search timed out. Try again." }), SOCIAL_ACTION_TIMEOUT_MS);
  host.emitServer("search-players", { query: state.rankingSearchQuery, exact: true }, (response) => onRankingSearchResponse(surface, requestId, response));
}

function onRankingSearchResponse(surface, requestId, response) {
  if (requestId !== rankingSearchRequestId) return;
  clearTimeout(rankingSearchTimer);
  rankingSearchTimer = null;
  state.rankingSearchLoading = false;
  state.rankingSearchError = response?.success === false ? response.error || "Player search is unavailable." : "";
  state.rankingSearchResults = response?.players || [];
  renderRankingsSurface(surface);
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
  if (!beginPendingAction(request)) return;
  const accept = request.dataset.socialRequest === "accept";
  const surface = surfaceForNode(request);
  host.emitServer("respond-friend-request", { friendshipId: request.dataset.friendshipId, accept }, (response) => {
    if (response?.success === false) {
      pendingActionError(request, response, "Friend request could not be updated.");
      return;
    }
    finishPendingAction(request);
    announceSocialNotification({ title: "FRIEND REQUEST", body: accept ? "Friend request accepted." : "Friend request declined." });
    requestSocialData(surface);
  });
}

function onSocialInvite(invite) {
  if (!beginPendingAction(invite)) return;
  const accept = invite.dataset.socialInvite === "accept";
  const surface = surfaceForNode(invite);
  host.emitServer("respond-room-invite", { inviteId: invite.dataset.inviteId, accept }, (response) => {
    if (response?.success === false) {
      pendingActionError(invite, response, "Room invite could not be updated.");
      return;
    }
    finishPendingAction(invite);
    announceSocialNotification({ title: "ROOM INVITE", body: accept ? "Invite accepted." : "Invite declined." });
    requestSocialData(surface);
  });
}

function onSocialRead(notification) {
  if (!beginPendingAction(notification)) return;
  const surface = surfaceForNode(notification);
  host.emitServer("mark-notification-read", { notificationId: notification.dataset.notificationRead }, (response) => {
    if (response?.success === false) {
      pendingActionError(notification, response, "Notification could not be marked read.");
      return;
    }
    finishPendingAction(notification);
    requestSocialData(surface);
  });
}

function onSocialClearRecent(event) {
  const button = event.target.closest("[data-social-clear-recent]");
  if (!beginPendingAction(button)) return;
  const surface = socialRenderTarget(event);
  host.emitServer("clear-recent-players", {}, (response) => {
    if (response?.success === false) {
      pendingActionError(button, response, "Recent players could not be cleared.");
      return;
    }
    finishPendingAction(button);
    announceSocialNotification({ title: "RECENT PLAYERS", body: "Recent player history cleared." });
    requestSocialData(surface);
  });
}

function onSocialRequestCancel(cancelRequest) {
  if (!beginPendingAction(cancelRequest)) return;
  const surface = surfaceForNode(cancelRequest);
  host.emitServer("cancel-friend-request", { friendshipId: cancelRequest.dataset.friendshipId }, (response) => {
    if (response?.success === false) {
      pendingActionError(cancelRequest, response, "Friend request could not be canceled.");
      return;
    }
    finishPendingAction(cancelRequest);
    announceSocialNotification({ title: "FRIEND REQUEST", body: "Friend request canceled." });
    requestSocialData(surface);
  });
}

function closeSocialFromEvent(event) {
  if (event.currentTarget?.id === "social-page-content") leaveRoomForHome();
  else closeSurface("#social-modal");
}

const SOCIAL_CLICKS = [
  ["[data-social-tab]", (node, event) => onSocialTab(event, node)],
  ["[data-social-action=account]", (node, event) => onSocialAccount(event || node)],
  ["[data-social-retry]", (node, event) => requestSocialData(socialRenderTarget(event))],
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

function onSocialSearchResponse(surface, requestId, response) {
  if (requestId !== socialSearchRequestId) return;
  clearTimeout(socialSearchTimer);
  socialSearchTimer = null;
  state.socialSearchLoading = false;
  state.socialSearchError = response?.success === false ? response.error || "Player search is unavailable." : "";
  state.socialSearchResults = response?.players || [];
  renderSocialSurface(surface);
}

function handleSocialSubmit(event) {
  if (!event.target.matches("[data-social-search-form]")) return;
  event.preventDefault();
  const form = event.target;
  const input = form.querySelector("[data-social-search-input]");
  state.socialSearchQuery = input?.value || "";
  if (input) input.setAttribute("value", state.socialSearchQuery);
  const surface = socialRenderTarget(event);
  socialSearchRequestId += 1;
  const requestId = socialSearchRequestId;
  clearTimeout(socialSearchTimer);
  state.socialSearchResults = [];
  state.socialSearchError = "";
  if (state.socialSearchQuery.trim().length < 3) {
    state.socialSearchLoading = false;
    renderSocialSurface(surface);
    return;
  }
  state.socialSearchLoading = true;
  renderSocialSurface(surface);
  socialSearchTimer = setTimeout(() => onSocialSearchResponse(surface, requestId, { success: false, error: "Player search timed out. Try again." }), SOCIAL_ACTION_TIMEOUT_MS);
  host.emitServer("search-players", { query: input?.value || "" }, (response) => onSocialSearchResponse(surface, requestId, response));
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

function onPlayerFriend(targetId, trigger) {
  const accepted = state.selectedPlayerRelationship === "accepted"
    || (state.selectedPlayerRelationship === "none" && (state.social.friends || []).some((friend) => friend.id === targetId));
  const eventName = accepted ? "remove-friend" : "send-friend-request";
  const payload = accepted ? { otherAccountId: targetId } : { targetAccountId: targetId };
  host.emitServer(eventName, payload, (response) => {
    if (response?.success === false) {
      pendingActionError(trigger, response, accepted ? "Friend could not be removed." : "Friend request could not be sent.");
      return;
    }
    finishPendingAction(trigger);
    state.selectedPlayerRelationship = accepted ? "none" : "requested";
    if (accepted) state.social.friends = (state.social.friends || []).filter((friend) => friend.id !== targetId);
    announceSocialNotification({ title: accepted ? "FRIEND REMOVED" : "FRIEND REQUEST", body: accepted ? "Friend removed." : "Friend request sent." });
    renderPlayerSurface();
  });
}

function onPlayerInvite(targetId, trigger) {
  host.emitServer("send-room-invite", { targetAccountId: targetId }, (response) => {
    if (response?.success === false) {
      pendingActionError(trigger, response, "Room invite could not be sent.");
      return;
    }
    finishPendingAction(trigger, "INVITE SENT");
    announceSocialNotification({ title: "ROOM INVITE", body: "Invite sent to the player." });
  });
}

function onPlayerHistory(targetId, trigger) {
  host.emitServer("get-match-history", { accountId: targetId }, (response) => {
    if (response?.success === false) {
      pendingActionError(trigger, response, "Match history is unavailable.");
      return;
    }
    finishPendingAction(trigger);
    state.selectedPlayerHistory = response?.history || [];
    state.selectedPlayerView = "history";
    renderPlayerSurface();
  });
}

function onPlayerBlock(targetId, trigger) {
  host.emitServer("block-player", { otherAccountId: targetId }, (response) => {
    if (response?.success === false) {
      pendingActionError(trigger, response, "Player could not be blocked.");
      return;
    }
    finishPendingAction(trigger);
    announceSocialNotification({ title: "PLAYER BLOCKED", body: "This player is hidden from your social surfaces." });
    closeSurface("#player-modal");
  });
}

function onPlayerReport(targetId, trigger) {
  host.emitServer("report-player", { otherAccountId: targetId, reason: "player report from in-room card" }, (response) => {
    if (response?.success === false) {
      pendingActionError(trigger, response, "Report could not be submitted.");
      return;
    }
    finishPendingAction(trigger);
    announceSocialNotification({ title: "PLAYER REPORT", body: "Report submitted to the parlor moderators." });
    closeSurface("#player-modal");
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
  if (action.dataset.playerAction === "vote-kick") {
    const targetId = state.selectedPlayer?.serverId || state.selectedPlayer?.roomPlayerId || state.selectedPlayer?.id;
    if (targetId && roomVoteKickUi) roomVoteKickUi.requestStart(targetId, state.players);
    return;
  }
  if (handler && beginPendingAction(action)) handler(state.selectedPlayer.accountId, action);
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
  roomVoteKickUi?.destroy();
  roomVoteKickUi = createVoteKickUi({ container: $("#room-votekick-host"), emit: host.emitServer });
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

export function syncRoomVoteKickUi(vote, players, serverTime) {
  roomVoteKickUi?.update(vote, players, serverTime);
}
