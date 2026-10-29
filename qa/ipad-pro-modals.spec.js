/* global window, document, process */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { visualRoomCode } from './visual-capture/fixtures.mjs';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

const tileInspectors = [
  ['tile-property.png', 1], ['tile-airport.png', 5], ['tile-electric-company.png', 12],
  ['tile-water-company.png', 28], ['tile-earnings-tax.png', 4], ['tile-chance.png', 7],
  ['tile-treasure-chest.png', 2], ['tile-start.png', 0], ['tile-passing-by.png', 10],
  ['tile-vacation.png', 20], ['tile-go-to-prison.png', 30],
];

const modalCaptures = [
  ['12-purchase-choice-airport.png', '#choice-modal', 'openChoice', [], 'closeChoice'],
  ['13-live-auction.png', '#auction-modal', 'openAuction', [], 'closeAuction'],
  ['30-card-reveal-chance.png', '#card-modal', 'openCard', ['chance'], 'closeCard'],
  ['30-card-reveal-chest.png', '#card-modal', 'openCard', ['chest'], 'closeCard'],
  ['38-card-gallery.png', '#card-gallery', 'openCardGallery', [], 'closeCardGallery'],
  ['14-trade-offer-inbox.png', '#offer-modal', 'openTradeOffer', [], 'closeTradeOffer'],
  ['15-trade-builder.png', '#trade-modal', 'openTradeBuilder', [], 'closeTradeBuilder'],
  ['25-pending-deal-details.png', '#deal-detail-modal', 'openPendingDeal', [], 'closePendingDeal'],
  ['16-deed-manager-property.png', '#deed-modal', 'openDeed', [1], 'closeDeed'],
  ['17-deed-manager-airport.png', '#deed-modal', 'openDeed', [5], 'closeDeed'],
  ['18-deed-manager-electric-company.png', '#deed-modal', 'openDeed', [12], 'closeDeed'],
  ['19-deed-manager-water-company.png', '#deed-modal', 'openDeed', [28], 'closeDeed'],
  ['20-financing-builder-loan.png', '#financing-modal', 'openFinancing', [], 'closeFinancing'],
  ['21-emergency-bank-credit.png', '#bank-loan-modal', 'openBank', [], 'closeBank'],
  ['22-wallet-account.png', '#wallet-modal', 'openWallet', ['account'], 'closeWallet'],
  ['22-wallet-items.png', '#wallet-modal', 'openWallet', ['items'], 'closeWallet'],
  ['23-market-desk.png', '#market-modal', 'openMarket', [], 'closeMarket'],
  ['24-casino-desk.png', '#casino-modal', 'openCasino', [], 'closeCasino'],
  ['24-player-profile-from-table.png', '#player-modal', 'openPlayer', [], 'closePlayer'],
  ['26-purchase-funding-request.png', '#sponsorship-modal', 'openFundingRequest', [], 'closeFunding'],
  ['27-active-purchase-funding.png', '#sponsorship-modal', 'openFundingActive', [], 'closeFunding'],
  ['28-bankruptcy-payment.png', '#bankruptcy-modal', 'openBankruptcy', [], 'closeBankruptcy'],
  ['29-voluntary-retirement.png', '#bankruptcy-modal', 'openRetirement', [], 'closeBankruptcy'],
  ['31-confirm-deal-action.png', '#confirm-modal', 'openConfirm', [], 'closeConfirm'],
  ['32-event-log-drawer.png', '#log-drawer', 'openLog', [], 'closeLog'],
  ['33-round-over.png', '#gameover-modal', 'openRoundOver', [], 'closeRoundOver'],
  ['34-account-sign-in-modal.png', '#account-modal', 'openAccount', [], 'closeAccount'],
  ['35-achievement-detail-modal.png', '#achievement-modal', 'openAchievement', [], 'closeAchievement'],
  ['36-rankings-overlay.png', '#rankings-modal', 'openRankingsOverlay', [], 'closeRankingsOverlay'],
  ['37-social-overlay.png', '#social-modal', 'openSocialOverlay', [], 'closeSocialOverlay'],
];

async function captureLobbySurface(page, testInfo, outputDir, surface) {
  await captureScreenshot(page, testInfo, {
    group: 'lobby', surfaceId: surface.id, label: surface.label,
    fallbackPath: path.join(outputDir, surface.file),
  });
}

