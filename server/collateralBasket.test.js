import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function startedRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [lender, borrower] = game.players;
  game.currentPlayerId = lender.id;
  return { game, lender, borrower };
}

function ownDeeds(game, borrower, indices) {
  for (const index of indices) {
    const tile = game.getTile(index);
    tile.ownerId = borrower.id;
    borrower.properties.push(index);
  }
}

function offer(game, borrower, collateralTileIndices, more = {}) {
  return game.proposePlayerContract('socket-a', {
    toPlayerId: borrower.id,
    kind: 'loan',
    amount: 100,
    durationRounds: 1,
    collateralTileIndices,
    ...more
  });
}

const validBasket = startedRoom();
ownDeeds(validBasket.game, validBasket.borrower, [1, 3]);
const validResult = offer(validBasket.game, validBasket.borrower, [1, 3]);
assert.equal(validResult.success, true, 'a borrower may pledge multiple eligible deeds');
assert.deepEqual(validBasket.game.pendingPlayerContract.collateralTileIndices, [1, 3]);

const duplicateBasket = startedRoom();
ownDeeds(duplicateBasket.game, duplicateBasket.borrower, [1, 3]);
const duplicateResult = offer(duplicateBasket.game, duplicateBasket.borrower, [1, 3, 1]);
assert.equal(duplicateResult.success, true);
assert.deepEqual(duplicateBasket.game.pendingPlayerContract.collateralTileIndices, [1, 3]);

const wrongOwner = startedRoom();
ownDeeds(wrongOwner.game, wrongOwner.borrower, [1]);
wrongOwner.game.getTile(3).ownerId = wrongOwner.lender.id;
assert.equal(offer(wrongOwner.game, wrongOwner.borrower, [1, 3]).success, false);
assert.equal(offer(wrongOwner.game, wrongOwner.borrower, ['not-an-index']).success, false);
assert.equal(offer(wrongOwner.game, wrongOwner.borrower, { invalid: true }).success, false);

const legacy = startedRoom();
ownDeeds(legacy.game, legacy.borrower, [1]);
assert.equal(offer(legacy.game, legacy.borrower, undefined, { collateralTileIndex: 1 }).success, true);
assert.deepEqual(legacy.game.pendingPlayerContract.collateralTileIndices, [1]);

for (const [name, mutate] of [
  ['mortgaged', tile => { tile.mortgaged = true; }],
  ['developed', tile => { tile.houseCount = 1; }],
  ['non-tradeable', tile => { tile.type = 'tax'; }]
]) {
  const ctx = startedRoom();
  ownDeeds(ctx.game, ctx.borrower, [1]);
  mutate(ctx.game.getTile(1));
  assert.equal(offer(ctx.game, ctx.borrower, [1]).success, false, `${name} deeds cannot be pledged`);
}

const tooMany = startedRoom();
ownDeeds(tooMany.game, tooMany.borrower, [1]);
assert.equal(offer(tooMany.game, tooMany.borrower, Array.from({ length: 41 }, (_, index) => index)).success, false,
  'a basket cannot exceed the board tile count');

const reserved = startedRoom();
ownDeeds(reserved.game, reserved.borrower, [1, 3]);
const reservedOffer = offer(reserved.game, reserved.borrower, [1, 3]);
assert.equal(reserved.game.respondPlayerContract('socket-b', true, 'accept-reservation', reservedOffer.contract.id).success, true);
assert.equal(reserved.game.isPlayerContractCollateral(reserved.borrower, reserved.game.getTile(1)), true);
assert.equal(reserved.game.isPlayerContractCollateral(reserved.borrower, reserved.game.getTile(3)), true);
assert.equal(reserved.game.isTradeableTile(reserved.game.getTile(1)), false);
assert.equal(reserved.game.canMortgageTile(reserved.borrower, reserved.game.getTile(1)), false);
assert.equal(reserved.game.canBuildOnTile(reserved.borrower, reserved.game.getTile(1)), false);
assert.equal(offer(reserved.game, reserved.borrower, [1]).success, false, 'an active pledge cannot overlap another loan');

const partiallyRepaid = startedRoom();
ownDeeds(partiallyRepaid.game, partiallyRepaid.borrower, [1, 3]);
const partialOffer = offer(partiallyRepaid.game, partiallyRepaid.borrower, [1, 3]);
partiallyRepaid.game.respondPlayerContract('socket-b', true, 'accept-partial', partialOffer.contract.id);
const partialContract = partiallyRepaid.game.playerContractById(partialOffer.contract.id);
assert.equal(partiallyRepaid.game.repayPlayerContract('socket-b', { contractId: partialContract.id, amount: 10 }).success, true);
assert.equal(partialContract.status, 'active');
assert.equal(partiallyRepaid.game.isPlayerContractCollateral(partiallyRepaid.borrower, partiallyRepaid.game.getTile(3)), true,
  'partial repayment keeps the complete signed basket reserved');

const repaid = startedRoom();
ownDeeds(repaid.game, repaid.borrower, [1, 3]);
const repayOffer = offer(repaid.game, repaid.borrower, [1, 3]);
repaid.game.respondPlayerContract('socket-b', true, 'accept-repay', repayOffer.contract.id);
const repayContract = repaid.game.playerContractById(repayOffer.contract.id);
assert.equal(repaid.game.repayPlayerContract('socket-b', { contractId: repayContract.id, requestId: 'pay-all' }).success, true);
assert.equal(repayContract.status, 'paid');
assert.equal(repaid.game.isTradeableTile(repaid.game.getTile(1)), true, 'full repayment releases pledged deeds');

