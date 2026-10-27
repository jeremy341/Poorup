// Sponsored-purchase contract: contributions are reserved, publicly projected,
// and either refunded or consumed by one atomic forced purchase.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-buyer', clientId: 'c-buyer', nickname: 'Buyer' });
  room.addOrReconnectPlayer({ socketId: 's-sponsor', clientId: 'c-sponsor', nickname: 'Sponsor' });
  room.addOrReconnectPlayer({ socketId: 's-sponsor-2', clientId: 'c-sponsor-2', nickname: 'Second' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const buyer = game.getPlayerBySocket('s-buyer');
  const sponsor = game.getPlayerBySocket('s-sponsor');
  const second = game.getPlayerBySocket('s-sponsor-2');
  const tile = game.getTile(1);
  buyer.cash = 20;
  sponsor.cash = 500;
  second.cash = 500;
  game.currentPlayerId = buyer.id;
  game.hasRolled = true;
  game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index };
  return { room, game, buyer, sponsor, second, tile };
}

const ctx = fixture();
const requested = ctx.game.requestPurchaseSponsorship('s-buyer');
assert.equal(requested.success, true);
assert.equal(ctx.game.pendingSponsoredPurchase.tileIndex, ctx.tile.index);
assert.equal(ctx.game.summarySponsoredPurchase().amountNeeded, ctx.tile.price - 20);
assert.equal(ctx.game.proposeTrade('s-buyer', { toPlayerId: ctx.sponsor.id, giveCash: 1 }).success, false);

const first = ctx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 20 });
assert.equal(first.success, true);
assert.equal(ctx.sponsor.cash, 480);
assert.equal(first.sponsorship.totalContributed, 20);
assert.equal(first.sponsorship.amountNeeded, ctx.tile.price - 40);
assert.equal(ctx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 1 }).success, false);
assert.equal(ctx.game.contributeToSponsoredPurchase('s-sponsor-2', { amount: ctx.tile.price - 40 }).success, true);

const accepted = ctx.game.acceptSponsoredPurchase('s-buyer');
assert.equal(accepted.success, true);
assert.equal(accepted.purchased, true);
assert.equal(accepted.contributionTotal, ctx.tile.price - 20);
assert.equal(ctx.tile.ownerId, ctx.buyer.id);
assert.equal(ctx.buyer.cash, 0);
assert.equal(ctx.sponsor.cash, 480);
assert.equal(ctx.second.cash, 500 - (ctx.tile.price - 40));
assert.equal(ctx.game.pendingSponsoredPurchase, null);
assert.equal(ctx.game.pendingPurchaseOffer, null);

const cancelCtx = fixture();
assert.equal(cancelCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
assert.equal(cancelCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 15 }).success, true);
assert.equal(cancelCtx.game.declineSponsoredPurchase('s-buyer').success, true);
assert.equal(cancelCtx.sponsor.cash, 500);
assert.equal(cancelCtx.game.pendingSponsoredPurchase, null);
assert.equal(cancelCtx.game.pendingPurchaseOffer.playerId, cancelCtx.buyer.id);

const staleCtx = fixture();
assert.equal(staleCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
assert.equal(staleCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 15 }).success, true);
staleCtx.tile.ownerId = staleCtx.second.id;
assert.equal(staleCtx.game.contributeToSponsoredPurchase('s-sponsor-2', { amount: 1 }).success, false);
assert.equal(staleCtx.sponsor.cash, 500);
assert.equal(staleCtx.game.pendingSponsoredPurchase, null);

const financedCtx = fixture();
assert.equal(financedCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
financedCtx.sponsor.bankLoan = { status: 'active', remaining: 300 };
assert.deepEqual(financedCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 15 }), { success: false, error: 'Loan-backed cash cannot fund sponsorships.' });
assert.equal(financedCtx.sponsor.cash, 500);

const blockedCtx = fixture();
assert.equal(blockedCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
blockedCtx.game.pendingTrade = { id: 'trade-open' };
assert.deepEqual(blockedCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 15 }), { success: false, error: 'Resolve the table obligation before sponsoring.' });
assert.equal(blockedCtx.sponsor.cash, 500);

