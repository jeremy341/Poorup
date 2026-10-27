/* global window, document */
import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { RoomManager } from '../server/gameLogic.js';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

async function fixture(page) {
  const source = await readFile(new URL('./visual-capture/ipad-modal-fixture.browser.js', import.meta.url), 'utf8');
  await page.route('**/qa/items-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    state.players = [{ id: 'p1', serverId: 'visual-host', clientId: state.clientId, name: 'HOST', cash: 1500, color: '#d74438', textColor: '#d74438' }, { id: 'p2', serverId: 'visual-guest', clientId: 'other', name: 'GUEST', cash: 1200, color: '#286ea1', textColor: '#286ea1' }];
    document.querySelector('#view-home').classList.add('is-hidden'); document.querySelector('#view-game').classList.remove('is-hidden');
  });
  await page.addScriptTag({ url: '/qa/items-fixture.js', type: 'module' });
  await page.evaluate(() => window.__installIpadModalCapture());
}
async function shot(page, info, id, label, selector) {
  if (!process.env.POORUP_VISUAL_CAPTURE_DIR) return;
  await captureScreenshot(page, info, { group: 'items', surfaceId: id, label });
  const file = path.join(process.env.POORUP_VISUAL_CAPTURE_DIR, info.project.name, 'items', `${id}.detail.png`);
  await mkdir(path.dirname(file), { recursive: true }); await page.locator(selector).screenshot({ path: file, animations: 'disabled' });
}
async function noPageOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
}

test('a host can enable item rewards independently and preserve the choice between presets', async ({ page }, info) => {
  await page.goto('/'); await page.locator('#home-alias').fill('ITEMHOST');
  await page.locator('#open-create-btn').click(); await page.locator('#rc-vis-selector [data-vis=private]').click(); const code = ('I' + Math.random().toString(36).slice(2, 7)).toUpperCase();
  await page.locator('#rc-room-code').fill(code); await page.locator('#rc-create-btn').click(); await page.locator('#su-start').click();
  const profile = page.locator('[data-setting=rulesProfile]'), toggle = page.locator('[data-setting=itemRewards]');
  await expect(profile).toHaveValue('standard'); await expect(toggle).toBeEnabled(); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await profile.selectOption('advanced'); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await profile.selectOption('standard'); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await shot(page, info, 'item-setting', 'Item rewards can be independently enabled', '#right-rail-lobby'); await noPageOverflow(page);
});

