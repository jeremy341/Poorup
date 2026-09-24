// Follow-ups to the UI+logic audit for GameState debt/contract paths:
// lender-gone hybrid conversion, borrower liveness at accept, remainder
// hook replay, end-turn/end-game obligation coverage, bankrupt creditors.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function startedRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  game.currentPlayerId = game.players[0].id;
  return { room, game, a: game.players[0], b: game.players[1] };
}

function hybridAccepted() {
  const ctx = startedRoom();
  const property = ctx.game.getTile(1);
  property.ownerId = ctx.b.id;
  ctx.b.properties.push(1);
  const result = ctx.game.proposePlayerContract('socket-a', {
    toPlayerId: ctx.b.id, kind: 'hybrid', amount: 100, premiumRate: 10,
    durationRounds: 2, propertyIndex: 1, conversionShare: 30
  });
  assert.equal(result.success, true);
  assert.equal(ctx.game.respondPlayerContract('socket-b', true).success, true);
  return { ...ctx, property, contract: ctx.game.playerContracts[0] };
}

check('hybrid conversion with lender gone falls back to loan default', () => {
  const { game, contract, property } = hybridAccepted();
  game.removePlayerByClient('client-a');
  game.roundNumber = contract.dueRound;
  game.processPlayerContracts();
  assert.equal(contract.status, 'due');
  game.roundNumber = contract.cureRound + 1;
  game.processPlayerContracts();
  assert.equal(contract.status, 'defaulted');
  assert.deepEqual(property.equityShares || [], []);
});

check('bankrupt hybrid borrower defaults the funded loan leg', () => {
  const { game, b, contract } = hybridAccepted();
  b.bankrupt = true;
  game.settleContractsOnBankruptcy(b);
  assert.equal(contract.status, 'defaulted');
});

check('accept rejects a bankrupt borrower and clears pending', () => {
  const { game, b } = startedRoom();
  const result = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 50 });
  assert.equal(result.success, true);
  b.bankrupt = true;
  assert.deepEqual(game.respondPlayerContract('socket-b', true), { success: false, error: 'The contract can no longer be accepted.' });
  assert.equal(game.pendingPlayerContract, null);
});

check('accept rejects a disconnected borrower and clears pending', () => {
  const { game, b } = startedRoom();
  assert.equal(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 50 }).success, true);
  b.disconnected = true;
  assert.deepEqual(game.respondPlayerContract('socket-b', true), { success: false, error: 'The contract can no longer be accepted.' });
  assert.equal(game.pendingPlayerContract, null);
});

check('contract counter is allowed during pendingPayment as a debt-rescue path', () => {
  const { game, b } = startedRoom();
  const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 50 });
  assert.equal(first.success, true);
  game.pendingPayment = { playerId: b.id, creditorId: null, amountRemaining: 100, reason: 'rent' };
  const counter = game.counterPlayerContract('socket-b', { contractId: first.contract.id, amount: 60 });
  assert.equal(counter.success, true);
  assert.equal(counter.countered, true);
  assert.equal(counter.contract.amount, 60);
  assert.equal(game.pendingPlayerContract.id, counter.contract.id);
});

check('contract counters respect competing table obligations', () => {
  const fields = ['auction', 'pendingPurchaseOffer', 'pendingSponsoredPurchase', 'pendingTrade'];
  fields.forEach(field => {
    const { game, b } = startedRoom();
    const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 50 });
    assert.equal(first.success, true);
    game[field] = {};
    const counter = game.counterPlayerContract('socket-b', { contractId: first.contract.id, amount: 60 });
    assert.deepEqual(counter, { success: false, error: 'Resolve the current table obligation first.' }, field);
    assert.equal(game.pendingPlayerContract.id, first.contract.id);
  });
});

check('remainder settlement replays non-equity hooks once', () => {
  const { game, b } = startedRoom();
  const seen = [];
  b.cash = 30;
  game.chargePlayer({ player: b, creditor: null, amount: 100, message: 'tax', turnOptions: {}, hooks: { onPaid: (paid) => seen.push(paid) } });
  assert.deepEqual(seen, [30]);
  assert.equal(game.pendingPayment.amountRemaining, 70);
  b.cash = 70;
  assert.equal(game.trySettlePendingPayment(), true);
  assert.deepEqual(seen, [30, 70]);
  assert.equal(game.pendingPaymentHooks, null);
});

check('remainder settlement skips the generic hook for equity debts', () => {
  const { game, b } = startedRoom();
  const property = game.getTile(1);
  property.ownerId = b.id;
  const seen = [];
  b.cash = 0;
  game.chargePlayer({
    player: b, creditor: null, amount: 100, message: 'rent', turnOptions: {},
    hooks: { onPaid: (paid) => seen.push(paid), equityTileIndex: 1, equityOwnerId: b.id }
  });
  b.cash = 100;
  assert.equal(game.trySettlePendingPayment(), true);
  assert.deepEqual(seen, []);
});

check('end turn blocked on involving trade or contract only', () => {
  const { game, a, b } = startedRoom();
  game.awaitingEndTurn = true;
  game.pendingTrade = { fromPlayerId: a.id, toPlayerId: b.id };
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Resolve the pending trade before ending the turn.' });
  game.pendingTrade = null;
  game.pendingPlayerContract = { fromPlayerId: b.id, toPlayerId: a.id };
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Resolve the pending contract before ending the turn.' });
  game.pendingPlayerContract = { fromPlayerId: 'x', toPlayerId: 'y' };
  assert.equal(game.endTurnRejection(a), null);
});

