import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-buyer', clientId: 'c-buyer', nickname: 'Buyer' });
  room.addOrReconnectPlayer({ socketId: 's-investor', clientId: 'c-investor', nickname: 'Investor' });
  room.addOrReconnectPlayer({ socketId: 's-gift', clientId: 'c-gift', nickname: 'Gift' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
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
const newRentShare = ctx.game.playerContracts.find(contract => contract.id === ctx.tile.equityShares[0].contractId);
assert.equal(newRentShare.kind, 'equity');
assert.equal(newRentShare.rulesVersion, 2);
assert.equal(newRentShare.rentShareVersion, 1);
assert.equal(newRentShare.permanent, false);
assert.equal(newRentShare.durationRounds, 3);
assert.equal(newRentShare.expiresRound, ctx.game.roundNumber + 3);
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

// T18: the accept memo is bound to the offer it settled. Reusing the same
// request id on a later equity offer must settle that offer instead of
// replaying the old success and leaving the new escrow unfilled.
const alias = fixture();
assert.equal(alias.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20, requestId: 'req-alias' }).success, true);
assert.equal(alias.game.contributeToSponsoredPurchase('s-investor', { amount: alias.tile.price - alias.buyer.cash, requestId: 'contrib-alias' }).success, true);
const firstAccept = alias.game.acceptSponsoredPurchase('s-buyer', { requestId: 'accept-alias' });
assert.equal(firstAccept.success, true);
assert.equal(alias.tile.ownerId, alias.buyer.id);

const secondTile = alias.game.getTile(3);
alias.buyer.cash = 20;
alias.investor.cash = 500;
alias.game.currentPlayerId = alias.buyer.id;
alias.game.pendingPurchaseOffer = { playerId: alias.buyer.id, tileIndex: secondTile.index };
assert.equal(alias.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20 }).success, true);
assert.equal(alias.game.contributeToSponsoredPurchase('s-investor', { amount: secondTile.price - 20 }).success, true);
const secondAccept = alias.game.acceptSponsoredPurchase('s-buyer', { requestId: 'accept-alias' });
assert.equal(secondAccept.success, true);
assert.equal(secondTile.ownerId, alias.buyer.id, 'the new escrow settles instead of replaying the old success');
assert.equal(secondTile.equityShares.length, 1);
assert.equal(secondTile.equityShares[0].holderId, alias.investor.id);
assert.equal(alias.game.pendingSponsoredPurchase, null);
assert.equal(alias.game.pendingPurchaseOffer, null);

// T18: the client reuses one request id for the whole sponsorship flow, so a
// top-up is a new amount while a retry of the same amount replays the memo.
const topUp = fixture();
assert.equal(topUp.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20, requestId: 'flow-topup' }).success, true);
const topUpNeed = topUp.tile.price - topUp.buyer.cash;
assert.equal(topUp.game.contributeToSponsoredPurchase('s-investor', { amount: 15, requestId: 'flow-topup' }).success, true);
assert.equal(topUp.game.contributeToSponsoredPurchase('s-investor', { amount: topUpNeed - 15, requestId: 'flow-topup' }).success, true);
assert.equal(topUp.game.pendingSponsoredPurchase.contributions.length, 1, 'one investor entry');
assert.equal(topUp.game.pendingSponsoredPurchase.contributions[0].amount, topUpNeed);
assert.equal(topUp.investor.cash, 500 - topUpNeed);
assert.equal(topUp.game.acceptSponsoredPurchase('s-buyer', { requestId: 'flow-topup' }).success, true);
assert.equal(topUp.tile.ownerId, topUp.buyer.id);
assert.equal(topUp.tile.equityShares.length, 1);

// Each contribution attempt carries its own contributionId. Two top-ups of the
// same amount under the same sponsorship-level requestId are two reservations;
// only a resend of one attempt (same contributionId) replays.
const sameAmount = fixture();
assert.equal(sameAmount.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20, requestId: 'flow-same' }).success, true);
assert.equal(sameAmount.game.contributeToSponsoredPurchase('s-investor', { amount: 15, requestId: 'flow-same', contributionId: 'attempt-1' }).success, true);
assert.equal(sameAmount.investor.cash, 485);
assert.equal(sameAmount.game.contributeToSponsoredPurchase('s-investor', { amount: 15, requestId: 'flow-same', contributionId: 'attempt-1' }).success, true);
assert.equal(sameAmount.investor.cash, 485, 'a resend of the same attempt replays without deducting again');
assert.equal(sameAmount.game.contributeToSponsoredPurchase('s-investor', { amount: 15, requestId: 'flow-same', contributionId: 'attempt-2' }).success, true);
assert.equal(sameAmount.investor.cash, 470, 'a second attempt of the same amount deducts again');
assert.equal(sameAmount.game.pendingSponsoredPurchase.contributions[0].amount, 30);
assert.equal(sameAmount.game.contributeToSponsoredPurchase('s-investor', { amount: 15, requestId: 'flow-same', contributionId: 'attempt-2' }).success, true);
assert.equal(sameAmount.investor.cash, 470, 'the second attempt also replays on resend');

