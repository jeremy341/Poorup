import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { runBotTurn } from './botLogic.js';

function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'lender', clientId: 'lender', nickname: 'Lender', rulesProfile: 'advanced', rulesetOverrides: [{ key: 'bankLoans', value: true }, { key: 'itemRewards', value: true }] });
  room.addOrReconnectPlayer({ socketId: 'borrower', clientId: 'borrower', nickname: 'Borrower' });
  room.addOrReconnectPlayer({ socketId: 'other', clientId: 'other', nickname: 'Other' });
  assert.equal(room.startGame().success, true);
  const game = room.game, [lender, borrower, other] = game.players;
  game.currentPlayerId = borrower.id;
  return { manager, room, game, lender, borrower, other };
}

for (const route of ['bankruptcy', 'removeSeat']) {
  test(`${route} retains item IDs and values on failed collateral settlement, then settles once on retry`, () => {
    const { manager, game, lender, borrower, other } = fixture();
    for (const index of [1, 3]) { game.getTile(index).ownerId = borrower.id; borrower.properties.push(index); }
    assert.equal(game.proposePlayerContract('lender', { toPlayerId: borrower.id, kind: 'loan', amount: 300, durationRounds: 3, collateralTileIndices: [1, 3] }).success, true);
    assert.equal(game.respondPlayerContract('borrower', true).success, true);
    borrower.cash = 0;
    game.grantItem(borrower, 'parlor-bond', 'treasure');
    game.grantItem(borrower, 'silver-keepsake', 'surprise');
    game.grantItem(borrower, 'prison-key', 'surprise');
    borrower.jailFreeOrigins = ['surprise'];
    game.roundNumber += 2;
    const before = structuredClone({ items: borrower.items, origins: borrower.jailFreeOrigins, cash: borrower.cash, lenderCash: lender.cash, otherCash: other.cash });
    game.pendingPayment = { playerId: borrower.id, creditorId: other.id, amountRemaining: 20 };
    const transfer = game.applyPropertyOwnershipChange.bind(game);
    let fail = true;
    game.applyPropertyOwnershipChange = (...args) => { transfer(...args); if (fail) { fail = false; throw new Error('one-time transfer failure'); } };
    const exit = () => route === 'bankruptcy' ? game.handleBankruptcy(borrower, other) : manager.releaseSeat(game, borrower);
    assert.equal(exit().retryable, true);
    assert.deepEqual({ items: borrower.items, origins: borrower.jailFreeOrigins, cash: borrower.cash, lenderCash: lender.cash, otherCash: other.cash }, before);
    assert.equal(game.players.includes(borrower), true);
    assert.equal(exit().success, true);
    assert.deepEqual(borrower.items, []);
    assert.deepEqual(borrower.jailFreeOrigins, []);
    assert.equal(borrower.jailFreeCards, 0);
    assert.equal(other.cash, before.otherCash + 1425);
    assert.equal(game.liquidateItems(borrower), 0);
    assert.equal(other.cash, before.otherCash + 1425);
  });
}

test('item is consumed and request recorded before a debt hook can reenter its sale', () => {
  const { game, borrower, other } = fixture();
  const item = game.grantItem(borrower, 'silver-keepsake', 'surprise');
  borrower.cash = 0;
  let repeated;
  game.chargePlayer({ player: borrower, creditor: other, amount: 60, hooks: { onPaid() { repeated = game.sellItem('borrower', { itemId: item.itemId, requestId: 'atomic-sale' }); } } });
  const before = other.cash;
  assert.equal(game.sellItem('borrower', { itemId: item.itemId, requestId: 'atomic-sale' }).cashReceived, 600);
  assert.equal(repeated.duplicate, true);
  assert.equal(borrower.cash, 540);
  assert.equal(other.cash, before + 60);
  assert.equal(borrower.items.length, 0);
});

test('earned items remain redeemable after a trusted restored flag change and reconnect retains IDs', () => {
  const { manager, room, game, borrower } = fixture();
  const bond = game.grantItem(borrower, 'parlor-bond', 'treasure');
  game.settings.itemRewards = false;
  game.roundNumber = bond.maturesRound;
  borrower.disconnected = true;
  const restored = manager.restoreConnection(borrower.clientId, 'new-borrower-socket');
  assert.equal(restored, room);
  assert.equal(game.summaryItems(borrower, borrower.id)[0].itemId, bond.itemId);
  assert.equal(game.useItem('borrower', { itemId: bond.itemId, requestId: 'stale' }).success, false);
  assert.equal(game.useItem('new-borrower-socket', { itemId: bond.itemId, requestId: 'new' }).cashReceived, 800);
});

test('normal bot phase redeems a mature bond through the real item action before rolling', async () => {
  const { room, game, borrower } = fixture();
  borrower.isBot = true;
  const item = game.grantItem(borrower, 'parlor-bond', 'treasure');
  game.roundNumber = item.maturesRound;
  const before = borrower.cash;
  const result = await runBotTurn(room, borrower, null);
  assert.equal(result.cashReceived, 800);
  assert.equal(borrower.cash, before + 800);
  assert.equal(game.hasRolled, false);
  assert.equal(borrower.items.length, 0);
});
