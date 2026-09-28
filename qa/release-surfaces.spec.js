import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('release surface evidence', () => {
  test('captures the 1920px release surfaces', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920', 'Native release evidence is captured at 1920x1080.');
    const artifactRoot = path.resolve('qa-artifacts', 'release-surfaces-2026-09-27');
    await page.goto('/');
    await expect(page.locator('#view-home')).toBeVisible();
    await page.screenshot({ path: path.join(artifactRoot, 'home-1920.png') });

    await page.locator('#home-rankings-tab').click();
    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      const { renderRankingsSurface } = await import('/clientSocialSurfaces.js');
      const rows = [
        { accountId: 'rank-alpha', displayName: 'ALPHA', username: 'alpha', games: 8, wins: 5, value: 5, trend: { direction: 'up', delta: 2 } },
        { accountId: 'rank-beta', displayName: 'BETA', username: 'beta', games: 6, wins: 3, value: 3, trend: { direction: 'flat', delta: 0 } },
      ];
      state.account = { account: null, sessionToken: '' };
      state.leaderboard.metric = 'wins';
      state.leaderboard.scope = 'all';
      state.leaderboard.rows = rows;
      state.leaderboard.snapshots = { wins: rows };
      state.leaderboard.loading = false;
      state.leaderboard.error = '';
      state.season.current = { id: 'S-2026-09', status: 'active', startsAt: '2026-09-01', endsAt: '2026-10-27' };
      state.season.rows = [{ displayName: 'ALPHA', username: 'alpha', games: 8, points: 420 }, { displayName: 'BETA', username: 'beta', games: 6, points: 300 }];
      state.season.rewards = [
        { id: 'season-bronze', track: 'placement', threshold: 0.9, tokens: 40 },
        { id: 'season-silver', track: 'placement', threshold: 0.8, tokens: 80 },
        { id: 'season-gold', track: 'placement', threshold: 0.7, tokens: 140 },
      ];
      state.season.claimedRewardIds = [];
      state.season.loading = false;
      state.season.error = '';
      renderRankingsSurface('#rankings-page-content');
    });
    await expect(page.locator('#rankings-page-content .season-signin-prompt')).toContainText('SIGN IN');
    await page.screenshot({ path: path.join(artifactRoot, 'rankings-season-1920.png') });

    await page.locator('#view-rankings [data-home-tab="profile"]').click();
    await expect(page.locator('#view-profile')).toBeVisible();
    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      const { renderProfileStatistics, renderProfileHistory } = await import('/clientProfileRender.js');
      const accountId = 'release-owner';
      const match = {
        matchId: 'release-match-01', completedAt: '2026-09-26T20:30:00.000Z', durationSeconds: 840,
        roundCount: 12, boardVariant: 'standard-40', result: 'WIN',
        participants: [
          { accountId, displayNameAtMatch: 'RELEASE OWNER', finalPlacement: 1, endingCash: 1320, propertyCount: 5 },
          { accountId: 'guest-02', displayNameAtMatch: 'NIGHT OWL', finalPlacement: 2, endingCash: 760, propertyCount: 3 },
        ],
        globalEvents: ['Market rush', 'Housing bubble'], tradesCompleted: 2, auctionsCompleted: 1,
        casino: [{ accountId, net: -20 }], market: [{ accountId, net: 65 }], playerContracts: [{ status: 'paid' }],
      };
      state.account = { sessionToken: 'qa-release-session', account: {
        id: accountId, username: 'release-owner', displayName: 'RELEASE OWNER',
        stats: { gamesPlayed: 8, wins: 5, bankruptcies: 1, casinoNet: -20, marketProfit: 65, eventSurvival: 6, auctionWins: 4, playerLoansGiven: 2, equityDeals: 1 },
        matchHistory: [match], history: [match],
      } };
      renderProfileStatistics();
      renderProfileHistory();
    });
    await page.locator('#profile-tab-stats').click();
    await expect(page.locator('#profile-tab-stats')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#profile-panel-stats')).toBeVisible();
    await page.screenshot({ path: path.join(artifactRoot, 'profile-statistics-1920.png') });
    await page.locator('#profile-tab-history').click();
    await page.locator('[data-profile-history-toggle="release-match-01"]').click();
    await page.locator('[data-profile-history-detail-tab="economy"]').click();
    await page.screenshot({ path: path.join(artifactRoot, 'profile-match-history-detail-1920.png') });
    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      state.account = { account: null, sessionToken: '' };
    });

    await page.goto('/?rules=book');
    await expect(page.locator('#view-rules')).toBeVisible();
    await page.screenshot({ path: path.join(artifactRoot, 'rules-1920.png') });

    const guest = await context.newPage();
    const roomCode = 'RELZ17';
    await page.goto('/');
    await page.locator('#home-alias').fill('RELEASEHOST');
    await page.locator('#open-create-btn').click();
    await page.locator('#rc-vis-selector [data-vis="private"]').click();
    await page.locator('#rc-room-code').fill(roomCode);
    await page.locator('#rc-create-btn').click();
    await page.locator('#su-start').click();

    await guest.goto('/');
    await guest.locator('#home-alias').fill('RELEASEGUEST');
    await guest.locator('#open-join-btn').click();
    await guest.locator('#room-join').fill(roomCode);
    await guest.locator('#join-nickname').fill('RELEASEGUEST');
    await guest.locator('#join-room-submit').click();
    await guest.locator('#su-start').click();
    await page.locator('#lobby-start-btn').click();
    await expect(page.locator('#view-game')).toBeVisible();

    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      const { openMarketDesk } = await import('/clientMarketUi.js');
      state.suppressRoomUpdates = true;
      state.economy.market = {
        enabled: true, round: 3, feeRate: 0.02, complexity: 'derivatives',
        quotes: { brazil: 113, ghana: 101, thailand: 100, japan: 98, netherlands: 102, canada: 106, switzerland: 99, singapore: 100, airports: 105, utilities: 100, property: 103 },
        quoteHistory: [
          { round: 0, quotes: { brazil: 100, ghana: 100, thailand: 100, japan: 100, netherlands: 100, canada: 100, switzerland: 100, singapore: 100, airports: 100, utilities: 100, property: 100 } },
          { round: 1, quotes: { brazil: 104, ghana: 100, thailand: 100, japan: 99, netherlands: 100, canada: 102, switzerland: 100, singapore: 100, airports: 100, utilities: 100, property: 100 }, eventId: 'market-rush' },
          { round: 2, quotes: { brazil: 113, ghana: 101, thailand: 100, japan: 98, netherlands: 102, canada: 106, switzerland: 99, singapore: 100, airports: 105, utilities: 100, property: 103 } },
        ],
        personalTrades: [{ roundNumber: 1, instrumentId: 'brazil', side: 'buy', quantity: 2, quote: 104, fee: 5 }],
        positions: { brazil: { quantity: 2, averageCost: 106.5, realizedPnl: 0 } },
        shorts: { positions: {} }, options: [],
      };
      openMarketDesk();
    });
    await expect(page.locator('#market-modal')).not.toHaveClass(/is-hidden/);
    await page.screenshot({ path: path.join(artifactRoot, 'market-desk-1920.png') });
    await page.locator('#market-card [data-market-preview]').scrollIntoViewIfNeeded();
    const marketCard = await page.locator('#market-card').boundingBox();
    const marketClose = await page.locator('#market-modal-close').boundingBox();
    expect(marketClose).not.toBeNull();
    expect(marketClose.y).toBeGreaterThanOrEqual(marketCard.y);
    expect(marketClose.y).toBeLessThan(marketCard.y + 120);
    await page.screenshot({ path: path.join(artifactRoot, 'market-order-controls-1920.png') });
    await page.locator('#market-modal-close').click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.locator('.tile[data-tile="15"]').click();
    await expect(page.locator('#popup')).not.toHaveClass(/is-hidden/);
    await page.screenshot({ path: path.join(artifactRoot, 'airport-field-modal-1920.png') });
    await page.keyboard.press('Escape');

    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      const { renderGlobalEvent } = await import('/clientGlobalEventRender.js');
      state.suppressRoomUpdates = true;
      state.phase = 'playing';
      state.globalEvent = {
        id: 'release-event',
        phase: 'warning',
        category: 'ECONOMIC',
        title: 'RELEASE EVIDENCE EVENT',
        summary: 'A deterministic warning fixture confirms the shared event banner and effect disclosure.',
        roundsRemaining: 3,
        effects: { rentMultiplier: 0.8, buildingCostMultiplier: 1.25, marketVolatility: 1.15 },
        choices: []
      };
      state.globalEventCompact = false;
      state.lastAnnouncedGlobalEventKey = '';
      state.globalEventAnnouncementRoomCode = state.roomCode;
      state.globalEventAnnouncementGameStarted = true;
      renderGlobalEvent();
    });
    await expect(page.locator('#global-event-ribbon')).toBeVisible();
    await page.screenshot({ path: path.join(artifactRoot, 'global-event-announcement-1920.png') });
    await expect(page.locator('#global-event-banner')).toBeVisible();
    await page.screenshot({ path: path.join(artifactRoot, 'global-event-warning-1920.png') });

    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      const { openBankruptcyModal } = await import('/clientGameModalsUi.js');
      const { renderGlobalEvent } = await import('/clientGlobalEventRender.js');
      state.globalEvent = null;
      state.suppressRoomUpdates = true;
      renderGlobalEvent();
      state.players[0].cash = 40;
      openBankruptcyModal(0, 220, null, 'The bank requires settlement before this turn can end');
    });
    await expect(page.locator('#bankruptcy-modal')).not.toHaveClass(/is-hidden/);
    await page.screenshot({ path: path.join(artifactRoot, 'bankruptcy-decision-1920.png') });
    await page.evaluate(async () => {
      const { closeSurface } = await import('/clientSurfaces.js');
      closeSurface('#bankruptcy-modal', { force: true });
    });

    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      const { renderRightRail } = await import('/clientRailRender.js');
      const { renderGlobalEvent } = await import('/clientGlobalEventRender.js');
      state.globalEvent = null;
      state.suppressRoomUpdates = true;
      state.players[0].bankrupt = true;
      state.players[0].spectating = true;
      state.turnIndex = 1;
      renderGlobalEvent();
      renderRightRail();
    });
    await expect(page.locator('#right-rail-game .spectator-rail')).toBeVisible();
    await page.screenshot({ path: path.join(artifactRoot, 'human-spectator-1920.png') });

    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      const { showGameOver } = await import('/clientGameModalsUi.js');
      state.players[0].bankrupt = false;
      state.players[0].spectating = false;
      const { renderRightRail } = await import('/clientRailRender.js');
      renderRightRail();
      showGameOver('RELEASEGUEST', state.players[1]?.serverId || state.players[1]?.id);
    });
    await expect(page.locator('#gameover-modal')).not.toHaveClass(/is-hidden/);
    await page.screenshot({ path: path.join(artifactRoot, 'end-game-1920.png') });

    await guest.close();
    testInfo.annotations.push({ type: 'screenshots', description: artifactRoot });
  });
});
