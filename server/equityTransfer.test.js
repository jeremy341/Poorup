import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-seller', clientId: 'c-seller', nickname: 'Seller' });
  room.addOrReconnectPlayer({ socketId: 's-owner', clientId: 'c-owner', nickname: 'Owner' });
  room.addOrReconnectPlayer({ socketId: 's-buyer', clientId: 'c-buyer', nickname: 'Buyer' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [seller, owner, buyer] = game.players;
  const tile = game.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  seller.cash = 500;
  buyer.cash = 500;
  owner.cash = 500;
  const source = {
    id: 'source-equity', kind: 'equity', fromPlayerId: seller.id, toPlayerId: owner.id,
    propertyIndex: tile.index, equityShare: 40, equityControl: 'passive', permanent: false,
    expiresRound: game.roundNumber + 4, amount: 100, status: 'active', createdRound: game.roundNumber
  };
  game.playerContracts.push(source);
  seller.playerContractIds.push(source.id);
  owner.playerContractIds.push(source.id);
  tile.equityShares = [{ holderId: seller.id, share: 40, contractId: source.id, control: 'passive' }];
  game.currentPlayerId = seller.id;
  return { game, seller, owner, buyer, tile, source };
}

const ctx = fixture();
const proposal = ctx.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: ctx.seller.id, toPlayerId: ctx.buyer.id, contractId: ctx.source.id,
  sharePct: 15, price: 60, requestId: 'transfer-1'
});
assert.equal(proposal.success, true);
assert.equal(ctx.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: ctx.seller.id,
  toPlayerId: ctx.buyer.id,
  contractId: ctx.source.id,
  sharePct: 15,
  price: 60,
  requestId: 'transfer-1'
}), proposal, 'proposal retries replay the original pending transfer');
assert.equal(ctx.game.pendingPlayerContract.kind, 'equity-transfer');
assert.equal(ctx.game.respondPlayerContract('s-buyer', true, 'accept-transfer', proposal.transfer.id).success, true);
assert.equal(ctx.seller.cash, 560);
assert.equal(ctx.buyer.cash, 440);
assert.equal(ctx.source.equityShare, 25);
assert.equal(ctx.game.playerContracts.find(contract => contract.kind === 'equity' && contract.fromPlayerId === ctx.buyer.id)?.equityShare, 15);
assert.equal(ctx.tile.equityShares.reduce((sum, share) => sum + share.share, 0), 40);
const acquired = ctx.game.playerContracts.find(contract => contract.kind === 'equity' && contract.fromPlayerId === ctx.buyer.id);
assert.equal(acquired.expiresRound, ctx.source.expiresRound, 'transferred shares keep the original expiry');

const convertedHybrid = fixture();
convertedHybrid.source.kind = 'hybrid';
convertedHybrid.source.status = 'converted';
convertedHybrid.source.equityShare = 0;
convertedHybrid.source.conversionShare = 40;
const hybridTransfer = convertedHybrid.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: convertedHybrid.seller.id,
  toPlayerId: convertedHybrid.buyer.id,
  contractId: convertedHybrid.source.id,
  sharePct: 15,
  price: 60
});
assert.equal(hybridTransfer.success, true);
assert.equal(convertedHybrid.game.respondPlayerContract('s-buyer', true, 'hybrid-transfer', hybridTransfer.transfer.id).success, true);
assert.equal(convertedHybrid.source.conversionShare, 25, 'converted hybrid source share shrinks by the transferred amount');
assert.equal(convertedHybrid.source.equityShare, 0, 'transfer does not make the unused equity field negative');
assert.equal(convertedHybrid.tile.equityShares.find(share => share.contractId === convertedHybrid.source.id).share, 25);
const sellerBeforePayout = convertedHybrid.seller.cash;
const buyerBeforePayout = convertedHybrid.buyer.cash;
convertedHybrid.game.settleEquityShares(convertedHybrid.tile, convertedHybrid.owner, 100);
assert.equal(convertedHybrid.seller.cash, sellerBeforePayout + 25);
assert.equal(convertedHybrid.buyer.cash, buyerBeforePayout + 15);

const wrongOwner = fixture();
const stolenOffer = wrongOwner.game.proposeEquityShareTransfer('s-buyer', {
  fromPlayerId: wrongOwner.buyer.id,
  toPlayerId: wrongOwner.seller.id,
  contractId: wrongOwner.source.id,
  sharePct: 15,
  price: 60
});
assert.equal(stolenOffer.success, false, 'only the current share holder can offer it');

const restricted = fixture();
restricted.tile.mortgaged = true;
const restrictedOffer = restricted.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: restricted.seller.id,
  toPlayerId: restricted.buyer.id,
  contractId: restricted.source.id,
  sharePct: 15,
  price: 60
});
assert.equal(restrictedOffer.success, false);

