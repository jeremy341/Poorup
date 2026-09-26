import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-buyer', clientId: 'c-buyer', nickname: 'Buyer' });
  room.addOrReconnectPlayer({ socketId: 's-investor', clientId: 'c-investor', nickname: 'Investor' });
  room.addOrReconnectPlayer({ socketId: 's-gift', clientId: 'c-gift', nickname: 'Gift' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const buyer = game.getPlayerBySocket('s-buyer');
  const investor = game.getPlayerBySocket('s-investor');
  const gift = game.getPlayerBySocket('s-gift');
  const tile = game.getTile(1);
  buyer.cash = 20;
  investor.cash = 500;
  gift.cash = 500;
  game.currentPlayerId = buyer.id;
  game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index };
  return { game, buyer, investor, gift, tile };
}

const ctx = fixture();
assert.equal(ctx.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 30, requestId: 'request-equity' }).success, true);
assert.equal(ctx.game.pendingSponsoredPurchase.mode, 'equity');
assert.equal(ctx.game.contributeToSponsoredPurchase('s-investor', { amount: ctx.tile.price - ctx.buyer.cash, requestId: 'invest' }).success, true);
assert.equal(ctx.game.contributeToSponsoredPurchase('s-gift', { amount: 1 }).success, false, 'equity purchases allow one investor');
const accepted = ctx.game.acceptSponsoredPurchase('s-buyer', { requestId: 'accept-equity' });
assert.equal(accepted.success, true);
assert.equal(ctx.tile.ownerId, ctx.buyer.id);
assert.equal(ctx.tile.equityShares.length, 1);
assert.equal(ctx.tile.equityShares[0].holderId, ctx.investor.id);
assert.equal(ctx.tile.equityShares[0].share, 30);
assert.equal(ctx.game.playerContracts.find(contract => contract.id === ctx.tile.equityShares[0].contractId).kind, 'equity');
assert.equal(ctx.game.acceptSponsoredPurchase('s-buyer', { requestId: 'accept-equity' }), accepted, 'duplicate acceptance replays the settled result');
assert.equal(ctx.investor.cash, 500 - (ctx.tile.price - 20));
ctx.buyer.cash = 100;
const investorBeforeRent = ctx.investor.cash;
ctx.game.settleEquityShares(ctx.tile, ctx.buyer, 100);
assert.equal(ctx.investor.cash, investorBeforeRent + 30, 'the passive share uses the existing rent settlement');

const cap = fixture();
cap.tile.equityShares = [{ holderId: cap.gift.id, share: 80, contractId: 'existing' }];
assert.equal(cap.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 30 }).success, false);

const cancel = fixture();
assert.equal(cancel.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20 }).success, true);
assert.equal(cancel.game.contributeToSponsoredPurchase('s-investor', { amount: 25 }).success, true);
assert.equal(cancel.game.declineSponsoredPurchase('s-buyer').success, true);
assert.equal(cancel.investor.cash, 500);

const rollback = fixture();
assert.equal(rollback.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20 }).success, true);
assert.equal(rollback.game.contributeToSponsoredPurchase('s-investor', { amount: rollback.tile.price - rollback.buyer.cash }).success, true);
rollback.game.refreshPlayerGroups = () => { throw new Error('injected settlement failure'); };
assert.equal(rollback.game.acceptSponsoredPurchase('s-buyer').success, false);
assert.equal(rollback.tile.ownerId, null);
assert.deepEqual(rollback.tile.equityShares || [], []);
assert.equal(rollback.game.playerContracts.length, 0);
assert.ok(rollback.game.pendingSponsoredPurchase);

const stale = fixture();
assert.equal(stale.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20 }).success, true);
assert.equal(stale.game.contributeToSponsoredPurchase('s-investor', { amount: stale.tile.price - stale.buyer.cash }).success, true);
stale.tile.ownerId = stale.gift.id;
assert.equal(stale.game.acceptSponsoredPurchase('s-buyer').success, false);
assert.equal(stale.investor.cash, 500);
assert.equal(stale.game.pendingSponsoredPurchase, null);

const changedOffer = fixture();
assert.equal(changedOffer.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20 }).success, true);
assert.equal(changedOffer.game.contributeToSponsoredPurchase('s-investor', { amount: 25 }).success, true);
changedOffer.game.pendingPurchaseOffer.tileIndex = 3;
assert.equal(changedOffer.game.acceptSponsoredPurchase('s-buyer').success, false);
assert.equal(changedOffer.investor.cash, 500);
assert.equal(changedOffer.game.pendingSponsoredPurchase, null);

const disconnected = fixture();
assert.equal(disconnected.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20 }).success, true);
assert.equal(disconnected.game.contributeToSponsoredPurchase('s-investor', { amount: 25 }).success, true);
disconnected.investor.disconnected = true;
assert.equal(disconnected.game.acceptSponsoredPurchase('s-buyer').success, false);
assert.equal(disconnected.investor.cash, 500);
assert.equal(disconnected.game.pendingSponsoredPurchase, null);

const bankrupt = fixture();
assert.equal(bankrupt.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20 }).success, true);
assert.equal(bankrupt.game.contributeToSponsoredPurchase('s-investor', { amount: 25 }).success, true);
bankrupt.buyer.bankrupt = true;
bankrupt.game.markPlayerBankrupt(bankrupt.buyer);
assert.equal(bankrupt.investor.cash, 500);
assert.equal(bankrupt.game.pendingSponsoredPurchase, null);
