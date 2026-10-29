/* global window, document */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { RoomManager } from '../server/gameLogic.js';
import { ROUND_LIMIT } from '../server/gameData.js';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

const brownTiles = [1, 3];

function createRoom(prefix, players = 2, settings = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: `${prefix}-host`, clientId: `${prefix}-host-client`, nickname: 'HOST' });
  for (let index = 1; index < players; index += 1) {
    room.addOrReconnectPlayer({ socketId: `${prefix}-guest-${index}`, clientId: `${prefix}-guest-client-${index}`, nickname: `GUEST ${index}` });
  }
  for (const [key, value] of Object.entries(settings)) assert.equal(room.setRoomSetting(key, value).rejected, false);
  assert.equal(room.startGame().success, true);
  return room;
}

function finishedSnapshot(room, viewer) {
  return JSON.parse(JSON.stringify({
    room: room.getRoomSummary(viewer.id),
    game: room.game.getGameSummary(viewer.id),
  }));
}

async function captureState(page, testInfo, surfaceId, label) {
  if (!process.env.POORUP_VISUAL_CAPTURE_DIR) return;
  await captureScreenshot(page, testInfo, { group: 'game', surfaceId, label });
  if (await page.locator('#gameover-modal').isVisible()) {
    const target = path.join(path.resolve(process.env.POORUP_VISUAL_CAPTURE_DIR), testInfo.project.name, 'game', `${surfaceId}.detail.png`);
    await mkdir(path.dirname(target), { recursive: true });
    await page.locator('#gameover-card').screenshot({ path: target, animations: 'disabled' });
  }
}

async function captureDeedDetail(page, testInfo, fileName) {
  const root = process.env.POORUP_VISUAL_CAPTURE_DIR;
  if (!root) return;
  const detailPath = path.join(path.resolve(root), testInfo.project.name, 'game', fileName);
  await mkdir(path.dirname(detailPath), { recursive: true });
  await page.locator('#deed-card-detail').screenshot({ path: detailPath, animations: 'disabled' });
}

async function openDeedDetail(page, index) {
  await page.evaluate(i => window.__deedTruthHarness.deeds.openDeedDetail(i), index);
}

async function sellOneHouse(page, testInfo, game, index, expectedLevel) {
  await page.locator('#dd-sell').click();
  await expect.poll(() => game.getTile(index).houseCount).toBe(expectedLevel);
  if (index === 1 && expectedLevel === 1) {
    await expect(page.locator('#dd-sell')).toBeDisabled();
    await expect(page.locator('#dd-close')).toBeFocused();
    await captureState(page, testInfo, 'deed-sell-one-house', 'Even selling blocks a second sale from the lower street');
  }
  if (expectedLevel === 0 && index === 3) await expect(page.locator('#dd-trade-deed')).toBeFocused();
  await page.locator('#dd-close').click();
}

// A finished room, seen by the given viewer, with the client installed on it.
async function installFinishedRoom(page, room, viewer, propertyBridge = null) {
  await installClient(page, finishedSnapshot(room, viewer), propertyBridge);
}

async function expectNoPageScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
}

async function expectTradeFitsCard(page) {
  const geometry = await page.locator('#trade-card').evaluate(card => {
    const box = card.getBoundingClientRect();
    const body = card.querySelector('.trade-body').getBoundingClientRect();
    return { width: card.clientWidth, scrollWidth: card.scrollWidth,
      bodyLeft: body.left - box.left, bodyRight: body.right - box.right };
  });
  expect(geometry.scrollWidth, 'trade content must fit inside its card horizontally').toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.bodyLeft, 'trade body left edge stays inside the card').toBeGreaterThanOrEqual(0);
  expect(geometry.bodyRight, 'trade body right edge stays inside the card').toBeLessThanOrEqual(0);
}

