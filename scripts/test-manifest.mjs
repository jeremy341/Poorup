export const TEST_GROUPS = Object.freeze({
  core: [
    'server/rulesetRegistry.test.js', 'server/boardRegistry.test.js', 'server/seasonModule.test.js',
    'server/cosmeticCatalog.test.js', 'server/telemetryModule.test.js', 'server/marketExpansion.test.js',
    'server/backupStore.test.js', 'server/httpRateLimiter.test.js', 'server/persistenceMode.test.js',
    'server/authoritativeStore.test.js', 'server/pubsubAdapter.test.js', 'server/balanceMetrics.test.js',
    'server/gameLogic.test.js', 'server/applyCard.test.js', 'server/rent.test.js', 'server/persistence.test.js',
    'server/leaderboard.test.js', 'server/game-results.test.js', 'server/property-actions.test.js',
    'server/contracts-market.test.js', 'server/sponsorship.test.js', 'server/double-go.test.js',
    'server/botLogic.test.js', 'server/botTradeValuation.test.js', 'server/botMarketForecast.test.js', 'server/botAdvisor.test.js',
    'server/aiProviderConfig.test.js', 'server/aiProviderRoutes.test.js', 'server/bot-brain.test.js',
    'server/botStrategicContext.test.js', 'server/botFuturePlanner.test.js', 'server/botDevelopmentForecast.test.js',
    'server/botTableBrain.test.js', 'server/botTableMind.test.js', 'server/bot-simulation.test.js',
    'server/global-events.test.js', 'server/trades.test.js', 'server/casino-bankruptcy.test.js',
    'server/roomSetup.test.js', 'server/serverStorePaths.test.js', 'server/release-hardening.test.js',
    'server/rooms.test.js', 'server/server.test.js', 'server/audit-trade-auction.test.js',
    'server/audit-property-loan.test.js', 'server/audit-cards-match.test.js', 'server/audit-rooms-settle.test.js',
    'server/audit-game-contracts.test.js', 'server/reconnect.test.js', 'server/social-achievement.test.js',
    'server/hybrid-contract-achievements.test.js', 'server/match-history-schema.test.js',
    'server/matchHistoryAdapter.test.js', 'server/serverSocketAccount.test.js', 'server/serverSocketGame.test.js',
    'server/serverSocketSocial.test.js', 'server/accountStore-rollback.test.js', 'server/accountStore-rights.test.js',
    'server/accountLifecycleStores.test.js', 'server/sessionStore.test.js', 'server/accountExport.test.js',
    'server/mailAdapter.test.js', 'server/accountRecovery.test.js', 'server/accountDeletion.test.js',
    'server/retentionJob.test.js', 'server/room-host-lifecycle.test.js', 'server/maintenanceState.test.js',
    'server/drainController.test.js', 'server/maintenance-wire.test.js', 'server/metricsRegistry.test.js',
    'server/analyticsPrivacy.test.js', 'server/analyticsProjection.test.js', 'server/analyticsRollupStore.test.js',
    'server/analyticsApi.test.js', 'server/analytics-route-security.test.js', 'server/analyticsRuntime.test.js',
    'server/metadata.test.js', 'server/release-wiring.test.js', 'server/docsFeatureStatus.test.js',
    'server/docs-parity.test.js', 'public/clientUxContracts.test.js', 'public/clientTheme.test.js',
    'public/clientMusicPlayer.test.js', 'public/clientAdminAiProvider.test.js', 'public/themeAssetAudit.test.js',
    'public/clientTransactionUi.test.js', 'public/clientResponsiveA11y.test.js', 'public/clientQuickTable.test.js',
    'public/clientMaintenance.test.js', 'public/clientDocumentMeta.test.js', 'public/clientGameSave.test.js',
    'public/clientInteractionRegression.test.js', 'public/clientCrossTabSignout.test.js', 'public/clientStateSync.test.js',
    'public/clientBoardMotion.test.js', 'public/clientSurfaceFocus.test.js', 'public/clientAnalyticsMarkup.test.js',
    'public/clientAnalytics.test.js', 'public/clientAnalyticsPage.test.js', 'public/clientAnalyticsCharts.test.js',
    'public/clientMusicBoxReference.test.js', 'public/clientAccountRights.test.js',
    'server/bot-policy-tournament.test.js', 'server/socketHandlerSupport.test.js',
    'server/botCandidateCoverage.test.js', 'server/botTiming.test.js', 'server/socketRuntime.test.js',
    'public/clientAudioControls.test.js', 'public/clientInGameUxRegression.test.js',
    'public/clientTradeOfferDismissal.test.js', 'public/clientDiceRollEffect.test.js',
  ],
  audit: [
    'server/market-settlement-audit.test.js', 'server/lifecycle-audit.test.js', 'server/card-deck-audit.test.js',
    'server/rooms-directory-audit.test.js', 'server/account-session-audit.test.js', 'server/season-reward-audit.test.js',
    'server/season-metrics-audit.test.js', 'server/summary-privacy-audit.test.js', 'public/clientCasinoReel.test.js',
    'server/session-room-regressions.test.js', 'server/game-invariant-regressions.test.js',
    'server/backup-restore-integrity.test.js', 'server/socket-admission.test.js', 'server/runtime-safety.test.js',
    'server/analyticsRuntime.test.js', 'server/capacity-followup.test.js', 'server/server-followups.test.js',
    'server/backend-fix-regressions.test.js', 'public/audioIconAudit.test.js',
    'server/backend-fix-regressions-b.test.js', 'server/backend-fix-regressions-c.test.js',
    'server/backend-fix-regressions-d.test.js',
    'server/backend-bot-fixes.test.js', 'server/backend-bot-context-fixes.test.js',
    'server/regression-b11-b14.test.js', 'server/regression-b12-b13.test.js',
    'server/regression-b18.test.js', 'server/regression-b27-b29.test.js',
    'server/regression-b33-b34.test.js', 'server/regression-b35-b36.test.js',
  ],
  timers: ['server/player-lifecycle-timers.test.js'],
  account: [
    'server/accountStore-rights.test.js', 'server/accountLifecycleStores.test.js', 'server/accountRightsSocket.test.js',
    'server/sessionStore.test.js', 'server/accountExport.test.js', 'server/mailAdapter.test.js',
    'server/accountRecovery.test.js', 'server/accountRecoveryPersistence.test.js', 'server/accountDeletion.test.js',
    'server/retentionJob.test.js', 'server/backupAccountPurge.test.js', 'public/clientAccountRights.test.js',
    'public/clientAccountSessionStorage.test.js',
  ],
  inactivity: [
    'server/playerPresence.test.js', 'server/roomVoteKick.test.js', 'server/roomPresenceRuntime.test.js',
    'server/roomVoteKickRuntime.test.js', 'server/roomSettings.test.js', 'server/lobbyBotRoster.test.js',
    'server/collateralBasket.test.js', 'server/equityPurchase.test.js', 'server/equityTransfer.test.js',
    'server/player-lifecycle-timers.test.js', 'public/clientPlayerPresence.test.js', 'public/clientInactivityUi.test.js',
    'public/clientVoteKickUi.test.js', 'public/clientSponsorshipUi.test.js', 'public/clientTradeUi.test.js',
    'public/clientStateSync.test.js', 'public/turn-timer-removal.test.js', 'scripts/purge-all-account-data.test.mjs',
  ],
  surfaces: [
    'server/chat-activity-routing.test.js', 'server/contractCancelOffTurn.test.js',
    'server/marketQuoteHistory.test.js', 'server/marketViewerProjection.test.js', 'public/clientChatActivity.test.js',
    'public/clientChatScroll.test.js', 'public/clientActionErrorNotice.test.js', 'public/clientBankLoanUi.test.js',
    'public/clientMarketUi.test.js', 'public/clientSocialSurfaces.test.js', 'public/clientProfileSurfaces.test.js',
    'public/clientGlobalEventRender.test.js',
  ],
});