const stale = fixture();
const staleOffer = stale.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: stale.seller.id,
  toPlayerId: stale.buyer.id,
  contractId: stale.source.id,
  sharePct: 15,
  price: 60
});
stale.source.status = 'terminated';
assert.equal(stale.game.respondPlayerContract('s-buyer', true, 'stale-accept', staleOffer.transfer.id).success, false);
assert.equal(stale.buyer.cash, 500);
assert.equal(stale.seller.cash, 500);
assert.equal(stale.game.pendingPlayerContract, null);

const countered = fixture();
const counterOffer = countered.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: countered.seller.id,
  toPlayerId: countered.buyer.id,
  contractId: countered.source.id,
  sharePct: 15,
  price: 60
});
const counterResult = countered.game.counterPlayerContract('s-buyer', {
  contractId: counterOffer.transfer.id,
  sharePct: 20,
  price: 80
});
assert.equal(counterResult.success, true);
const counterAccept = countered.game.respondPlayerContract('s-seller', true, 'counter-accept', counterOffer.transfer.id);
assert.equal(counterAccept.success, true);
assert.equal(countered.source.equityShare, 20);
assert.equal(countered.buyer.cash, 420);

const cap = fixture();
cap.tile.equityShares.push({ holderId: cap.buyer.id, share: 90, contractId: 'buyer-share', control: 'passive' });
const capResult = cap.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: cap.seller.id,
  toPlayerId: cap.buyer.id,
  contractId: cap.source.id,
  sharePct: 15,
  price: 60
});
assert.equal(capResult.success, false, 'buyer share cannot exceed the property cap');

const expired = fixture();
expired.source.permanent = false;
expired.source.expiresRound = expired.game.roundNumber;
const expiredResult = expired.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: expired.seller.id,
  toPlayerId: expired.buyer.id,
  contractId: expired.source.id,
  sharePct: 15,
  price: 60
});
assert.equal(expiredResult.success, false, 'expired shares cannot be transferred');

const staleId = fixture();
const staleIdOffer = staleId.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: staleId.seller.id,
  toPlayerId: staleId.buyer.id,
  contractId: staleId.source.id,
  sharePct: 15,
  price: 60
});
const wrongResponse = staleId.game.respondPlayerContract('s-buyer', true, 'wrong-contract', 'stale-id');
assert.equal(wrongResponse.success, false);
assert.equal(staleId.game.pendingPlayerContract.id, staleIdOffer.transfer.id);

const bankrupt = fixture();
const bankruptOffer = bankrupt.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: bankrupt.seller.id,
  toPlayerId: bankrupt.buyer.id,
  contractId: bankrupt.source.id,
  sharePct: 15,
  price: 60
});
bankrupt.buyer.bankrupt = true;
const bankruptAccept = bankrupt.game.respondPlayerContract('s-buyer', true, 'bankrupt-accept', bankruptOffer.transfer.id);
assert.equal(bankruptAccept.success, false);
assert.equal(bankrupt.seller.cash, 500);

const canceled = fixture();
const cancelOffer = canceled.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: canceled.seller.id,
  toPlayerId: canceled.buyer.id,
  contractId: canceled.source.id,
  sharePct: 15,
  price: 60
});
const decline = canceled.game.respondPlayerContract('s-buyer', false, 'decline-transfer', cancelOffer.transfer.id);
assert.equal(decline.success, true);
assert.equal(canceled.source.equityShare, 40);
assert.equal(canceled.buyer.cash, 500);

const rollback = fixture();
const rollbackOffer = rollback.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: rollback.seller.id,
  toPlayerId: rollback.buyer.id,
  contractId: rollback.source.id,
  sharePct: 40,
  price: 60
});
rollback.game.feedMessage = () => { throw new Error('injected commit failure'); };
const rollbackAccept = rollback.game.respondPlayerContract('s-buyer', true, 'rollback-transfer', rollbackOffer.transfer.id);
assert.equal(rollbackAccept.success, false);
assert.equal(rollback.buyer.cash, 500);
assert.equal(rollback.seller.cash, 500);
assert.equal(rollback.source.equityShare, 40);
assert.equal(rollback.source.status, 'active');
assert.equal(rollback.tile.equityShares[0].share, 40);

const replay = fixture();
const replayOffer = replay.game.proposeEquityShareTransfer('s-seller', {
  fromPlayerId: replay.seller.id,
  toPlayerId: replay.buyer.id,
  contractId: replay.source.id,
  sharePct: 15,
  price: 60,
  requestId: 'replay-transfer'
});
const acceptedOnce = replay.game.respondPlayerContract('s-buyer', true, 'replay-accept', replayOffer.transfer.id);
assert.equal(replay.game.respondPlayerContract('s-buyer', true, 'replay-accept', replayOffer.transfer.id), acceptedOnce);
assert.equal(replay.seller.cash, 560);