async function installClient(page, snapshot, propertyBridge = null) {
  await page.goto('/');
  await page.evaluate(async ({ initialSnapshot, usePropertyBridge }) => {
    const [{ state }, sync, modals, deeds, board, popup, hud, rail, topNav, sprites, dom, trades] = await Promise.all([
      import('/clientState.js'), import('/clientStateSync.js'), import('/clientGameModalsUi.js'),
      import('/clientDeedDetailUi.js'), import('/clientBoardRender.js'), import('/clientPopupUi.js'),
      import('/clientHudRender.js'), import('/clientRailRender.js'), import('/clientTopNavRender.js'),
      import('/clientSprites.js'), import('/clientDom.js'), import('/clientTradeUi.js'),
    ]);
    Object.assign(state, { clientId: initialSnapshot.game.players.find(player => player.clientId)?.clientId || '', phase: 'home' });
    document.querySelector('#view-home').classList.add('is-hidden');
    document.querySelector('#view-game').classList.remove('is-hidden');
    board.buildBoard(popup.onTileClick);
    const renderAll = () => {
      board.renderBoardState(); hud.renderHud(); rail.renderRightRail(); topNav.renderTopNav();
      document.querySelector('#player-list').innerHTML = state.players.map((player, index) =>
        `<button class="player-row player-row-action" type="button" data-player-id="${dom.esc(player.serverId || player.id)}"><div class="pr-av">${sprites.avatarHTML(player, 4, index)}</div><div class="pr-mid"><div class="pr-nameline"><span class="pr-name">${dom.esc(player.name)}</span></div><div class="pr-cash">$${Number(player.cash).toLocaleString()}</div></div></button>`,
      ).join('');
      deeds.renderDeedDetail();
    };
    modals.configureGameModals({ renderAll, startGame() {} });
    const actionHooks = {
      async emitServer(event, payload, ack) {
        if (!usePropertyBridge) return;
        const result = await window.__deedTruthAction(event, payload);
        sync.applyServerState(result.snapshot, syncHost);
        ack?.(result.response);
      },
      renderAll,
      createRequestId: () => `truth-trade-${Date.now()}`,
    };
    deeds.configureDeedDetail(actionHooks);
    trades.configureTradeUi(actionHooks);
    const syncHost = {
      setConnectionStatus() {}, gameViewVisible: () => true, showView() {}, renderAll,
      showGameOver: modals.showGameOver,
      placePiecesSoon() {}, startPieceWalk: () => Promise.resolve(),
      retireButton: () => null, bankruptcyHidden: () => true,
      hideBankruptcyModal() {}, openBankruptcyModal() {},
      closeAuctionSurface() {}, openAuctionSurface() {},
      startTurnCountdown() {}, syncOfferSurface() {},
      announceDiceRoll() {}, setBoardVariant() {}, rebuildBoard() {},
    };
    window.__deedTruthHarness = { state, sync, deeds, trades, renderAll, syncHost };
    sync.applyServerState(initialSnapshot, syncHost);
  }, { initialSnapshot: snapshot, usePropertyBridge: Boolean(propertyBridge) });
}