// Atomic settlement: a mid-settlement throw restores buyer cash, the deed,
// the portfolio, and the escrow record instead of crediting the buyer.
const atomicCtx = fixture();
assert.equal(atomicCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
assert.equal(atomicCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 20 }).success, true);
assert.equal(atomicCtx.game.contributeToSponsoredPurchase('s-sponsor-2', { amount: atomicCtx.tile.price - 40 }).success, true);
const cashBefore = atomicCtx.buyer.cash;
atomicCtx.game.refreshPlayerGroups = () => { throw new Error('boom'); };
assert.deepEqual(atomicCtx.game.acceptSponsoredPurchase('s-buyer'), { success: false, error: 'Sponsored purchase failed; contributions remain reserved.' });
assert.equal(atomicCtx.buyer.cash, cashBefore);
assert.equal(atomicCtx.tile.ownerId, null);
assert.deepEqual(atomicCtx.buyer.properties.includes(atomicCtx.tile.index), false);
assert.ok(atomicCtx.game.pendingSponsoredPurchase);
assert.equal(atomicCtx.sponsor.cash, 480);

// Vacation landing teleports to the Vacation tile, never Jail.
const vacationCtx = fixture();
const holiday = vacationCtx.game.tiles.find(tile => tile.type === 'vacation');
vacationCtx.buyer.position = 0;
vacationCtx.game.landingGoToVacation(vacationCtx.buyer, { index: -1, type: 'goToVacation' }, {});
assert.equal(vacationCtx.buyer.position, holiday.index);
assert.equal(vacationCtx.buyer.inJail, false);

// Overfunded escrow returns the excess pro-rata instead of gifting the buyer.
// Overfunding cannot come from contributions (capped at need): it arrives
// when the buyer earns cash mid-escrow.
const excessCtx = fixture();
assert.equal(excessCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
assert.equal(excessCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 20 }).success, true);
assert.equal(excessCtx.game.contributeToSponsoredPurchase('s-sponsor-2', { amount: 20 }).success, true);
excessCtx.buyer.cash = 50;
assert.equal(excessCtx.game.acceptSponsoredPurchase('s-buyer').success, true);
assert.equal(excessCtx.sponsor.cash, 500 - 20 + 15);
assert.equal(excessCtx.second.cash, 500 - 20 + 15);
assert.equal(excessCtx.buyer.cash, 0);

// F-023: an open escrow pins the buyer's cash. A mortgage, unmortgage, sale or
// build on a deed mid-request would move the cash the escrow was sized
// against, so sponsors could be refunded while the equity stake still forms.
const deedCtx = fixture();
const deed = deedCtx.game.getTile(6);
deed.ownerId = deedCtx.buyer.id;
deedCtx.buyer.properties.push(deed.index);
assert.equal(deedCtx.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 25 }).success, true);
const frozenError = 'Resolve the open sponsorship before managing this property.';
for (const action of ['mortgage', 'unmortgage', 'sell-house', 'build-house']) {
  assert.deepEqual(deedCtx.game.manageProperty('s-buyer', { tileIndex: deed.index, action }), { success: false, error: frozenError }, action);
}
assert.equal(deed.mortgaged, false);
assert.equal(deedCtx.buyer.cash, 20);
assert.equal(deedCtx.game.declineSponsoredPurchase('s-buyer').success, true);
assert.equal(deedCtx.game.manageProperty('s-buyer', { tileIndex: deed.index, action: 'mortgage' }).success, true);
assert.equal(deed.mortgaged, true);

// T18: a retried contribution replays its memo instead of reserving the cash
// twice. The memo is keyed by sponsor, sponsorship and request id.
const replayCtx = fixture();
assert.equal(replayCtx.game.requestPurchaseSponsorship('s-buyer', { requestId: 'req-replay' }).success, true);
const firstContribution = replayCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 20, requestId: 'contrib-replay' });
assert.equal(firstContribution.success, true);
assert.equal(replayCtx.sponsor.cash, 480);
const retriedContribution = replayCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 20, requestId: 'contrib-replay' });
assert.equal(retriedContribution.success, true);
assert.equal(retriedContribution.sponsorship.totalContributed, 20);
assert.equal(replayCtx.sponsor.cash, 480, 'a retried contribution must not reserve the cash twice');
assert.equal(replayCtx.game.summarySponsoredPurchase().amountNeeded, replayCtx.tile.price - 40);

// T19: a sponsor with a head debt or a queued claim cannot fund a sponsorship.
const headDebtCtx = fixture();
assert.equal(headDebtCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
headDebtCtx.game.pendingPayment = { playerId: headDebtCtx.sponsor.id, creditorId: headDebtCtx.buyer.id, amountRemaining: 40 };
assert.deepEqual(headDebtCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 10 }), { success: false, error: 'Settle your debt before sponsoring.' });
assert.equal(headDebtCtx.sponsor.cash, 500);
headDebtCtx.game.pendingPayment = null;
headDebtCtx.game.pendingPaymentQueue = [{ payment: { playerId: headDebtCtx.sponsor.id, amountRemaining: 25 } }];
assert.deepEqual(headDebtCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: 10 }), { success: false, error: 'Settle your debt before sponsoring.' });
assert.equal(headDebtCtx.sponsor.cash, 500);
headDebtCtx.game.pendingPaymentQueue = [];