// A client that sends no contributionId keeps the sponsorship-level behavior:
// the same requestId and amount is a retry.
const legacy = fixture();
assert.equal(legacy.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20, requestId: 'flow-legacy' }).success, true);
assert.equal(legacy.game.contributeToSponsoredPurchase('s-investor', { amount: 15, requestId: 'flow-legacy' }).success, true);
assert.equal(legacy.game.contributeToSponsoredPurchase('s-investor', { amount: 15, requestId: 'flow-legacy' }).success, true);
assert.equal(legacy.investor.cash, 485, 'a legacy client without contributionId replays on requestId and amount');
// The same contributionId with a different amount is a new top-up, not a replay.
assert.equal(legacy.game.contributeToSponsoredPurchase('s-investor', { amount: 10, requestId: 'flow-legacy', contributionId: 'attempt-x' }).success, true);
assert.equal(legacy.game.contributeToSponsoredPurchase('s-investor', { amount: 5, requestId: 'flow-legacy', contributionId: 'attempt-x' }).success, true);
assert.equal(legacy.investor.cash, 470);

console.log('equity purchase: 66 passed, 0 failed');

// Both sponsorship modes and retries obey the finance flag, while escrow
// cancellation remains available after the module is disabled.
for (const mode of ['gift', 'equity']) {
  const gated = fixture();
  gated.game.settings.rulesProfile = 'standard';
  gated.game.settings.playerFinance = false;
  assert.equal(gated.game.requestPurchaseSponsorship('s-buyer', { mode, sharePct: 20 }).success, false);
  gated.game.settings.playerFinance = true;
  assert.equal(gated.game.requestPurchaseSponsorship('s-buyer', { mode, sharePct: 20 }).success, true);
  assert.equal(gated.game.contributeToSponsoredPurchase('s-investor', { amount: gated.tile.price - 20, requestId: 'gate-retry' }).success, true);
  gated.game.settings.playerFinance = false;
  assert.equal(gated.game.contributeToSponsoredPurchase('s-investor', { amount: gated.tile.price - 20, requestId: 'gate-retry' }).success, false);
  assert.equal(gated.game.acceptSponsoredPurchase('s-buyer').success, false);
  assert.equal(gated.game.declineSponsoredPurchase('s-buyer').success, true);
  assert.equal(gated.investor.cash, 500);
}
for (const type of ['railroad', 'utility']) {
  const buyable = fixture();
  const tile = buyable.game.tiles.find(candidate => candidate.type === type);
  buyable.game.pendingPurchaseOffer.tileIndex = tile.index;
  assert.equal(buyable.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20, durationRounds: 7 }).success, true);
  assert.equal(buyable.game.contributeToSponsoredPurchase('s-investor', { amount: tile.price - 20 }).success, true);
  assert.equal(buyable.game.acceptSponsoredPurchase('s-buyer').success, true);
  const share = buyable.game.playerContracts.at(-1);
  assert.equal(share.rentShareVersion, 1);
  assert.equal(share.durationRounds, 7);
  assert.equal(share.expiresRound, buyable.game.roundNumber + 7);
}
for (const terms of [{ permanent: true }, { equityControl: 'shared' }, { durationRounds: 0 }, { durationRounds: 21 }]) {
  const invalid = fixture();
  assert.equal(invalid.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20, ...terms }).success, false);
}
const legacyPending = fixture();
assert.equal(legacyPending.game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 20 }).success, true);
delete legacyPending.game.pendingSponsoredPurchase.rulesVersion;
assert.equal(legacyPending.game.contributeToSponsoredPurchase('s-investor', { amount: 10 }).success, false);
assert.match(legacyPending.game.acceptSponsoredPurchase('s-buyer').error, /rebuilt/);
assert.equal(legacyPending.game.declineSponsoredPurchase('s-buyer').success, true);
ctx.game.settings.rulesProfile = 'standard';
ctx.game.settings.playerFinance = false;
assert.equal(ctx.game.acceptSponsoredPurchase('s-buyer', { requestId: 'accept-equity' }).success, false);
console.log('temporary purchase-funding profile, legacy pending, deed types and terms: passed');