test('real round-limit state reaches game-over UI with authoritative winner and net-worth score', async ({ page }, testInfo) => {
  const room = createRoom('truth-round');
  const game = room.game;
  const [cashLeader, assetLeader] = game.players;
  cashLeader.cash = 1500;
  assetLeader.cash = 1000;
  for (const index of [37, 39]) {
    game.tiles[index].ownerId = assetLeader.id;
    assetLeader.properties.push(index);
    game.tiles[index].houseCount = 4;
  }
  game.roundNumber = ROUND_LIMIT + 1;
  assert.equal(game.endForRoundLimit(), true);
  assert.equal(game.lastEndReason, 'round-limit');
  assert.equal(game.lastWinner.id, assetLeader.id);
  assert.ok(assetLeader.cash < cashLeader.cash, 'the winner must finish with less cash');
  const snapshot = finishedSnapshot(room, assetLeader);
  assert.ok(snapshot.game.players.find(player => player.id === assetLeader.id).finalNetWorth
    > snapshot.game.players.find(player => player.id === cashLeader.id).finalNetWorth);
  assert.equal(snapshot.game.finalPlacements[assetLeader.id], 1);

  await installClient(page, snapshot);
  await expect(page.locator('#gameover-modal')).toBeVisible();
  await expect(page.locator('#gameover-card-title')).toContainText(assetLeader.nickname);
  await expect(page.locator('#go-end-reason')).toContainText('Ranked by net worth');
  await expect(page.locator('#gameover-card')).toContainText('FINAL NET WORTH');
  const rows = page.locator('#gameover-card .go-summary-row');
  await expect(rows.first()).toContainText(assetLeader.nickname);
  const displayedWinnerScore = await page.evaluate(value => `$${value.toLocaleString()}`,
    snapshot.game.players.find(player => player.id === assetLeader.id).finalNetWorth);
  await expect(rows.first()).toContainText('WINNER');
  await expect(rows.first()).not.toContainText(displayedWinnerScore);
  await expect(page.locator('#go-rematch')).toBeDisabled();
  await expect(page.locator('#go-home')).toBeEnabled();
  await expect(page.locator('.go-score-details')).not.toHaveAttribute('open');
  await page.locator('.go-score-details > summary').click();
  await expect(page.locator('.go-final-scores')).toContainText(displayedWinnerScore);
  await page.locator('.go-score-details > summary').click();
  await captureState(page, testInfo, 'release-end-game', 'Round-limit result ranked by actual final net worth');

  await room.startGame();
  const rematch = finishedSnapshot(room, assetLeader);
  expect(rematch.game.finalPlacements).toBeNull();
  expect(rematch.game.players.every(player => player.finalNetWorth === null)).toBe(true);
  await page.evaluate(snapshotAfterRematch => {
    const { state, sync, syncHost } = window.__deedTruthHarness;
    sync.applyServerState(snapshotAfterRematch, syncHost);
    return { gameOver: state.gameOver, finalPlacements: state.finalPlacements, scores: state.players.map(player => player.finalNetWorth) };
  }, rematch);
  const stateAfterRematch = await page.evaluate(() => ({
    gameOver: window.__deedTruthHarness.state.gameOver,
    finalPlacements: window.__deedTruthHarness.state.finalPlacements,
    scores: window.__deedTruthHarness.state.players.map(player => player.finalNetWorth),
  }));
  expect(stateAfterRematch.gameOver).toBeNull();
  expect(stateAfterRematch.finalPlacements).toBeNull();
  expect(stateAfterRematch.scores.every(score => score === null)).toBe(true);
});

