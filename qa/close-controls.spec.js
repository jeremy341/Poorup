import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { visualRoomCode } from './visual-capture/fixtures.mjs';

const profiles = new Set(['desktop-1920x1080', 'desktop-2560x1440', 'ipad-944x656', 'ipad-1194x834']);
const cases = [
  ['trade-offer', '#offer-close', '#offer-modal', '#offer-card', 'openTradeOffer', [], 'closeTradeOffer'],
  ['trade-builder', '#trade-close', '#trade-modal', '#trade-card', 'openTradeBuilder', [], 'closeTradeBuilder'],
  ['financing', '#financing-close', '#financing-modal', '#financing-card', 'openFinancing', [], 'closeFinancing'],
  ['property-inspector', '#pop-close', '#popup', '#popup-card', 'openTile', [1], 'closeTile'],
  ['deed-manager', '#dd-close', '#deed-modal', '#deed-card-detail', 'openDeed', [1], 'closeDeed'],
  ['deal-details', '#deal-detail-close', '#deal-detail-modal', '#deal-detail-card', 'openPendingDeal', [], 'closePendingDeal'],
  ['wallet', '#wallet-modal-close', '#wallet-modal', '#wallet-card', 'openWallet', ['account'], 'closeWallet'],
  ['market', '#market-modal-close', '#market-modal', '#market-card', 'openMarket', [], 'closeMarket'],
  ['casino', '#casino-modal-close', '#casino-modal', '#casino-card', 'openCasino', [], 'closeCasino'],
  ['flights', '#flight-close', '#flight-modal', '#flight-card', 'openFlights', [], 'closeFlights'],
  ['rooms', '#rooms-close', '#rooms-modal', '#rooms-card', 'openRooms', [], 'closeRooms'],
  ['sign-in', '#account-modal-close', '#account-modal', '#account-card', 'openAccount', [], 'closeAccount'],
  ['account-data', '#account-rights-close', '#account-modal', '#account-card', 'openRights', [], 'closeAccount'],
  ['player-profile', '#player-modal-close', '#player-modal', '#player-card', 'openPlayer', [], 'closePlayer'],
  ['card-gallery', '#card-gallery-close', '#card-gallery', '#card-gallery .card-gallery-shell', 'openCardGallery', [], 'closeCardGallery'],
  ['panel-layout', '#panel-menu-close', '#panel-menu', '#panel-menu', 'openPanels', [], 'closePanels'],
  ['event-log', '#drawer-close', '#log-drawer', '#log-drawer', 'openLog', [], 'closeLog'],
];

async function prepare(page, context, code) {
  const guest = await context.newPage();
  await page.goto('/');
  await page.locator('#home-alias').fill('CLOSEHOST');
  await page.locator('#open-create-btn').click();
  await page.locator('#rc-vis-selector [data-vis="private"]').click();
  await page.locator('#rc-room-code').fill(code);
  await page.locator('#rc-create-btn').click();
  await page.locator('#su-start').click();
  await guest.goto('/');
  await guest.locator('#open-join-btn').click();
  await guest.locator('#room-join').fill(code);
  await guest.locator('#join-nickname').fill('CLOSEGUEST');
  await guest.locator('#join-room-submit').click();
  await guest.locator('#su-start').click();
  await expect(page.locator('#player-list .player-row')).toHaveCount(2);
  await page.locator('#lobby-start-btn').click();
  await expect(page.locator('#view-game')).toBeVisible();
  const source = await readFile(new URL('./visual-capture/ipad-modal-fixture.browser.js', import.meta.url), 'utf8');
  const fixtureUrl = new URL('/qa/close-fixture.js', page.url()).href;
  await page.route(fixtureUrl, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: source }));
  await page.addScriptTag({ url: fixtureUrl, type: 'module' });
  await page.evaluate(async () => {
    await window.__installIpadModalCapture();
    const fixture = window.__ipadModalCapture;
    const [flights, rooms, rights] = await Promise.all([import('/clientFlightUi.js'), import('/clientRoomsUi.js'), import('/clientAccountRights.js')]);
    Object.assign(fixture, {
      openFlights() {
        fixture.state.players[0].pos = 5;
        fixture.state.flights = { enabled: true, defaultFare: 100, maxFee: 200, options: [{ tileIndex: 15, fare: 100, basis: 'default', payeeId: null, affordable: true }] };
        flights.openFlightDesk();
      },
      closeFlights() { flights.closeFlightDesk(); },
      openRooms() { rooms.openRoomsModal('browse'); },
      closeRooms() { rooms.closeRoomsModal(); },
      openRights() {
        const account = { id: 'preview-owner', username: 'closehost', displayName: 'CLOSEHOST', recoveryEmail: null };
        rights.renderAccountRights(account);
        rights.bindAccountRights();
        document.querySelector('#account-rights-content [data-recovery-email]').click();
      },
      openPanels() { document.querySelector('#panels-btn').click(); },
      closePanels() { if (!document.querySelector('#panel-menu').classList.contains('is-hidden')) document.querySelector('#panel-menu-close').click(); },
    });
  });
  await page.evaluate(() => document.fonts.ready);
  return guest;
}

