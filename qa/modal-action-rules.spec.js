/* global window, document */
import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

async function fixture(page) {
  const source = await readFile(new URL('./visual-capture/ipad-modal-fixture.browser.js', import.meta.url), 'utf8');
  await page.route('**/qa/modal-actions-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    state.players = [{ id: 'p1', serverId: 'visual-host', clientId: state.clientId, name: 'HOST', cash: 1450, color: '#d74438', textColor: '#d74438' }, { id: 'p2', serverId: 'visual-guest', clientId: 'other', name: 'GUEST', cash: 1200, color: '#286ea1', textColor: '#286ea1' }];
    document.querySelector('#view-home').classList.add('is-hidden'); document.querySelector('#view-game').classList.remove('is-hidden');
  });
  await page.addScriptTag({ url: '/qa/modal-actions-fixture.js', type: 'module' }); await page.evaluate(() => window.__installIpadModalCapture());
}
async function shot(page, info, id, label, selector) {
  if (!process.env.POORUP_VISUAL_CAPTURE_DIR) return;
  await captureScreenshot(page, info, { group: 'actions', surfaceId: id, label });
  const file = path.join(process.env.POORUP_VISUAL_CAPTURE_DIR, info.project.name, 'actions', `${id}.detail.png`);
  await mkdir(path.dirname(file), { recursive: true }); await page.locator(selector).screenshot({ path: file, animations: 'disabled' });
}
async function noPageOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
}

test('trade details use consistent roles and the red primary action at the end', async ({ page }, info) => {
  await fixture(page);
  await page.evaluate(() => { const f = window.__ipadModalCapture; f.state.players[0].clientId = f.state.clientId; f.openPendingDeal(); });
  const card = page.locator('#deal-detail-card'), actions = card.locator('[data-deal-action]');
  expect(await actions.evaluateAll(buttons => buttons.map(button => button.dataset.dealAction))).toEqual(['decline', 'negotiate', 'accept']);
  await expect(actions.last()).toHaveClass(/cta-red/); await expect(card.locator('[data-deal-action=back]')).toHaveCount(0);
  await shot(page, info, 'trade-received', 'Received trade: decline, negotiate, accept', '#deal-detail-card');
  await page.evaluate(() => { const f = window.__ipadModalCapture; f.state.pendingTrade = { ...f.pendingTrade, fromPlayerId: 'visual-host', toPlayerId: 'visual-guest' }; f.deal.renderDealDetailsIfOpen(); });
  expect(await actions.evaluateAll(buttons => buttons.map(button => button.dataset.dealAction))).toEqual(['cancel', 'adjust']);
  await expect(actions.last()).toHaveClass(/cta-red/);
  await shot(page, info, 'trade-sent', 'Sent trade: cancel, adjust', '#deal-detail-card');
  await card.locator('#deal-detail-close').click(); await expect(page.locator('#deal-detail-modal')).toBeHidden(); await noPageOverflow(page);
});

test('auction bid increments are equal-weight choices and still submit their amounts', async ({ page }, info) => {
  await fixture(page);
  await page.evaluate(() => { const f = window.__ipadModalCapture; window.__auctionCalls = []; f.auction.configureAuctionUi({ emitServer: (event, payload, ack) => { window.__auctionCalls.push({ event, payload }); ack({ success: true }); }, announceActionStatus: () => {}, captureActionStatusNode: () => null }); f.openAuction(); f.state.auction.deadline = Date.now() + 60000; });
  const card = page.locator('#auction-card'), bids = card.locator('[data-bid]'); await expect(bids).toHaveCount(3);
  expect(await bids.evaluateAll(buttons => buttons.map(button => Number(button.dataset.bid)))).toEqual([1, 20, 100]);
  for (const button of await bids.all()) { await expect(button).toHaveClass(/btn-dark/); await expect(button).not.toHaveClass(/cta-red/); expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(48); }
  await shot(page, info, 'auction-choices', 'Auction bid increments have equal visual weight', '#auction-card');
  await card.locator('[data-bid="20"]').click(); expect(await page.evaluate(() => window.__auctionCalls[0])).toMatchObject({ event: 'auction-bid', payload: { amount: 160 } });
  await page.evaluate(() => window.__ipadModalCapture.closeAuction()); await noPageOverflow(page);
});