test('real Brown-set sales stay even and Sell deed negotiates with a player', async ({ page }, testInfo) => {
  const room = createRoom('truth-deed', 3);
  const game = room.game;
  const [owner, buyer, alternateBuyer] = game.players;
  for (const index of brownTiles) {
    const tile = game.getTile(index);
    tile.ownerId = owner.id;
    owner.properties.push(index);
  }
  owner.cash = 1000;
  for (const index of [1, 3, 1, 3]) {
    assert.equal(game.manageProperty('truth-deed-host', { tileIndex: index, action: 'build-house' }).success, true);
  }
  assert.deepEqual(brownTiles.map(index => game.getTile(index).houseCount), [2, 2]);
  // Selling buildings remains a rescue option on another player's turn.
  game.currentPlayerId = buyer.id;
  const buyerCashBefore = buyer.cash;
  const bridge = (event, payload) => {
    const response = event === 'propose-trade'
      ? game.proposeTrade('truth-deed-host', payload)
      : game.manageProperty('truth-deed-host', payload);
    return { response, snapshot: finishedSnapshot(room, owner) };
  };
  await page.exposeFunction('__deedTruthAction', bridge);
  await installFinishedRoom(page, room, owner, true);
  await openDeedDetail(page, 1);
  await expect(page.locator('#dd-sell')).toBeEnabled();
  await expect(page.locator('#dd-sell')).toContainText('SELL HOUSE');
  await expect(page.locator('#dd-mortgage')).toBeDisabled();
  await captureState(page, testInfo, 'deed-manager-property', 'Even building sales available off turn');
  await captureDeedDetail(page, testInfo, 'deed-manager-property.detail.png');
  for (const [index, expectedLevel] of [[1, 1], [3, 1], [1, 0], [3, 0]]) {
    if (index !== 1 || expectedLevel !== 1) await openDeedDetail(page, index);
    await sellOneHouse(page, testInfo, game, index, expectedLevel);
  }
  expect(owner.cash).toBe(900); // $200 spent, four $25 refunds.
  expect(brownTiles.map(index => game.getTile(index).houseCount)).toEqual([0, 0]);
  await openDeedDetail(page, 1);
  await expect(page.locator('#dd-bank-sale')).toHaveCount(0);
  await expect(page.locator('#dd-trade-deed')).toBeEnabled();
  await expect(page.locator('#dd-mortgage')).toBeEnabled();
  await expect(page.locator('#deed-card-detail')).not.toContainText(/50%|CONFIRM BANK SALE/);
  await captureState(page, testInfo, 'deed-sell-empty', 'Cleared deed sells through a negotiated player trade');
  await captureDeedDetail(page, testInfo, 'deed-sell-empty.detail.png');
  await page.locator('#dd-trade-deed').click();
  await expect(page.locator('#deed-modal')).toBeHidden();
  await expect(page.locator('#trade-modal')).toBeVisible();
  expect(await page.locator('#trade-card').evaluate(card => {
    const bounds = card.getBoundingClientRect();
    return Boolean(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('#trade-card'));
  })).toBe(true);
  await expect(page.locator('[data-side="me"][data-deed="1"]')).toHaveClass(/is-selected/);
  await expect(page.locator('#trade-my-cash')).toHaveValue('0');
  await expect(page.locator('#trade-their-cash')).toHaveValue('0');
  expect(owner.cash).toBe(900);
  // The player can choose a buyer without losing the offered deed.
  await page.locator('#trade-recipient-trigger').click();
  await page.locator('#trade-recipient-menu [data-dropdown-value-option]').filter({ hasText: alternateBuyer.nickname }).click();
  await expect(page.locator('[data-side="me"][data-deed="1"]')).toHaveClass(/is-selected/);
  await page.locator('#trade-recipient-trigger').click();
  await page.locator('#trade-recipient-menu [data-dropdown-value-option]').filter({ hasText: buyer.nickname }).click();
  await page.locator('#trade-their-cash').fill('137');
  await expectTradeFitsCard(page);
  await captureState(page, testInfo, 'deed-sale-player-trade', 'Player chooses the deed sale price');
  await page.locator('#trade-send').click();
  await expect.poll(() => game.pendingTrade?.requestCash).toBe(137);
  const tradeId = game.pendingTrade.id;
  expect(game.getTile(1).ownerId).toBe(owner.id);
  expect(owner.cash).toBe(900);
  expect(game.respondToTrade('truth-deed-guest-1', { tradeId, accept: true })).toMatchObject({ success: true });
  expect(game.getTile(1).ownerId).toBe(buyer.id);
  expect(owner.properties).not.toContain(1);
  expect(buyer.properties).toContain(1);
  expect(owner.cash).toBe(1037);
  expect(buyer.cash).toBe(buyerCashBefore - 137);
  const replayCash = owner.cash;
  expect(game.manageProperty('truth-deed-host', { tileIndex: 3, action: 'sell-deed', requestId: 'stale-bank-sale' }).success).toBe(false);
  expect(game.getTile(3).ownerId).toBe(owner.id);
  expect(owner.cash).toBe(replayCash);
  await expectNoPageScroll(page);
});