const defaulted = startedRoom();
ownDeeds(defaulted.game, defaulted.borrower, [1, 3]);
const defaultOffer = offer(defaulted.game, defaulted.borrower, [1, 3]);
defaulted.game.respondPlayerContract('socket-b', true, 'accept-default', defaultOffer.contract.id);
const defaultContract = defaulted.game.playerContractById(defaultOffer.contract.id);
defaulted.game.roundNumber = defaultContract.cureRound + 1;
defaulted.game.processPlayerContracts();
defaulted.game.processPlayerContracts();
assert.equal(defaultContract.status, 'defaulted');
assert.equal(defaulted.game.getTile(1).ownerId, defaulted.lender.id);
assert.equal(defaulted.game.getTile(3).ownerId, defaulted.lender.id);

const bankruptHybrid = startedRoom();
ownDeeds(bankruptHybrid.game, bankruptHybrid.borrower, [1, 3]);
const hybridOffer = bankruptHybrid.game.proposePlayerContract('socket-a', {
  toPlayerId: bankruptHybrid.borrower.id,
  kind: 'hybrid',
  amount: 100,
  durationRounds: 2,
  propertyIndex: 1,
  conversionShare: 25,
  collateralTileIndices: [1, 3]
});
assert.equal(hybridOffer.success, true);
assert.equal(bankruptHybrid.game.respondPlayerContract('socket-b', true, 'accept-bankrupt-hybrid', hybridOffer.contract.id).success, true);
const hybridContract = bankruptHybrid.game.playerContractById(hybridOffer.contract.id);
hybridContract.remaining = 70;
bankruptHybrid.game.handleBankruptcy(bankruptHybrid.borrower, bankruptHybrid.lender);
assert.equal(bankruptHybrid.game.getTile(1).ownerId, bankruptHybrid.lender.id);
assert.equal(bankruptHybrid.game.getTile(3).ownerId, bankruptHybrid.lender.id);
assert.equal(bankruptHybrid.lender.properties.filter(index => [1, 3].includes(index)).length, 2);
assert.equal(hybridContract.status, 'defaulted');
assert.equal(hybridContract.defaultedPrincipal, 70);
assert.equal(hybridContract.unsecuredDefault, false);
assert.deepEqual(bankruptHybrid.game.defaultClaims[0].collateralTileIndices, [1, 3]);
assert.equal(bankruptHybrid.game.defaultClaims[0].collateralTileIndex, 1);
assert.equal(bankruptHybrid.game.defaultClaims[0].lenderId, bankruptHybrid.lender.id);
assert.equal(bankruptHybrid.game.defaultClaims[0].borrowerId, bankruptHybrid.borrower.id);
assert.equal(bankruptHybrid.game.defaultClaims[0].principal, 70);
assert.equal(bankruptHybrid.game.defaultClaims[0].remaining, 70);
assert.equal(bankruptHybrid.game.defaultClaims[0].status, 'open');

const legacyHybrid = startedRoom();
ownDeeds(legacyHybrid.game, legacyHybrid.borrower, [1]);
const legacyHybridOffer = legacyHybrid.game.proposePlayerContract('socket-a', {
  toPlayerId: legacyHybrid.borrower.id,
  kind: 'hybrid',
  amount: 100,
  durationRounds: 2,
  propertyIndex: 1,
  conversionShare: 25,
  collateralTileIndex: 1
});
assert.equal(legacyHybridOffer.success, true);
assert.equal(legacyHybrid.game.respondPlayerContract('socket-b', true, 'accept-legacy-hybrid', legacyHybridOffer.contract.id).success, true);
const legacyHybridContract = legacyHybrid.game.playerContractById(legacyHybridOffer.contract.id);
delete legacyHybridContract.collateralTileIndices;
legacyHybrid.game.handleBankruptcy(legacyHybrid.borrower, legacyHybrid.lender);
assert.equal(legacyHybrid.game.getTile(1).ownerId, legacyHybrid.lender.id);
assert.deepEqual(legacyHybrid.game.defaultClaims[0].collateralTileIndices, [1]);

const missingHybridLender = startedRoom();
ownDeeds(missingHybridLender.game, missingHybridLender.borrower, [1, 3]);
const missingLenderOffer = missingHybridLender.game.proposePlayerContract('socket-a', {
  toPlayerId: missingHybridLender.borrower.id,
  kind: 'hybrid',
  amount: 100,
  durationRounds: 2,
  propertyIndex: 1,
  conversionShare: 25,
  collateralTileIndices: [1, 3]
});
assert.equal(missingLenderOffer.success, true);
assert.equal(missingHybridLender.game.respondPlayerContract('socket-b', true, 'accept-missing-lender', missingLenderOffer.contract.id).success, true);
const missingLenderContract = missingHybridLender.game.playerContractById(missingLenderOffer.contract.id);
missingLenderContract.fromPlayerId = 'missing-lender';
missingHybridLender.game.handleBankruptcy(missingHybridLender.borrower, null);
assert.equal(missingLenderContract.status, 'defaulted');
assert.equal(missingHybridLender.game.getTile(1).ownerId, null);
assert.equal(missingHybridLender.game.getTile(3).ownerId, null);
assert.equal(missingHybridLender.game.defaultClaims[0].lenderId, 'missing-lender');
