// SOCIAL SURFACES: friends/rankings/player/rules pages and the
// parlor toast announcer. Server fetches and view switching are
// injected by the entry module; everything else is local DOM.
//
// Compatibility barrel: the public API is re-exported from focused modules so
// importers keep their existing names and no module imports back into here.
export {
  SOCIAL_REQUEST_TIMEOUT_MS, configureSocialSurfaces,
  beginFriendRequestAction, finishFriendRequestAction,
} from "./clientSocialRuntime.js";
export { announceSocialNotification, parlorNotice } from "./clientSocialToast.js";
export {
  openSocialSurface, openInGameSocialSurface, openRankingsSurface,
  openRulesSurface, openPlayerSurface,
} from "./clientSocialControllers.js";
export { requestSocialData, requestLeaderboardSnapshot } from "./clientSocialData.js";
export { socialGuestGateHTML, renderSocialSurface } from "./clientSocialView.js";
export {
  RANKING_LABELS, RANKING_ORDER, RANKING_PAGE_SIZE, rankingsPageSlice,
} from "./clientRankingModel.js";
export { rankingMetricNavigationHTML, renderRankingsSurface } from "./clientRankingsView.js";
export { renderRulesSurface } from "./clientRulesView.js";
export { playerHistoryHTML, renderPlayerSurface } from "./clientPlayerView.js";