test('mortgaged deeds can be offered and requested without clearing their mortgage', async ({ page }, testInfo) => {
  const room = createRoom('truth-mortgaged');
  const game = room.game;
  const [seller, buyer] = game.players;
  const airport = game.getTile(5);
  const utility = game.getTile(12);
  airport.ownerId = seller.id; seller.properties.push(5);
  utility.ownerId = buyer.id; buyer.properties.push(12);
  expect(game.manageProperty('truth-mortgaged-host', { tileIndex: 5, action: 'mortgage' }).success).toBe(true);
  expect(game.manageProperty('truth-mortgaged-guest-1', { tileIndex: 12, action: 'mortgage' }).success).toBe(true);
  const beforeCash = game.players.map(player => player.cash);
  await page.exposeFunction('__deedTruthAction', (event, payload) => ({
    response: event === 'propose-trade' ? game.proposeTrade('truth-mortgaged-host', payload) : game.manageProperty('truth-mortgaged-host', payload),
    snapshot: finishedSnapshot(room, seller),
  }));
  await installFinishedRoom(page, room, seller, true);
  await openDeedDetail(page, 5);
  await expect(page.locator('#dd-trade-deed')).toBeEnabled();
  await captureState(page, testInfo, 'deed-mortgaged', 'Mortgaged airport remains eligible for player trade');
  await captureDeedDetail(page, testInfo, 'deed-mortgaged.detail.png');
  await page.locator('#dd-trade-deed').click();
  await expect(page.locator('#deed-modal')).toBeHidden();
  await expect(page.locator('#trade-modal')).toBeVisible();
  const offered = page.locator('[data-side="me"][data-deed="5"]');
  const requested = page.locator('[data-side="them"][data-deed="12"]');
  await expect(offered).toBeEnabled();
  await expect(requested).toBeEnabled();
  await expect(offered).toContainText('MORTGAGED');
  await expect(requested).toContainText('MORTGAGED');
  expect(await offered.locator('.trade-deed-name').evaluate(name => getComputedStyle(name, '::after').content)).not.toContain('MTG');
  await requested.click();
  await expectTradeFitsCard(page);
  await captureState(page, testInfo, 'trade-mortgaged-deeds', 'Both sides disclose the mortgages being transferred');
  await page.locator('#trade-send').click();
  await expect.poll(() => game.pendingTrade?.requestPropertyIndexes).toEqual([12]);
  const tradeId = game.pendingTrade.id;
  expect(game.respondToTrade('truth-mortgaged-guest-1', { tradeId, accept: true }).success).toBe(true);
  expect(airport.ownerId).toBe(buyer.id);
  expect(utility.ownerId).toBe(seller.id);
  expect(airport.mortgaged).toBe(true);
  expect(utility.mortgaged).toBe(true);
  expect(game.players.map(player => player.cash)).toEqual(beforeCash);
  // Receiving a mortgage never makes it earn rent or silently erases the debt.
  expect(game.calculateRent(airport)).toBe(0);
  expect(game.manageProperty('truth-mortgaged-guest-1', { tileIndex: 5, action: 'unmortgage' }).success).toBe(true);
  expect(buyer.cash).toBe(beforeCash[1] - 110);
  expect(airport.mortgaged).toBe(false);
});

test('the engine ends an ordinary game after both other players leave and the UI explains the result', async ({ page }, testInfo) => {
  const room = createRoom('truth-standing', 3);
  const game = room.game;
  const [winner, bankrupt, retired] = game.players;
  winner.cash = 300;
  bankrupt.cash = 6000;
  retired.cash = 4500;
  expect(game.declareBankruptcy('truth-standing-guest-1')).toMatchObject({ success: true, voluntary: true });
  expect(game.declareBankruptcy('truth-standing-guest-2')).toMatchObject({ success: true, voluntary: true });
  expect(game.started).toBe(false);
  expect(game.lastWinner.id).toBe(winner.id);
  const snapshot = finishedSnapshot(room, winner);
  await installClient(page, snapshot);
  await expect(page.locator('#gameover-modal')).toBeVisible();
  await expect(page.locator('#go-end-reason')).toContainText('Last active player');
  await expect(page.getByText('FINAL CASH', { exact: true })).not.toBeVisible();
  await expect(page.locator('#go-rematch')).toBeEnabled();
  await expect(page.locator('#go-home')).toBeEnabled();
  await expect(page.locator('#gameover-card .go-summary-row').filter({ hasText: 'OUT' })).toHaveCount(2);
  await expect(page.locator('#gameover-card')).not.toContainText('$6,000');
  await captureState(page, testInfo, 'round-over', 'Last-standing results explain elimination without an irrelevant cash comparison');
});