// T19: a buyer with a pending debt cannot accept the sponsored purchase.
const buyerDebtCtx = fixture();
assert.equal(buyerDebtCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
assert.equal(buyerDebtCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: buyerDebtCtx.tile.price - 20 }).success, true);
buyerDebtCtx.game.pendingPayment = { playerId: buyerDebtCtx.buyer.id, creditorId: null, amountRemaining: 30 };
assert.deepEqual(buyerDebtCtx.game.acceptSponsoredPurchase('s-buyer'), { success: false, error: 'Settle your debt before accepting this sponsorship.' });
assert.equal(buyerDebtCtx.tile.ownerId, null);
assert.equal(buyerDebtCtx.sponsor.cash, 500 - (buyerDebtCtx.tile.price - 20));
assert.ok(buyerDebtCtx.game.pendingSponsoredPurchase);

// T20: a sponsorship with no remaining need is refused: it cannot be funded
// and it would still hold the table at the end-turn gate.
const zeroNeedCtx = fixture();
zeroNeedCtx.buyer.cash = zeroNeedCtx.tile.price;
assert.equal(zeroNeedCtx.game.requestPurchaseSponsorship('s-buyer').success, false);
assert.equal(zeroNeedCtx.game.pendingSponsoredPurchase, null);
assert.equal(zeroNeedCtx.game.pendingPurchaseOffer.playerId, zeroNeedCtx.buyer.id);

// T21: the rollback restores the non-cash state the settlement touched.
const stateCtx = fixture();
assert.equal(stateCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
assert.equal(stateCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: stateCtx.tile.price - 20 }).success, true);
stateCtx.buyer.fullGroups = new Set(['brown']);
stateCtx.game.refreshPlayerGroups = (player) => {
  player.fullGroups.add('red');
  player.boughtDuringHousingBubble = true;
  throw new Error('boom');
};
assert.deepEqual(stateCtx.game.acceptSponsoredPurchase('s-buyer'), { success: false, error: 'Sponsored purchase failed; contributions remain reserved.' });
assert.deepEqual([...stateCtx.buyer.fullGroups], ['brown'], 'the rollback restores the group set');
assert.equal(stateCtx.buyer.boughtDuringHousingBubble, false);
assert.equal(stateCtx.game.awaitingEndTurn, false);
assert.equal(stateCtx.game.hasRolled, true);

// T21: the null-player flag a failed settlement set on the buyer is rolled back.
const zeroFlagCtx = fixture();
assert.equal(zeroFlagCtx.game.requestPurchaseSponsorship('s-buyer').success, true);
assert.equal(zeroFlagCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: zeroFlagCtx.tile.price - 20 }).success, true);
zeroFlagCtx.buyer.zeroCashReached = false;
zeroFlagCtx.game.refreshPlayerGroups = () => { throw new Error('boom'); };
assert.deepEqual(zeroFlagCtx.game.acceptSponsoredPurchase('s-buyer'), { success: false, error: 'Sponsored purchase failed; contributions remain reserved.' });
assert.equal(zeroFlagCtx.buyer.cash, 20);
assert.equal(zeroFlagCtx.buyer.zeroCashReached, false, 'a failed settlement leaves no bogus zero-cash flag');

// T21: an equity settlement that fails after the purchase resolved the turn
// leaves the turn open and the escrow intact.
const turnCtx = fixture();
assert.equal(turnCtx.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20 }).success, true);
assert.equal(turnCtx.game.contributeToSponsoredPurchase('s-sponsor', { amount: turnCtx.tile.price - 20 }).success, true);
Object.freeze(turnCtx.sponsor.playerContractIds);
assert.deepEqual(turnCtx.game.acceptSponsoredPurchase('s-buyer'), { success: false, error: 'Sponsored purchase failed; contributions remain reserved.' });
assert.equal(turnCtx.game.awaitingEndTurn, false, 'a failed settlement leaves the turn open');
assert.equal(turnCtx.tile.ownerId, null);
assert.equal(turnCtx.buyer.cash, 20);
assert.ok(turnCtx.game.pendingSponsoredPurchase);
assert.deepEqual(turnCtx.game.playerContracts, []);

console.log('sponsored purchase: 30 passed, 0 failed');
console.log('sponsorship regressions: 36 passed, 0 failed');