test('real catalog items show their value and exercise server-owned effects', async ({ page }, info) => {
  const manager = new RoomManager(), room = manager.createRoom({ socketId: 'ui-host', clientId: 'ui-host', nickname: 'HOST' });
  room.addOrReconnectPlayer({ socketId: 'ui-guest', clientId: 'ui-guest', nickname: 'GUEST' });
  room.setRoomSetting('itemRewards', true); expect(room.startGame().success).toBe(true);
  const game = room.game, owner = game.players[0]; game.currentPlayerId = owner.id; game.roundNumber = 5; owner.inJail = true;
  game.applyCard(owner, { action: 'jailFree' });
  game.applyCard(owner, { action: 'itemReward', catalogId: 'parlor-bond', itemName: 'a Parlor Bond' });
  game.applyCard(owner, { action: 'itemReward', catalogId: 'silver-keepsake', itemName: 'a Silver Keepsake' });
  const initialCash = owner.cash, initialItems = game.summaryItems(owner, owner.id);
  expect(initialItems).toHaveLength(3); expect(new Set(initialItems.map(item => item.itemId)).size).toBe(3);
  await page.exposeFunction('__itemAction', ({ event, payload }) => {
    const result = game[event === 'use-item' ? 'useItem' : 'sellItem']('ui-host', payload);
    return { result, items: game.summaryItems(owner, owner.id), cash: owner.cash };
  });
  await fixture(page);
  await page.evaluate(({ items, ownerId, round }) => {
    const f = window.__ipadModalCapture; f.state.players[0].serverId = ownerId; f.state.players[0].clientId = f.state.clientId;
    f.state.players[0].items = items; f.state.settings.itemRewards = true; f.state.roundNumber = round;
    let seq = 0;
    f.wallet.configureWalletUi({ emitServer: (event, payload, ack) => window.__itemAction({ event, payload }).then(({ result, items, cash }) => { f.state.players[0].items = items; f.state.players[0].cash = cash; ack(result); }), createRequestId: () => `ui-item-${++seq}`, refreshWalletSnapshot: () => {}, renderRightRail: () => {}, renderHud: () => {} });
    f.openWallet('items');
  }, { items: initialItems, ownerId: owner.id, round: game.roundNumber });
  const card = page.locator('#wallet-card');
  for (const [name, value] of [['PRISON KEY', '$25'], ['PARLOR BOND', '$50'], ['SILVER KEEPSAKE', '$75']]) {
    const row = card.locator('.wallet-item-row').filter({ hasText: name }); await expect(row).toContainText(value);
  }
  await expect(card.locator('.wallet-item-row')).toHaveCount(3); await expect(card).not.toContainText(/REWARD \d+/);
  const asset = await page.evaluate(async () => { const response = await fetch('/assets/item-icons.svg'); return { ok: response.ok, text: await response.text() }; });
  expect(asset.ok).toBe(true);
  for (const id of ['prison-key', 'parlor-bond', 'silver-keepsake']) {
    expect(asset.text).toContain(`id="${id}"`);
    const glyph = card.locator(`.wallet-item-row:has(use[href$="#${id}"]) .holding-item-glyph`);
    const svg = glyph.locator('svg'); await expect(svg).toBeVisible();
    const frame = await glyph.boundingBox(), icon = await svg.boundingBox();
    expect(icon.x).toBeGreaterThanOrEqual(frame.x - 1); expect(icon.y).toBeGreaterThanOrEqual(frame.y - 1);
    expect(icon.x + icon.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
    expect(icon.y + icon.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
  }
  await expect(card.locator('[data-wallet-item-action=trade], [data-wallet-item-action=exchange]')).toHaveCount(0);
  const bondRow = card.locator('.wallet-item-row').filter({ hasText: 'PARLOR BOND' });
  await expect(bondRow.locator('[data-wallet-item-action=use]')).toBeDisabled(); await expect(bondRow).toContainText('ROUND 7');
  await shot(page, info, 'real-items', 'Three real item types with server-owned values', '#wallet-card');
  await bondRow.locator('[data-wallet-item-select]').click(); await expect(card.locator('.wallet-item-detail')).toContainText('$100');
  await shot(page, info, 'bond-details', 'Bond value, maturity and details', '#wallet-card');
  await card.locator('.wallet-item-row').filter({ hasText: 'SILVER KEEPSAKE' }).locator('[data-wallet-item-action=sell]').click();
  await expect.poll(() => owner.cash).toBe(initialCash + 75); await expect(card.locator('.wallet-item-row')).toHaveCount(2);
  await card.locator('.wallet-item-row').filter({ hasText: 'PRISON KEY' }).locator('[data-wallet-item-action=use]').click();
  await expect.poll(() => owner.inJail).toBe(false); await expect(card.locator('.wallet-item-row')).toHaveCount(1);
  game.roundNumber = 7; const readyItems = game.summaryItems(owner, owner.id);
  await page.evaluate(items => { const f = window.__ipadModalCapture; f.state.players[0].items = items; f.state.roundNumber = 7; f.wallet.renderWalletModalIfOpen(); }, readyItems);
  await expect(card.locator('[data-wallet-item-action=use]')).toBeEnabled();
  await shot(page, info, 'bond-mature', 'Mature bond with its redeem and sell choices', '#wallet-card');
  await card.locator('[data-wallet-item-action=use]').click(); await expect.poll(() => owner.cash).toBe(initialCash + 175);
  await expect(card).toContainText('NO ITEMS THIS ROUND'); await noPageOverflow(page);
});

test('a long real inventory remains scrollable and keyboard reachable', async ({ page }, info) => {
  const manager = new RoomManager(), room = manager.createRoom({ socketId: 'scroll-host', clientId: 'scroll-host', nickname: 'HOST' });
  room.addOrReconnectPlayer({ socketId: 'scroll-guest', clientId: 'scroll-guest', nickname: 'GUEST' });
  room.setRoomSetting('itemRewards', true); expect(room.startGame().success).toBe(true);
  const game = room.game, owner = game.players[0]; game.currentPlayerId = owner.id; game.roundNumber = 5;
  for (let n = 0; n < 12; n++) game.applyCard(owner, { action: 'itemReward', catalogId: n % 2 ? 'parlor-bond' : 'silver-keepsake' });
  const items = game.summaryItems(owner, owner.id); expect(new Set(items.map(item => item.itemId)).size).toBe(12);
  await fixture(page); await page.evaluate(items => { const f = window.__ipadModalCapture; f.state.players[0].items = items; f.state.roundNumber = 5; f.openWallet('items'); }, items);
  const card = page.locator('#wallet-card'), rows = card.locator('.wallet-item-row'); await expect(rows).toHaveCount(12);
  await expect(card).not.toContainText(/REWARD \d+/);
  const last = rows.last().locator('[data-wallet-item-select]'); await last.focus(); await last.scrollIntoViewIfNeeded(); await expect(last).toBeFocused(); await expect(last).toBeInViewport();
  await shot(page, info, 'real-items-scroll', 'Real catalog items remain accessible in a long inventory', '#wallet-card'); await noPageOverflow(page);
});

test('an owner can sell an item during another player’s turn', async ({ page }, info) => {
  const manager = new RoomManager(), room = manager.createRoom({ socketId: 'seller', clientId: 'seller', nickname: 'HOST' });
  room.addOrReconnectPlayer({ socketId: 'other', clientId: 'other', nickname: 'GUEST' }); room.setRoomSetting('itemRewards', true);
  expect(room.startGame().success).toBe(true);
  const game = room.game, owner = game.players[0], other = game.players[1]; game.currentPlayerId = other.id;
  game.applyCard(owner, { action: 'itemReward', catalogId: 'silver-keepsake' });
  const before = owner.cash, items = game.summaryItems(owner, owner.id); expect(items[0].canSell).toBe(true);
  await page.exposeFunction('__offturnSale', ({ itemId, requestId }) => {
    const result = game.sellItem('seller', { itemId, requestId });
    return { result, items: game.summaryItems(owner, owner.id), cash: owner.cash };
  });
  await fixture(page);
  await page.evaluate(({ items, ownerId }) => {
    const f = window.__ipadModalCapture; f.state.players[0].serverId = ownerId; f.state.players[0].clientId = f.state.clientId; f.state.players[0].items = items;
    f.wallet.configureWalletUi({ emitServer: (_event, payload, ack) => window.__offturnSale(payload).then(({ result, items, cash }) => { f.state.players[0].items = items; f.state.players[0].cash = cash; ack(result); }), createRequestId: () => 'offturn-ui-sale', refreshWalletSnapshot: () => {}, renderRightRail: () => {}, renderHud: () => {} });
    f.openWallet('items');
  }, { items, ownerId: owner.id });
  const sell = page.locator('#wallet-card [data-wallet-item-action=sell]'); await expect(sell).toBeEnabled(); await expect(sell).toContainText('$75');
  await shot(page, info, 'offturn-sale', 'Selling an item during another player’s turn', '#wallet-card');
  await sell.click(); await expect.poll(() => owner.cash).toBe(before + 75); await expect(page.locator('#wallet-card')).toContainText('NO ITEMS THIS ROUND');
  await noPageOverflow(page);
});

test('an older loan can be negotiated into a current offer without moving cash before acceptance', async ({ page }, info) => {
  const manager = new RoomManager(), room = manager.createRoom({ socketId: 'borrower', clientId: 'borrower', nickname: 'HOST', rulesProfile: 'advanced' });
  room.addOrReconnectPlayer({ socketId: 'lender', clientId: 'lender', nickname: 'GUEST' }); expect(room.startGame().success).toBe(true);
  const game = room.game, borrower = game.players[0], lender = game.players[1]; game.currentPlayerId = lender.id;
  const proposed = game.proposePlayerContract('lender', { toPlayerId: borrower.id, kind: 'loan', amount: 100, premiumRate: 15, durationRounds: 3 });
  expect(proposed.success).toBe(true); const legacy = proposed.contract; delete legacy.rulesVersion;
  const originalId = legacy.id, before = [borrower.cash, lender.cash];
  await page.exposeFunction('__legacyCounter', payload => game.counterPlayerContract('borrower', payload));
  await fixture(page);
  await page.evaluate(({ legacy, borrowerId, lenderId }) => {
    const f = window.__ipadModalCapture, s = f.state; s.players[0].clientId = s.clientId; s.players[0].serverId = borrowerId; s.players[1].serverId = lenderId;
    s.playerContractOffer = { ...legacy, fromPlayerName: 'GUEST', toPlayerName: 'HOST' };
    f.deal.configureDealUi({ openFinancingNegotiation: (id, trigger) => f.trade.openFinancingNegotiation(id, trigger) });
    f.trade.configureTradeUi({ emitServer: (_event, payload, ack) => window.__legacyCounter(payload).then(ack), createRequestId: () => 'legacy-ui-counter', renderRightRail: () => {} });
    f.deal.openDealDetails('contract', legacy.id);
  }, { legacy, borrowerId: borrower.id, lenderId: lender.id });
  const card = page.locator('#deal-detail-card'); await expect(card).toContainText('earlier rules');
  await expect(card.locator('[data-deal-action=back]')).toBeVisible(); await expect(card.locator('[data-deal-action=decline]')).toBeVisible();
  const negotiate = card.locator('[data-deal-action=negotiate]'); await expect(negotiate).toBeVisible(); await expect(negotiate).toHaveClass(/cta-red/);
  await expect(card.locator('[data-deal-action=accept]')).toHaveCount(0);
  await shot(page, info, 'legacy-negotiate', 'Older loan with a red Negotiate action', '#deal-detail-card');
  await card.locator('[data-deal-action=back]').click(); await expect(page.locator('#deal-detail-modal')).toBeHidden();
  expect(game.pendingPlayerContract.id).toBe(originalId);
  await page.evaluate(id => window.__ipadModalCapture.deal.openDealDetails('contract', id), originalId);
  await card.locator('[data-deal-action=negotiate]').click(); await expect(page.locator('#financing-modal')).toBeVisible();
  await page.locator('#negotiation-amount').fill('120'); await page.locator('#financing-negotiate-send').click();
  await expect.poll(() => game.pendingPlayerContract?.rulesVersion).toBe(2);
  const revised = game.pendingPlayerContract; expect(revised.id).not.toBe(originalId); expect(revised.amount).toBe(120);
  expect([borrower.cash, lender.cash]).toEqual(before);
  expect(game.respondPlayerContract('borrower', true, 'self-accept', revised.id).success).toBe(false);
  expect(game.respondPlayerContract('lender', true, 'other-accept', revised.id).success).toBe(true);
  expect([borrower.cash, lender.cash]).toEqual([before[0] + 120, before[1] - 120]); await noPageOverflow(page);
});

test('an offer with Player Finance disabled keeps Back and a red Decline', async ({ page }, info) => {
  await fixture(page);
  await page.evaluate(() => { const f = window.__ipadModalCapture, s = f.state; s.players[0].clientId = s.clientId; s.settings.playerFinance = false; s.playerContractOffer = { id: 'disabled-offer', kind: 'loan', rulesVersion: 2, status: 'pending', fromPlayerId: 'visual-guest', toPlayerId: 'visual-host', fromPlayerName: 'GUEST', toPlayerName: 'HOST', amount: 100, premiumRate: 15, durationRounds: 3 }; f.deal.openDealDetails('contract', 'disabled-offer'); });
  const card = page.locator('#deal-detail-card'); await expect(card.locator('[data-deal-action=back]')).toBeVisible();
  await expect(card.locator('[data-deal-action=decline]')).toHaveClass(/cta-red/); await expect(card.locator('[data-deal-action=negotiate]')).toHaveCount(0);
  await shot(page, info, 'offer-disabled', 'Finance-off offer has a red Decline action', '#deal-detail-card');
  await card.locator('[data-deal-action=back]').click(); await expect(page.locator('#deal-detail-modal')).toBeHidden(); await noPageOverflow(page);
});
