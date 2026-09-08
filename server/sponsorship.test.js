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

console.log('sponsored purchase: 21 passed, 0 failed');
