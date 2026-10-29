/* global window, document, innerWidth, innerHeight, process */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

const targetProjects = new Set(['ipad-1024x768', 'ipad-1194x834', 'desktop-1440x900']);

test('funding request names its room-wide audience and preserves equity terms', async ({ page }, testInfo) => {
  test.skip(!process.env.POORUP_VISUAL_CAPTURE_DIR && !targetProjects.has(testInfo.project.name), 'Sponsorship presentation targets desktop and landscape iPad.');
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ state }, surfaces, sponsorship] = await Promise.all([
      import('/clientState.js'), import('/clientSurfaces.js'), import('/clientSponsorshipUi.js'),
    ]);
    state.phase = 'playing';
    state.players = [
      { id: 'p1', serverId: 'buyer-seat', clientId: state.clientId, name: 'ALPHA', cash: 1500, items: {}, online: true },
      { id: 'p2', serverId: 'beta-seat', name: 'BETA', cash: 1500, items: {}, online: true },
      { id: 'p3', serverId: 'gamma-seat', name: 'GAMMA', cash: 1500, items: {}, online: true },
      { id: 'p4', serverId: 'inactive-seat', name: 'BANKRUPT', cash: 0, bankrupt: true, items: {} },
    ];
    sponsorship.configureSponsorshipUi({ emitServer: () => {}, createRequestId: () => 'visual-equity-request' });
    window.__sponsorshipVisual = {
      state,
      surfaces,
      sponsorship,
      openRequest() { sponsorship.requestSponsorship(5); },
      openActiveEquity() {
        const offer = {
          id: 'visual-equity-active', mode: 'equity', sharePct: 25,
          buyerId: 'buyer-seat', buyerName: 'ALPHA', tileIndex: 5, tileName: 'ACC AIRPORT',
          price: 200, totalContributed: 100, amountNeeded: 100,
          contributions: [{ sponsorId: 'beta-seat', sponsorName: 'BETA', amount: 100 }],
        };
        state.sponsorship = offer;
        sponsorship.openSponsorshipModal(offer);
      },
      close() { state.sponsorship = null; surfaces.closeSurface('#sponsorship-modal', { force: true }); },
    };
  });

  await page.evaluate(() => window.__sponsorshipVisual.openRequest());
  await expect(page.locator('#sponsorship-modal')).not.toHaveClass(/is-hidden/);
  const audience = page.locator('#sponsorship-card [aria-label="Funding request audience"]');
  await expect(audience).toContainText('ALL OTHER ACTIVE PLAYERS');
  await expect(audience).toContainText('BETA');
  await expect(audience).toContainText('GAMMA');
  await expect(audience).not.toContainText('BANKRUPT');
  await expect(page.locator('[data-sponsorship-mode-summary]')).toContainText('GIFT FUNDING');
  await page.locator('input[name="mode"][value="equity"]').check();
  await page.locator('[name="sharePct"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-sponsorship-mode-summary]')).toContainText('EQUITY INVESTMENT · 25% OF COLLECTED RENT');
  const viewport = page.viewportSize();
  const requestBounds = await page.locator('#sponsorship-card').boundingBox();
  expect(requestBounds.width).toBeLessThanOrEqual(viewport.width - 32);
  const outputDir = path.resolve('qa-artifacts', 'ui-refresh-2026-10-03', 'sponsorship');
  await mkdir(outputDir, { recursive: true });
  await captureScreenshot(page, testInfo, {
    group: 'funding',
    surfaceId: 'funding-request-equity',
    label: 'Equity funding request',
    fallbackPath: path.join(outputDir, `request-equity-${viewport.width}x${viewport.height}.png`),
  });

  await page.evaluate(() => window.__sponsorshipVisual.close());
  await page.evaluate(() => window.__sponsorshipVisual.openActiveEquity());
  await expect(page.locator('#sponsorship-card .sponsorship-funding-type')).toContainText('EQUITY INVESTMENT · 25% OF COLLECTED RENT');
  await expect(page.locator('#sponsorship-card .sponsorship-equity-terms')).toContainText('25%');
  const activeBounds = await page.locator('#sponsorship-card').boundingBox();
  expect(activeBounds.width).toBeLessThanOrEqual(viewport.width - 32);
  await captureScreenshot(page, testInfo, {
    group: 'funding',
    surfaceId: 'active-equity-offer',
    label: 'Active equity offer',
    fallbackPath: path.join(outputDir, `active-equity-${viewport.width}x${viewport.height}.png`),
  });
  const zoomedViewport = { width: Math.floor(viewport.width / 2), height: Math.floor(viewport.height / 2) };
  await page.setViewportSize(zoomedViewport);
  const zoomedCard = await page.locator('#sponsorship-card').boundingBox();
  expect(zoomedCard.x).toBeGreaterThanOrEqual(0);
  expect(zoomedCard.y).toBeGreaterThanOrEqual(0);
  expect(zoomedCard.x + zoomedCard.width).toBeLessThanOrEqual(zoomedViewport.width + 1);
  expect(zoomedCard.y + zoomedCard.height).toBeLessThanOrEqual(zoomedViewport.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1
    && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
});
