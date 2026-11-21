// SOCIAL DATA: server fetch/ack round-trips for social snapshots and the
// verified leaderboard, sharing the runtime request ids, timers and host hooks.
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import {
  SOCIAL_REQUEST_TIMEOUT_MS, socialHost, socialAuthToken, socialAuthCurrent,
  getSocialRequestId, setSocialRequestId, getSocialRequestTimer, setSocialRequestTimer,
  getLeaderboardRequestTimer, setLeaderboardRequestTimer,
} from "./clientSocialRuntime.js";
import { focusSocialPage, focusRankingsPage } from "./clientSharedSurfaceBits.js";
import { socialSnapshotHasRows, renderSocialSurface } from "./clientSocialView.js";
import { renderRankingsSurface } from "./clientRankingsView.js";
import { applyLeaderboardSnapshot, leaderboardCurrentRows } from "./clientRankingModel.js";

function socialDataAck(response, target, requestId, session, preserveFocus) {
  if (requestId !== getSocialRequestId() || !socialAuthCurrent(session)) return;
  clearTimeout(getSocialRequestTimer());
  setSocialRequestTimer(null);
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
  const requestId = getSocialRequestId() + 1;
  setSocialRequestId(requestId);
  state.socialRequestId = requestId;
  const session = socialAuthToken();
  state.socialLoading = true;
  state.socialError = "";
  state.socialStale = socialSnapshotHasRows();
  clearTimeout(getSocialRequestTimer());
  renderSocialSurface(target);
  setSocialRequestTimer(setTimeout(() => socialDataAck({ success: false, error: "Social sync timed out. Try again." }, target, requestId, session, preserveFocus), SOCIAL_REQUEST_TIMEOUT_MS));
  socialHost().emitServer("get-social-data", {}, (response) => socialDataAck(response, target, requestId, session, preserveFocus));
}

export function socialFetchAndRender(target) {
  requestSocialData(target);
}

function leaderboardSnapshotAck(snapshot, target, requestId) {
  if (requestId !== state.leaderboard.requestId) return;
  clearTimeout(getLeaderboardRequestTimer());
  setLeaderboardRequestTimer(null);
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
  clearTimeout(getLeaderboardRequestTimer());
  renderRankingsSurface(target);
  setLeaderboardRequestTimer(setTimeout(() => leaderboardSnapshotAck({ success: false, error: "Rankings sync timed out. Try again." }, target, requestId), SOCIAL_REQUEST_TIMEOUT_MS));
  socialHost().emitServer("get-leaderboard-snapshot", { scope: state.leaderboard.scope, metric: state.leaderboard.metric }, (snapshot) => leaderboardSnapshotAck(snapshot, target, requestId));
}
