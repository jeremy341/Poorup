// SOCIAL OPENERS: the view-switching entry points that render a surface, focus
// it and kick off its server fetch, for both full pages and in-game modals.
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { openSurface } from "./clientSurfaces.js";
import { socialHost } from "./clientSocialRuntime.js";
import { focusSocialPage, focusRankingsPage } from "./clientSharedSurfaceBits.js";
import { renderSocialSurface } from "./clientSocialView.js";
import { renderRankingsSurface } from "./clientRankingsView.js";
import { normalizeRankingMetric, normalizeRankingScope } from "./clientRankingModel.js";
import { renderRulesSurface, rulesSectionById } from "./clientRulesView.js";
import { renderPlayerSurface, publicPlayerAck } from "./clientPlayerView.js";
import { socialFetchAndRender, requestLeaderboardSnapshot } from "./clientSocialData.js";

export function openSocialSurface(tab = "friends") {
  state.socialTab = ["friends", "requests", "invites", "recent", "notifications"].includes(tab) ? tab : "friends";
  socialHost().showView("social");
  renderSocialSurface("#social-page-content");
  focusSocialPage();
  socialFetchAndRender("#social-page-content");
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

export function openRankingsSurface(metric = "wins", scope = state.leaderboard.scope || "all") {
  state.leaderboard.metric = normalizeRankingMetric(metric);
  state.leaderboard.scope = normalizeRankingScope(scope);
  state.leaderboard.page = 0;
  socialHost().showView("rankings");
  renderRankingsSurface("#rankings-page-content");
  focusRankingsPage();
  requestLeaderboardSnapshot("#rankings-page-content");
}

export function openRulesSurface(section = "start-here") {
  state.rulesSection = rulesSectionById(section).id;
  socialHost().showView("rules");
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
    socialHost().emitServer("get-public-player-card", { roomPlayerId: state.selectedPlayer.roomPlayerId }, publicPlayerAck);
  } else if (state.selectedPlayer.accountId) {
    socialHost().emitServer("get-public-player-card", { accountId: state.selectedPlayer.accountId }, publicPlayerAck);
  }
}
