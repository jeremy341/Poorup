import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('release surface evidence', () => {
  test('captures the 1920px release surfaces', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920', 'Native release evidence is captured at 1920x1080.');
    const artifactRoot = path.resolve('qa-artifacts', 'release-surfaces-2026-09-17');
    await page.goto('/');
    await expect(page.locator('#view-home')).toBeVisible();
    await page.screenshot({ path: path.join(artifactRoot, 'home-1920.png') });

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
      renderGlobalEvent();
    });
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
