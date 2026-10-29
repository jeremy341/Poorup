/* global document, innerWidth, innerHeight, process */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { visualRoomCode } from './visual-capture/fixtures.mjs';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

const targetProjects = new Set(['ipad-1024x768', 'ipad-1194x834', 'desktop-1440x900']);

test('in-game player card stays compact at desktop and iPad sizes', async ({ page }, testInfo) => {
  test.skip(!process.env.POORUP_VISUAL_CAPTURE_DIR && !targetProjects.has(testInfo.project.name), 'Player-card redesign targets desktop and landscape iPad.');
  const roomCode = process.env.POORUP_CAPTURE_SEED
    ? visualRoomCode('P', process.env.POORUP_CAPTURE_SEED, testInfo.project.name)
    : `P${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const guest = await page.context().newPage();

  await page.goto('/');
  await page.locator('#home-alias').fill('UXHOST');
  await page.locator('#open-create-btn').click();
  await page.locator('#rc-vis-selector [data-vis="private"]').click();
  await page.locator('#rc-room-code').fill(roomCode);
  await page.locator('#rc-create-btn').click();
  await expect(page.locator('#setup-wrap')).not.toHaveAttribute('aria-hidden', 'true');
  await page.locator('#su-start').click();

  await guest.goto('/');
  await guest.locator('#home-alias').fill('UXGUEST');
  await guest.locator('#open-join-btn').click();
  await guest.locator('#room-join').fill(roomCode);
  await guest.locator('#join-nickname').fill('UXGUEST');
  await guest.locator('#join-room-submit').click();
  await guest.locator('#su-start').click();
  await expect(page.locator('#lobby-settings-body')).toContainText('UXGUEST');
  await page.locator('#lobby-start-btn').click();
  await expect(page.locator('#view-game')).toBeVisible();

  await page.evaluate(async () => {
    const [{ state }, surfaces, social] = await Promise.all([
      import('/clientState.js'), import('/clientSurfaces.js'), import('/clientSocialSurfaces.js'),
    ]);
    const local = state.players[0];
    const other = state.players.find(player => player.serverId !== local.serverId);
    state.selectedPlayer = {
      ...other, name: 'VESPER', displayName: 'VESPER', accountId: null, accountLinked: false,
      online: true, bot: false, bankrupt: false, spectating: false, avatarGrid: null,
      gamesPlayed: 12, wins: 5, achievements: [], recentMatches: [],
    };
    state.selectedPlayerRelationship = 'none';
    state.selectedPlayerView = 'profile';
    state.selectedPlayerHistory = null;
    social.renderPlayerSurface();
    surfaces.openSurface('#player-modal', '#player-modal-close');
  });
  const card = page.locator('#player-card');
  await expect(page.locator('#player-modal')).not.toHaveClass(/is-hidden/);
  await expect(card.locator('.player-profile-facts > div')).toHaveCount(4);
  const viewport = page.viewportSize();
  const box = await card.boundingBox();
  expect(box.width).toBeLessThanOrEqual(Math.min(500, viewport.width - 32));
  expect(box.height).toBeLessThanOrEqual(viewport.height - 32);
  await expect(page.locator('#player-modal-close')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1
    && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  const outputDir = path.resolve('qa-artifacts', 'ui-refresh-2026-10-03', 'player-card');
  await mkdir(outputDir, { recursive: true });
  await captureScreenshot(page, testInfo, {
    group: 'player',
    surfaceId: 'player-card-responsive',
    label: 'In-game player card',
    fallbackPath: path.join(outputDir, `player-card-${viewport.width}x${viewport.height}.png`),
  });

  const zoomedViewport = { width: Math.floor(viewport.width / 2), height: Math.floor(viewport.height / 2) };
  await page.setViewportSize(zoomedViewport);
  const zoomedCard = await card.boundingBox();
  expect(zoomedCard.x).toBeGreaterThanOrEqual(0);
  expect(zoomedCard.y).toBeGreaterThanOrEqual(0);
  expect(zoomedCard.x + zoomedCard.width).toBeLessThanOrEqual(zoomedViewport.width + 1);
  expect(zoomedCard.y + zoomedCard.height).toBeLessThanOrEqual(zoomedViewport.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1
    && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await guest.close();
});