async function captureRoomBrowser(page, testInfo, outputDir) {
  await page.goto('/');
  await page.locator('#home-alias').fill('UXHOST');
  await page.locator('#open-join-btn').click();
  await expect(page.locator('#rooms-modal')).not.toHaveClass(/is-hidden/);
  await page.locator('#rm-tab-browse').click();
  await expect(page.locator('#rm-tab-browse')).toHaveAttribute('aria-selected', 'true');
  await captureLobbySurface(page, testInfo, outputDir, { id: 'room-browser', label: 'Room browser', file: 'lobby-room-browser.png' });
  await page.locator('#rm-tab-create').click();
  await captureLobbySurface(page, testInfo, outputDir, { id: 'create-room-form', label: 'Create room form', file: 'lobby-create-room.png' });
  await page.locator('#rm-tab-join').click();
  await captureLobbySurface(page, testInfo, outputDir, { id: 'join-room-form', label: 'Join room form', file: 'lobby-join-room.png' });
  await page.locator('#rooms-close').click();
}

async function createCaptureRoom(page, testInfo, outputDir, roomCode) {
  await page.locator('#open-create-btn').click();
  await page.locator('#rc-vis-selector [data-vis="private"]').click();
  await page.locator('#rc-room-code').fill(roomCode);
  await page.locator('#rc-create-btn').click();
  await expect(page.locator('#setup-wrap')).not.toHaveAttribute('aria-hidden', 'true');
  await captureLobbySurface(page, testInfo, outputDir, { id: 'appearance-setup', label: 'Appearance setup', file: '00-appearance-setup.png' });
  await page.locator('#su-start').click();
}

async function joinCaptureGuest(guest, page, testInfo, outputDir, roomCode) {
  await guest.goto('/');
  await guest.locator('#home-alias').fill('UXGUEST');
  await guest.locator('#open-join-btn').click();
  await guest.locator('#room-join').fill(roomCode);
  await guest.locator('#join-nickname').fill('UXGUEST');
  await guest.locator('#join-room-submit').click();
  await guest.locator('#su-start').click();
  await expect(page.locator('#lobby-settings-body')).toContainText('UXGUEST');
  await captureScreenshot(page, testInfo, {
    group: 'lobby', surfaceId: 'waiting-lobby', label: 'Two-player waiting lobby',
    fixtureId: 'synthetic-two-player-lobby', fallbackPath: path.join(outputDir, 'lobby-waiting-room.png'),
  });
  await page.locator('#lobby-start-btn').click();
  await expect(page.locator('#view-game')).toBeVisible();
}

async function prepareCaptureGame({ page, guest, testInfo, outputDir, roomCode }) {
  await captureRoomBrowser(page, testInfo, outputDir);
  await createCaptureRoom(page, testInfo, outputDir, roomCode);
  await joinCaptureGuest(guest, page, testInfo, outputDir, roomCode);
}

async function installCaptureFixture(page) {
  const source = await readFile(new URL('./visual-capture/ipad-modal-fixture.browser.js', import.meta.url), 'utf8');
  const fixtureUrl = new URL('/qa/visual-capture/ipad-modal-fixture.browser.js', page.url()).href;
  await page.route(fixtureUrl, route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: source,
  }));
  await page.addScriptTag({ url: fixtureUrl, type: 'module' });
  await page.evaluate(() => window.__installIpadModalCapture());
}

function captureContext(page, testInfo, outputDir) {
  return { page, testInfo, outputDir, capturedGameSurfaceIds: [] };
}

async function captureSurface(context, surface) {
  const { page, testInfo, outputDir, capturedGameSurfaceIds } = context;
  const [filename, selector, openMethod, args, closeMethod] = surface;
  await page.evaluate(({ method, parameters }) => window.__ipadModalCapture[method](...parameters), { method: openMethod, parameters: args });
  await assertSurfaceOpen(page, selector);
  await assertPlayerCardBounds(page, selector);
  const surfaceId = filename.replace(/^\d+-/, '').replace(/\.png$/, '');
  const screenshot = await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId, label: surfaceId.replaceAll('-', ' '),
    fallbackPath: path.join(outputDir, filename),
  });
  if (screenshot.status !== 'skipped') capturedGameSurfaceIds.push(surfaceId);
  await page.evaluate(method => window.__ipadModalCapture[method](), closeMethod);
  await assertAllSurfacesClosed(page);
}

