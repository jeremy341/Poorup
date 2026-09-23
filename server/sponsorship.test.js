// Sponsored-purchase contract: contributions are reserved, publicly projected,
// and either refunded or consumed by one atomic forced purchase.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-buyer', clientId: 'c-buyer', nickname: 'Buyer' });
  room.addOrReconnectPlayer({ socketId: 's-sponsor', clientId: 'c-sponsor', nickname: 'Sponsor' });
  room.addOrReconnectPlayer({ socketId: 's-sponsor-2', clientId: 'c-sponsor-2', nickname: 'Second' });
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

console.log('sponsored purchase: 23 passed, 0 failed');