test('every owned deed manager shows its complete rent schedule without expanding details', async ({ page }, testInfo) => {
  const room = createRoom('rent-ladder');
  const game = room.game;
  const owner = game.players[0];
  for (const index of [1, 3, 5, 12, 28]) {
    const tile = game.getTile(index);
    tile.ownerId = owner.id; tile.purchasePricePaid = tile.price; owner.properties.push(index);
  }
  await installFinishedRoom(page, room, owner);
  for (const [index, name, rows] of [[1, 'property', 6], [5, 'airport', 4], [12, 'electric', 2], [28, 'water', 2]]) {
    await openDeedDetail(page, index);
    const ladder = page.locator('#deed-card-detail .dd-ladder');
    await expect(ladder).toBeVisible();
    await expect(ladder.locator('.dd-row')).toHaveCount(rows);
    expect(await ladder.evaluate(element => element.closest('details') === null)).toBe(true);
    await expect(page.locator('.dd-extra-details')).toHaveCount(0);
    await expect(page.locator('#deed-card-detail')).not.toContainText(/HOUSE COST|YOUR CASH|BUILDINGS|Returns half the building cost/);
    await expect(page.locator('.dd-stock-details, .supply-strip')).toHaveCount(0);
    await expect(page.locator('#deed-card-detail')).not.toContainText('Bank stock');
    if (name === 'property') await expect(ladder).toContainText('HOTEL');
    await captureState(page, testInfo, `deed-rent-${name}`, `Visible ${name} rent schedule`);
    await captureDeedDetail(page, testInfo, `deed-rent-${name}.detail.png`);
    await page.locator('#dd-trade-deed').focus();
    await expect(page.locator('#dd-trade-deed')).toBeInViewport();
    await page.locator('#dd-close').click();
    await expectNoPageScroll(page);
  }
});

test('building stays available beyond the old shared supply totals even with legacy zero limits', async ({ page }, testInfo) => {
  const room = createRoom('uncapped-ui', 2, { evenBuild: false });
  const game = room.game;
  const owner = game.players[0];
  for (const tile of game.tiles.filter(entry => entry.type === 'property')) {
    tile.ownerId = owner.id; tile.purchasePricePaid = tile.price; tile.houseCount = 4;
    owner.properties.push(tile.index);
  }
  const target = game.getTile(1);
  target.houseCount = 0;
  game.settings.houseLimit = 0;
  game.settings.hotelLimit = 0;
  owner.cash = 50000;
  expect(game.tiles.reduce((sum, tile) => sum + (tile.houseCount || 0), 0)).toBeGreaterThan(32);
  await page.exposeFunction('__deedTruthAction', (event, payload) => {
    expect(event).toBe('manage-property');
    return { response: game.manageProperty('uncapped-ui-host', payload), snapshot: finishedSnapshot(room, owner) };
  });
  await installFinishedRoom(page, room, owner, true);
  await openDeedDetail(page, 1);
  await expect(page.locator('#dd-buy')).toBeEnabled();
  await expect(page.locator('.dd-stock-details')).toHaveCount(0);
  const cost = game.getPropertyHouseCost(target);
  const cashBefore = owner.cash;
  await page.locator('#dd-buy').click();
  await expect.poll(() => target.houseCount).toBe(1);
  expect(owner.cash).toBe(cashBefore - cost);
  const settings = await page.evaluate(() => window.__deedTruthHarness.state.settings);
  expect(Object.hasOwn(settings, 'houseLimit')).toBe(false);
  expect(Object.hasOwn(settings, 'hotelLimit')).toBe(false);
  await captureState(page, testInfo, 'unlimited-building', 'Building with no shared inventory cap');
  await captureDeedDetail(page, testInfo, 'unlimited-building.detail.png');
});
