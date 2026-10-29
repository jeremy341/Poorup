/* global window, document */
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { RoomManager } from '../server/gameLogic.js';

test('rankings page uses ten readable rows and rules and settings omit removed controls', async ({ page }, testInfo) => {
  await page.goto('/');
  if (testInfo.project.name.startsWith('ipad-')) expect(await page.locator('#home-signal-line').evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(460);
  await page.locator('#home-menu-btn').click();
  await expect(page.locator('#home-menu [data-global-online]')).toHaveCount(0);
  await page.locator('#home-rankings-tab').click();
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const { renderRankingsSurface } = await import('/clientSocialSurfaces.js');
    const rows = Array.from({ length: 25 }, (_, i) => ({ accountId: `rank-${i}`, displayName: `PLAYER ${i + 1}`, username: `player_${i + 1}`, value: 25 - i, games: 50 }));
    Object.assign(state.leaderboard, { loading: false, error: '', metric: 'wins', page: 0, rows, snapshots: { wins: rows } });
    renderRankingsSurface('#rankings-page-content');
  });
  await expect(page.locator('#rankings-page-content .ranking-row')).toHaveCount(10);
  const list = page.locator('#view-rankings .ranking-list');
  expect(await list.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
  const main = await page.locator('#view-rankings .social-page-main').boundingBox();
  if (page.viewportSize().width >= 2400) expect(main.x).toBeLessThanOrEqual(28);
  await page.getByRole('button', { name: 'Next leaderboard page' }).click();
  await expect(page.locator('#rankings-page-content .ranking-row')).toHaveCount(10);
  await page.getByRole('button', { name: 'Next leaderboard page' }).click();
  await expect(page.locator('#rankings-page-content .ranking-row')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Next leaderboard page' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.goto('/');
  await page.locator('#home-rules-tab').click();
  await expect(page.locator('#rules-search, [data-rules-search-toggle]')).toHaveCount(0);
  await expect(page.locator('#rules-book-page-scroll')).toBeVisible();
});

// The bank deed buyback (the #dd-bank-sale control and the server `sell-deed` payout) is
// removed: the server rejects it with BANK_DEED_BUYBACK_UNAVAILABLE. A cleared
// deed leaves through a negotiated player trade (#dd-trade-deed, labelled SELL DEED). This
// spec pins that contract.
// Runs in the page: opens the owned deed with a deed-detail harness that forwards sales to the server.
async function openSaleDeed(summary) {
  await window.__installIpadModalCapture();
  const f = window.__ipadModalCapture;
  f.state.serverTiles = summary.tiles;
  f.state.houses = {};
  f.deed.configureDeedDetail({
    async emitServer(event, payload, ack) {
      const result = await window.__manageBankSale(event, payload);
      if (result.response.success) {
        delete f.state.owners[5];
        f.state.players[0].cash = result.cash;
        f.state.serverTiles = result.summary.tiles;
      }
      ack(result.response);
    },
    renderAll() { f.deed.renderDeedDetail(); },
  });
  f.openDeed(5);
}

test('owned deed offers a player trade, not a bank sale, and the server refuses the bank buyback', async ({ page }) => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sale-host', clientId: 'sale-host-client', nickname: 'HOST' });
  room.addOrReconnectPlayer({ socketId: 'sale-guest', clientId: 'sale-guest-client', nickname: 'GUEST' });
  room.startGame();
  const game = room.game;
  const owner = game.players[0];
  const airport = game.getTile(5);
  airport.ownerId = owner.id;
  airport.purchasePricePaid = 180;
  owner.properties.push(5);
  const startingCash = owner.cash;
  const requests = [];
  await page.exposeFunction('__manageBankSale', (event, payload) => {
    requests.push({ event, payload });
    const response = game.manageProperty('sale-host', payload);
    return { response, cash: owner.cash, owner: airport.ownerId, summary: game.getGameSummary(owner.id) };
  });
  await page.goto('/');
  await page.evaluate(async ({ ownerId, otherId }) => {
    const { state } = await import('/clientState.js');
    state.players = [{ id: 'p1', serverId: ownerId, name: 'HOST', cash: 1500, color: '#d74438' }, { id: 'p2', serverId: otherId, name: 'GUEST', cash: 1500, color: '#286ea1' }];
    state.phase = 'playing'; state.roomCode = 'SALEUI';
    document.querySelector('#view-home').classList.add('is-hidden');
    document.querySelector('#view-game').classList.remove('is-hidden');
  }, { ownerId: owner.id, otherId: game.players[1].id });
  const fixture = await readFile(new URL('./visual-capture/ipad-modal-fixture.browser.js', import.meta.url), 'utf8');
  await page.route('**/qa/sale-fixture.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: fixture }));
  await page.addScriptTag({ url: new URL('/qa/sale-fixture.js', page.url()).href, type: 'module' });
  await page.evaluate(openSaleDeed, game.getGameSummary(owner.id));
  await expect(page.locator('#deed-card-detail').getByText('YOUR CASH', { exact: true })).toHaveCount(0);
  await expect(page.locator('#dd-bank-sale')).toHaveCount(0);
  await expect(page.locator('#dd-trade-deed')).toBeEnabled();
  await expect(page.locator('#dd-trade-deed')).toContainText('SELL DEED');
  await expect(page.locator('#deed-card-detail')).toContainText(/agree on the price/i);
  await expect(page.locator('#deed-card-detail')).not.toContainText(/50%|CONFIRM BANK SALE/);
  await expect(page.locator('#dd-trade-deed')).not.toContainText(/\+\$/);
  const refused = game.manageProperty('sale-host', { tileIndex: 5, action: 'sell-deed', requestId: 'bank-buyback-refused' });
  expect(refused).toMatchObject({ success: false, error: expect.stringMatching(/Bank deed buyback is unavailable/) });
  expect(owner.cash).toBe(startingCash);
  expect(airport.ownerId).toBe(owner.id);
  expect(owner.properties).toContain(5);
  expect(requests).toHaveLength(0);
});
