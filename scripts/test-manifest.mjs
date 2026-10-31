export const TEST_GROUPS = Object.freeze({
  core: [
    'server/patrol-authority.test.js', 'public/clientNightShift.test.js', 'public/clientPatrolProvenance.test.js', 'server/recap-fields.test.js',
    'server/items.test.js', 'server/items-lifecycle.test.js',
    'server/itemRewardsSettings.test.js', 'server/itemSocket.test.js',
    'server/rulesProfiles.test.js', 'server/botFinanceProfiles.test.js',
    'server/rent-share-rules.test.js', 'server/collateral-credit.test.js',
    'server/secured-exit-retry.test.js',
    'server/rulesetRegistry.test.js', 'server/boardRegistry.test.js', 'server/retiredAccountStore.test.js',
    'server/turnAuctionRules.test.js', 'server/gamePresentation.test.js', 'public/clientPresentation.test.js', 'server/telemetryModule.test.js', 'server/marketExpansion.test.js',
    'server/backupStore.test.js', 'server/backup-wire.test.js', 'server/storage-permissions.test.js', 'server/httpRateLimiter.test.js', 'server/httpErrors.test.js', 'server/requestId.test.js', 'server/persistenceMode.test.js',
    'server/authoritativeStore.test.js', 'server/pubsubAdapter.test.js', 'server/balanceMetrics.test.js',
    'server/gameLogic.test.js', 'server/applyCard.test.js', 'server/rent.test.js', 'server/metro-rent-tiers.test.js', 'server/margin-carry-rule.test.js', 'server/round-limit.test.js', 'server/persistence.test.js',
    'server/leaderboard.test.js', 'server/game-results.test.js', 'server/property-actions.test.js', 'server/hotel-sale-supply.test.js', 'server/bot-trade-counter.test.js', 'server/trade-expiry.test.js', 'server/airport-flights.test.js', 'server/bank-account.test.js', 'server/bank-tier-perks.test.js', 'server/about-page.test.js', 'server/staticAssets.test.js',
    'server/contracts-market.test.js', 'server/market-order-guards.test.js', 'server/sponsorship.test.js', 'server/double-go.test.js',
    'server/turn-doubles-carry.test.js', 'server/turn-off-roll-settle.test.js', 'server/auction-departing-starter.test.js',
    'server/exit-settlement.test.js',
    'server/botLogic.test.js', 'server/botTradeValuation.test.js', 'server/botMarketForecast.test.js', 'server/bot-counter-cash.test.js', 'server/bot-rent-forecast-board-scan.test.js', 'server/botAdvisor.test.js',
    'server/aiProviderConfig.test.js', 'server/aiProviderRoutes.test.js', 'server/bot-brain.test.js',
    'server/botStrategicContext.test.js', 'server/botFuturePlanner.test.js', 'server/botDevelopmentForecast.test.js',
    'server/botTableBrain.test.js', 'server/botTableMind.test.js', 'server/bot-simulation.test.js',
    'server/global-events.test.js', 'server/lucky-table.test.js', 'server/trades.test.js', 'server/casino-bankruptcy.test.js',
    'server/roomSetup.test.js', 'server/nicknamePolicy.test.js', 'server/serverStorePaths.test.js', 'server/release-hardening.test.js', 'scripts/restore-backup.test.mjs',
    'scripts/loadEnvFile.test.mjs', 'scripts/ops-wiring.test.mjs',
    'server/rooms.test.js', 'server/server.test.js', 'server/rooms-seat-reclaim.test.js', 'server/serverSocketRoomLifecycle.test.js', 'server/trade-and-auction-guards.test.js',
    'server/property-mortgage-and-loans.test.js', 'server/card-rent-and-resolve.test.js', 'server/room-settlement.test.js',
    'server/game-contract-debt.test.js', 'server/reconnect.test.js', 'server/social-achievement.test.js',
    'server/hybrid-contract-achievements.test.js', 'server/match-history-schema.test.js', 'server/net-worth-timeline.test.js', 'server/bot-contract-policy.test.js', 'server/reconnect-turn-wait.test.js', 'server/bot-engine-contracts.test.js', 'server/bot-economics.test.js', 'server/bot-trade-rework.test.js', 'server/bot-market-accounting.test.js', 
    'server/matchHistoryAdapter.test.js', 'server/match-store-trace-cap.test.js', 'server/serverSocketAccount.test.js', 'server/serverSocketGame.test.js',
    'server/serverSocketSocial.test.js', 'server/accountStore-rollback.test.js', 'server/accountStore-rights.test.js',
    'server/accountLifecycleStores.test.js', 'server/sessionStore.test.js', 'server/accountExport.test.js',
    'server/mailAdapter.test.js', 'server/accountRecovery.test.js', 'server/accountDeletion.test.js',
    'server/account-auth-abuse.test.js', 'server/account-erasure-completeness.test.js', 'server/accountStore-load-quarantine.test.js', 'server/retentionJob.test.js', 'server/room-host-lifecycle.test.js', 'server/host-election-repair.test.js', 'server/seat-identity.test.js', 'server/seat-identity-wire.test.js', 'server/maintenanceState.test.js', 'server/maintenance-lockout.test.js', 'server/maintenanceAccess.test.js',
    'server/drainController.test.js', 'server/maintenance-wire.test.js', 'server/maintenance-persistence.test.js', 'server/metricsRegistry.test.js',
    'server/analyticsPrivacy.test.js', 'server/analyticsProjection.test.js', 'server/analyticsRollupStore.test.js',
    'server/analyticsApi.test.js', 'server/adminAuditLog.test.js', 'server/adminOpsReports.test.js', 'server/adminOpsRoutes.test.js', 'server/analytics-route-security.test.js', 'server/analyticsRuntime.test.js',
    'server/metadata.test.js', 'server/release-wiring.test.js', 'server/docsFeatureStatus.test.js',
    'server/docs-parity.test.js', 'public/clientUxContracts.test.js', 'public/clientTheme.test.js',
    'public/clientMusicPlayer.test.js', 'public/clientAdminAiProvider.test.js', 'public/themeAssets.test.js',
    'public/clientTransactionUi.test.js', 'public/clientResponsiveA11y.test.js', 'public/clientQuickTable.test.js',
    'public/clientMaintenance.test.js', 'public/clientMaintenanceOperator.test.js', 'public/clientMaintenanceDisclosure.test.js', 'server/errorPage.test.js', 'public/clientDocumentMeta.test.js', 'public/clientDomWrites.test.js', 'public/clientGameSave.test.js', 'public/clientGameResults.test.js', 'public/clientCloseButton.test.js',
    'public/clientInteractionRegression.test.js', 'public/clientCrossTabSignout.test.js', 'public/clientStateSync.test.js',
    'public/clientBoardMotion.test.js', 'public/clientSurfaceFocus.test.js', 'public/clientAnalyticsMarkup.test.js',
    'public/clientAnalytics.test.js', 'public/clientAnalyticsPage.test.js', 'public/clientAnalyticsCharts.test.js', 'public/clientChartMath.test.js', 'public/clientChartRender.test.js', 'public/clientChartMount.test.js', 'public/clientAdminOps.test.js', 'public/clientAdminConsole.test.js',
    'public/clientMusicBoxReference.test.js', 'public/clientAccountRights.test.js',
    'server/bot-policy-tournament.test.js', 'server/bot-tournament-harness.test.js', 'server/bot-advisor-ai-layer.test.js', 'server/bot-difficulty-order.test.js', 'server/socketHandlerSupport.test.js',
    'server/botCandidateCoverage.test.js', 'server/botTiming.test.js', 'server/socketRuntime.test.js',
    'server/bot-runtime.test.js',
    'server/auctionBotConcurrency.test.js', 'server/auction-bid-escrow.test.js', 'server/auction-watchdog.test.js',
    'public/clientAudioControls.test.js', 'public/clientInGameUxRegression.test.js', 'public/clientInputEscaping.test.js',
    'public/clientTradeOfferDismissal.test.js', 'public/clientDiceRollEffect.test.js', 'public/clientKeyboardFocus.test.js',
    'qa/visual-capture/fixtures.test.mjs', 'qa/visual-capture/gallery.test.mjs',
    'qa/visual-capture/runner.test.mjs', 'qa/visual-capture/viewports.test.mjs',
    'public/clientThemeContrast.test.js', 'public/clientVisualContracts.test.js',
    // Backend regression suites (house resale, collect-from-each debt, achievement privacy,
    // recovery throttle, audit corruption, store quarantine, empty median, active provider edits).
    'server/house-resale.test.js', 'server/collect-from-each-debt.test.js', 'server/achievement-privacy-paths.test.js',
    'server/accountRecovery-throttle.test.js', 'server/adminAuditCorruption.test.js', 'server/storeQuarantinePersistence.test.js',
    'server/balanceMedianEmpty.test.js', 'server/aiProviderActiveEdit.test.js',
  ],
  audit: [
    'server/market-settlement.test.js', 'server/room-lifecycle.test.js', 'server/card-deck.test.js',
    'server/room-directory.test.js', 'server/account-sessions.test.js',
    'server/summary-privacy.test.js', 'public/clientCasinoReel.test.js',
    'server/session-room-regressions.test.js', 'server/game-invariant-regressions.test.js',
    'server/backup-restore-integrity.test.js', 'server/socket-admission.test.js', 'server/runtime-safety.test.js',
    'server/analyticsRuntime.test.js', 'server/capacity-followup.test.js', 'server/server-followups.test.js',
    'server/backend-fix-regressions.test.js', 'public/audioIcons.test.js',
    'server/backend-fix-regressions-b.test.js', 'server/backend-fix-regressions-c.test.js',
    'server/backend-fix-regressions-d.test.js', 'server/money-debt-loan-market.test.js', 'server/room-lifecycle-defects.test.js',
    'server/social-socket.test.js', 'server/socialStoreIntegrity.test.js',
    'server/bot-purchase-loan-build.test.js', 'server/bot-snapshot-literals.test.js',
    'server/market-snapshot-and-loans.test.js', 'server/start-salary-paths.test.js',
    'server/equity-rent-income.test.js', 'server/group-traffic-percent.test.js',
    'server/room-setting-validation.test.js',
    'server/bot-audit-fixes.test.js', 'server/money-audit-fixes.test.js', 'server/rooms-audit-fixes.test.js',
  ],
  timers: ['server/player-lifecycle-timers.test.js'],
  account: [
    'server/accountStore-id-lookup.test.js', 'server/accountStore-privacy-patch.test.js',
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
    'public/clientItems.test.js',
    'public/clientFinanceRules.test.js',
    'server/chat-activity-routing.test.js', 'server/contractCancelOffTurn.test.js', 'server/http-surface-wire.test.js',
    'server/marketQuoteHistory.test.js', 'server/marketViewerProjection.test.js', 'public/clientChatActivity.test.js',
    'public/clientChatScroll.test.js', 'public/clientActionErrorNotice.test.js', 'public/clientBankLoanUi.test.js',
    'public/clientDeedSaleUi.test.js',
    'public/clientFinancingAmount.test.js', 'public/clientRankingPicker.test.js',
    'public/clientRecoveryUi.test.js',
    'public/clientSocialTableLayout.test.js',
    'public/clientMarketUi.test.js', 'public/clientCasinoUi.test.js', 'public/clientFriendRequestActions.test.js',
    'public/clientSocialSurfaces.test.js', 'public/clientProfileSurfaces.test.js',
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