async function assertSurfaceOpen(page, selector) {
  if (selector === '#log-drawer') {
    await expect(page.locator(selector)).toHaveClass(/is-open/);
    return;
  }
  await expect(page.locator(selector)).not.toHaveClass(/is-hidden/);
}

async function assertPlayerCardBounds(page, selector) {
  if (selector !== '#player-modal') return;
  const playerCard = await page.locator('#player-card').boundingBox();
  expect(playerCard.width).toBeLessThanOrEqual(500);
  expect(playerCard.height).toBeLessThanOrEqual(802);
}

async function assertAllSurfacesClosed(page) {
  await expect.poll(() => page.evaluate(() => {
    const modals = [...document.querySelectorAll('.popup')].filter(element => !element.classList.contains('is-hidden')).length;
    const drawerOpen = document.querySelector('#log-drawer')?.classList.contains('is-open') ? 1 : 0;
    const galleryOpen = document.querySelector('#card-gallery')?.classList.contains('is-hidden') ? 0 : 1;
    return modals + drawerOpen + galleryOpen;
  })).toBe(0);
}

async function captureBoardVariants(context) {
  const { page, testInfo, outputDir, capturedGameSurfaceIds } = context;
  await page.evaluate(() => window.__ipadModalCapture.setBoardVariant('standard-40'));
  const standard = await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'board-standard-40', label: 'Standard 40 board at rest',
    fallbackPath: path.join(outputDir, 'board-standard-40.png'),
  });
  recordCapturedId(capturedGameSurfaceIds, standard, 'board-standard-40');

  await page.evaluate(() => window.__ipadModalCapture.setBoardVariant('metro-52'));
  await expect(page.locator('#board-grid')).toHaveAttribute('data-board-variant', 'metro-52');
  await expect(page.locator('#tn-lobby')).toContainText('METRO-52');
  const metro = await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'board-metro-52', label: 'Metro 52 board at rest',
    fallbackPath: path.join(outputDir, 'board-metro-52.png'),
  });
  recordCapturedId(capturedGameSurfaceIds, metro, 'board-metro-52');
  await page.evaluate(() => window.__ipadModalCapture.setBoardVariant('standard-40'));
}

function recordCapturedId(capturedIds, result, surfaceId) {
  if (result.status !== 'skipped') capturedIds.push(surfaceId);
}

async function captureConfiguredSurfaces(context, surfaces) {
  for (const surface of surfaces) await captureSurface(context, surface);
}

async function captureGameGallery(context) {
  await captureBoardVariants(context);
  const tileCaptures = tileInspectors.map(([file, index]) => [file, '#popup', 'openTile', [index], 'closeTile']);
  await captureConfiguredSurfaces(context, tileCaptures);
  await captureConfiguredSurfaces(context, modalCaptures);
  verifyCapturedSurfaceCount(context.capturedGameSurfaceIds);
}

function verifyCapturedSurfaceCount(capturedIds) {
  const group = process.env.POORUP_CAPTURE_GROUP;
  const expectedCount = !group || group === 'all' || group === 'game' ? 43 : 0;
  expect(capturedIds).toHaveLength(expectedCount);
}

test('capture every in-game modal on supported landscape profiles', async ({ page, context }, testInfo) => {
  test.skip(!process.env.POORUP_VISUAL_CAPTURE_DIR && testInfo.project.name !== 'ipad-1194x834', 'This capture set targets iPad Pro 11-inch landscape outside the gallery runner.');
  test.setTimeout(120_000);
  const outputDir = path.resolve('qa-artifacts', 'ui-refresh-2026-10-03', 'ipad-pro-modal-gallery');
  await mkdir(outputDir, { recursive: true });
  const roomCode = process.env.POORUP_CAPTURE_SEED
    ? visualRoomCode('V', process.env.POORUP_CAPTURE_SEED, testInfo.project.name)
    : `V${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const guest = await context.newPage();

  await prepareCaptureGame({ page, guest, testInfo, outputDir, roomCode });
  await installCaptureFixture(page);
  await captureGameGallery(captureContext(page, testInfo, outputDir));
  await guest.close();
});