export function testSuites(group = 'full') {
  if (group === 'full') return [...new Set(Object.values(TEST_GROUPS).flat())];
  if (!Object.hasOwn(TEST_GROUPS, group)) throw new Error(`Unknown test group: ${group}`);
  return [...TEST_GROUPS[group]];
}

function isPositiveShardCount(shardCount) {
  if (!Number.isInteger(shardCount)) return false;
  if (shardCount < 1) return false;
  return true;
}

function isValidShardIndex(shardIndex, shardCount) {
  if (!Number.isInteger(shardIndex)) return false;
  if (shardIndex < 1) return false;
  if (shardIndex > shardCount) return false;
  return true;
}

import { balanceShards } from './shard-balance.mjs';

export function shardedTestSuites(suites, shardIndex, shardCount) {
  if (!isPositiveShardCount(shardCount)) throw new Error('Shard count must be a positive integer.');
  if (!isValidShardIndex(shardIndex, shardCount)) throw new Error(`Shard index must be between 1 and ${shardCount}.`);
  return suites.filter((_suite, index) => index % shardCount === shardIndex - 1);
}

// Time-balanced sharding when a duration baseline is available, with the
// count-balanced round-robin split as the deterministic fallback.
export function timeShardedTestSuites(suites, shardIndex, shardCount, timings = null) {
  if (!isPositiveShardCount(shardCount)) throw new Error('Shard count must be a positive integer.');
  if (!isValidShardIndex(shardIndex, shardCount)) throw new Error(`Shard index must be between 1 and ${shardCount}.`);
  if (timings) return balanceShards(suites, timings, shardCount)[shardIndex - 1];
  return shardedTestSuites(suites, shardIndex, shardCount);
}