check('end turn cannot silently cancel an open sponsorship', () => {
  const { game, a } = startedRoom();
  game.awaitingEndTurn = true;
  game.pendingSponsoredPurchase = { buyerId: a.id, contributions: [] };
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Resolve the open sponsorship before ending the turn.' });
});

check('a zero-cash solvent player cannot end the turn without declaring bankruptcy', () => {
  const { game, a } = startedRoom();
  game.currentPlayerId = a.id;
  game.awaitingEndTurn = true;
  a.cash = 0;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Raise cash or declare bankruptcy before ending the turn.' });
  a.cash = 1;
  assert.equal(game.endTurnRejection(a), null);
  a.cash = 0;
  a.bankrupt = true;
  a.spectating = true;
  assert.equal(game.endTurnRejection(a), null);
});

check('end-turn rejection guard order preserves debt and insolvency behavior', () => {
  const { game, a, b } = startedRoom();
  game.currentPlayerId = a.id;
  game.extraRollPending = true;
  game.turnAllowsExtraRoll = true;
  game.awaitingEndTurn = false;
  game.auction = { active: true };
  game.pendingPurchaseOffer = { playerId: a.id };
  game.pendingPayment = { playerId: a.id, amountRemaining: 100 };
  game.pendingSponsoredPurchase = { buyerId: a.id };
  game.pendingTrade = { fromPlayerId: a.id, toPlayerId: b.id };
  game.pendingPlayerContract = { fromPlayerId: a.id, toPlayerId: b.id };
  a.cash = 0;

  assert.deepEqual(game.endTurnRejection(b), { success: false, error: 'Only the active player can end the turn.' });
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'You must roll again after doubles before ending your turn.' });

  game.extraRollPending = false;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'You must roll again after doubles before ending your turn.' });

  game.turnAllowsExtraRoll = false;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Resolve your roll before ending the turn.' });

  game.awaitingEndTurn = true;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Finish the active auction before ending the turn.' });
  game.auction.active = false;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Resolve the property offer before ending the turn.' });
  game.pendingPurchaseOffer = null;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Settle your debt before ending the turn.' });
  game.pendingPayment = null;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Resolve the open sponsorship before ending the turn.' });
  game.pendingSponsoredPurchase = null;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Resolve the pending trade before ending the turn.' });
  game.pendingTrade = null;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Resolve the pending contract before ending the turn.' });
  game.pendingPlayerContract = null;
  assert.deepEqual(game.endTurnRejection(a), { success: false, error: 'Raise cash or declare bankruptcy before ending the turn.' });

  a.bankrupt = true;
  a.spectating = true;
  assert.equal(game.endTurnRejection(a), null);
});

check('endGame clears contract and payment obligations', () => {
  const { game, a } = startedRoom();
  game.pendingPlayerContract = { id: 'x' };
  game.pendingPayment = { playerId: a.id, creditorId: null, amountRemaining: 10, reason: 'r' };
  game.endGame();
  assert.equal(game.pendingPlayerContract, null);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.pendingPaymentHooks, null);
});

check('bankrupt creditors are not enriched', () => {
  const { game, a, b } = startedRoom();
  const cashA = a.cash;
  const cashB = b.cash;
  a.bankrupt = true;
  game.creditRentTo(a, b, 100);
  assert.equal(a.cash, cashA);
  assert.equal(b.cash, cashB);
});

check('bankruptcy cash sweep returns cash to the bank when its creditor is bankrupt', () => {
  const { game, a, b } = startedRoom();
  a.bankrupt = true;
  b.cash = 100;
  game.sweepCashToCreditor(b, a);
  assert.equal(a.cash, 1500);
  assert.equal(b.cash, 0);
});

check('bankrupt human seats remain as spectators while bankrupt bots do not', () => {
  const { game, a } = startedRoom();
  game.markPlayerBankrupt(a);
  assert.equal(a.bankrupt, true);
  assert.equal(a.spectating, true);

  const bot = { id: 'bot-seat', isBot: true, bankrupt: false, inDebt: true };
  game.markPlayerBankrupt(bot);
  assert.equal(bot.bankrupt, true);
  assert.equal(bot.spectating, false);
  assert.equal(bot.inDebt, false);
});

check('game summary exposes authoritative spectator status for eliminated humans', () => {
  const { game, a } = startedRoom();
  game.markPlayerBankrupt(a);
  const summary = game.getGameSummary().players.find(player => player.id === a.id);
  assert.equal(summary.spectating, true);
});

check('disconnected payer cannot settle and clears the debt', () => {
  const { game, b } = startedRoom();
  game.pendingPayment = { playerId: b.id, creditorId: null, amountRemaining: 10, reason: 'r' };
  b.disconnected = true;
  assert.equal(game.pendingPayerCanSettle(b), false);
  assert.equal(game.trySettlePendingPayment(), false);
  assert.equal(game.pendingPayment, null);
});

check('disconnected seats cannot declare bankruptcy through a retained socket key', () => {
  const { game, b } = startedRoom();
  b.disconnected = true;
  assert.deepEqual(game.declareBankruptcy('socket-b'), { success: false, error: 'That player is unavailable right now.' });
  assert.equal(b.bankrupt, false);
});

check('endGame never crowns a disconnected ghost seat', () => {
  const { game, a, b } = startedRoom();
  a.disconnected = true;
  b.bankrupt = true;
  game.endGame();
  assert.equal(game.lastWinner, null);
  assert.equal(game.started, false);
});

check('waiting-for-seat notices identify the disconnected next player', () => {
  const { game, b } = startedRoom();
  b.disconnected = true;
  game.announceWaitingForSeat(b);
  assert.equal(game.feed[0].text, `Waiting for ${b.nickname} to reconnect…`);
});

const failed = results.filter(r => !r).length;
console.log(`\naudit game+contracts tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
