/* global window, document */
import assert from 'node:assert/strict';
import { test, expect } from '@playwright/test';
import { ROUND_LIMIT } from '../server/gameData.js';
import { createRoom, finishedSnapshot, captureState, openDeedDetail, installFinishedRoom, expectNoPageScroll, captureDeedSurface, expectTradeFitsCard, installClient } from './support/deed-harness.mjs';

const brownTiles = [1, 3];


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
// Captures the deed manager and its detail card under one set of names.
// Gives the owner each listed deed at its purchase price.
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
  await captureDeedSurface(page, testInfo, 'deed-manager-property', 'Even building sales available off turn', 'deed-manager-property.detail.png');
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
  await captureDeedSurface(page, testInfo, 'deed-sell-empty', 'Cleared deed sells through a negotiated player trade', 'deed-sell-empty.detail.png');
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
  await captureDeedSurface(page, testInfo, 'deed-mortgaged', 'Mortgaged airport remains eligible for player trade', 'deed-mortgaged.detail.png');
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