test('ordinary close controls dismiss the same surfaces and preserve labelled actions', async ({ page, context }, testInfo) => {
  test.skip(!profiles.has(testInfo.project.name), 'native desktop and landscape iPad coverage');
  test.setTimeout(180_000);
  const phase = process.env.POORUP_CLOSE_CAPTURE_PHASE || 'after';
  const root = process.env.POORUP_CLOSE_CAPTURE_DIR;
  const code = visualRoomCode('XC', `close-${phase}-${randomUUID()}`, testInfo.project.name);
  const guest = await prepare(page, context, code);
  const records = [];
  try {
    for (const [id, button, surface, card, open, args, cleanup] of cases) {
      await test.step(id, async () => {
        await page.evaluate(({ method, args }) => window.__ipadModalCapture[method](...args), { method: open, args });
        await expect(page.locator(button)).toBeVisible();
        const control = page.locator(button);
        if (phase !== 'before') {
          await expect(control).toHaveAttribute('type', 'button');
          await expect(control).toHaveAttribute('aria-label', /Close .+/);
          await expect(control.locator('svg')).toBeVisible();
          const geometry = await control.boundingBox();
          expect(geometry.width).toBeGreaterThanOrEqual(44);
          expect(geometry.height).toBeGreaterThanOrEqual(44);
          expect(geometry.width).toBeLessThanOrEqual(50);
          expect(geometry.height).toBeLessThanOrEqual(50);
        }
        if (root) {
          const folder = path.join(root, phase, testInfo.project.name);
          await mkdir(folder, { recursive: true });
          await page.locator(card).screenshot({ path: path.join(folder, `${id}.png`), animations: 'disabled' });
          records.push({ id, button, surface, file: `${phase}/${testInfo.project.name}/${id}.png` });
        }
        await control.focus();
        await page.keyboard.press('Enter');
        if (surface === '#log-drawer') await expect(page.locator(surface)).not.toHaveClass(/is-open/);
        else await expect(page.locator(surface)).toHaveClass(/is-hidden/);
        if (id === 'trade-offer') expect(await page.evaluate(() => window.__ipadModalCapture.state.pendingTrade?.id)).toBe('visual-trade-offer');
        await page.evaluate(method => window.__ipadModalCapture[method](), cleanup);
      });
    }
    for (const [selector, open, cleanup] of [
      ['#auction-close', 'openAuction', 'closeAuction'],
      ['#sponsorship-close', 'openFundingActive', 'closeFunding'],
      ['#bank-dismiss', 'openBankruptcy', 'closeBankruptcy'],
    ]) {
      await page.evaluate(method => window.__ipadModalCapture[method](), open);
      await expect(page.locator(selector)).toHaveText(/^close$/i);
      await expect(page.locator(selector)).not.toHaveClass(/surface-close/);
      await page.evaluate(method => window.__ipadModalCapture[method](), cleanup);
    }
  } finally {
    if (root) await writeFile(path.join(root, `${phase}-${testInfo.project.name}.json`), JSON.stringify(records, null, 2));
    await guest.close();
  }
});