test('market order is red and still submits the selected transaction', async ({ page }, info) => {
  await fixture(page);
  await page.evaluate(() => { const f = window.__ipadModalCapture; window.__marketCalls = []; f.market.configureMarketUi({ emitServer: (event, payload, ack) => { window.__marketCalls.push({ event, payload }); ack({ success: false, error: 'Review fixture' }); }, createRequestId: () => 'market-check', announceActionStatus: () => {}, captureActionStatusNode: () => null, renderRightRail: () => {}, renderChat: () => {}, recordActivity: () => {} }); f.openMarket(); });
  const card = page.locator('#market-card'), order = card.locator('#market-order-submit');
  if (await card.locator('#market-view-trade').isVisible()) await card.locator('#market-view-trade').click();
  await order.scrollIntoViewIfNeeded(); await expect(order).toBeEnabled(); await expect(order).toHaveClass(/cta-red/);
  await shot(page, info, 'market-order', 'Market order uses the primary action', '#market-card');
  await order.click(); expect(await page.evaluate(() => window.__marketCalls[0].event)).toBe('market-order');
  await page.evaluate(() => window.__ipadModalCapture.closeMarket()); await noPageOverflow(page);
});

test('funding places its secondary action before the red purchase action', async ({ page }, info) => {
  await fixture(page); await page.evaluate(() => window.__ipadModalCapture.openFundingActive());
  const card = page.locator('#sponsorship-card'), actions = card.locator('[data-sponsorship-action]');
  expect(await actions.evaluateAll(buttons => buttons.map(button => button.dataset.sponsorshipAction))).toEqual(['decline', 'accept']);
  await expect(actions.last()).toHaveClass(/cta-red/); await expect(actions.last()).toBeEnabled();
  await shot(page, info, 'funding-actions', 'Cancel Request precedes Accept & Buy', '#sponsorship-card');
  await page.evaluate(() => window.__ipadModalCapture.closeFunding()); await noPageOverflow(page);
});

test('achievement detail closes with a neutral action', async ({ page }, info) => {
  await fixture(page); await page.evaluate(() => window.__ipadModalCapture.openAchievement());
  const card = page.locator('#achievement-detail-card'), close = card.locator('#achievement-detail-close');
  await expect(close).toHaveClass(/btn-dark/); await expect(close).not.toHaveClass(/cta-red/); await expect(close).toBeFocused();
  await shot(page, info, 'achievement-close', 'Close-only information uses a neutral action', '#achievement-detail-card');
  await close.click(); await expect(page.locator('#achievement-modal')).toBeHidden(); await noPageOverflow(page);
});

test('desktop 200% equivalent keeps the finance-off controls reachable', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1920x1080', 'One desktop zoom-equivalent viewport is sufficient');
  await page.setViewportSize({ width: 960, height: 540 }); await fixture(page);
  await page.evaluate(() => { const f = window.__ipadModalCapture, s = f.state; s.players[0].clientId = s.clientId; s.settings.playerFinance = false; s.playerContractOffer = { id: 'zoom-offer', kind: 'loan', rulesVersion: 2, fromPlayerId: 'visual-guest', toPlayerId: 'visual-host', amount: 100, durationRounds: 3 }; f.deal.openDealDetails('contract', 'zoom-offer'); });
  const card = page.locator('#deal-detail-card'), decline = card.locator('[data-deal-action=decline]');
  await expect(card.locator('[data-deal-action=accept]')).toBeDisabled(); await expect(card.locator('[data-deal-action=negotiate]')).toBeDisabled();
  await decline.scrollIntoViewIfNeeded(); await decline.focus(); await expect(decline).toBeFocused(); await expect(decline).toBeInViewport();
  await noPageOverflow(page);
});

test('purchase choice offers BUY as its one red action beside PASS, with an X that keeps the decision pending', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => window.__ipadModalCapture.openChoice());
  const card = page.locator('#choice-card'), buy = card.locator('#choice-buy'), pass = card.locator('#choice-pass');
  await expect(buy).toBeVisible(); await expect(buy).toBeEnabled(); await expect(buy).toHaveClass(/cta-red/); await expect(buy).toContainText('BUY');
  await expect(pass).toBeVisible(); await expect(pass).not.toHaveClass(/cta-red/);
  await expect(card.locator('.cta-red')).toHaveCount(1);
  await expect(card.locator('#choice-dismiss')).toBeVisible();
  await noPageOverflow(page);
});
