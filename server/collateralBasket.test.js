import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function startedRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
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

function legacyAcceptedContract(ctx, terms) {
  const indices = terms.collateralTileIndices || (terms.collateralTileIndex == null ? [] : [terms.collateralTileIndex]);
  const contract = {
    id: `legacy-${terms.kind}-${ctx.game.playerContracts.length}`,
    fromPlayerId: ctx.lender.id, toPlayerId: ctx.borrower.id,
    premiumRate: 0, equityShare: 0, ...terms,
    collateralTileIndices: indices.slice(), collateralTileIndex: indices[0] ?? null,
    totalDue: terms.amount, remaining: terms.amount,
    dueRound: ctx.game.roundNumber + terms.durationRounds,
    cureRound: ctx.game.roundNumber + terms.durationRounds + 1,
    status: 'active'
  };
  ctx.game.playerContracts.push(contract);
  ctx.lender.playerContractIds.push(contract.id);
  ctx.borrower.playerContractIds.push(contract.id);
  ctx.lender.cash -= contract.amount;
  ctx.borrower.cash += contract.amount;
  return { success: true, contract };
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

// A full ledger of open claims cannot take a new one. The round processor must
// then leave the due loan untouched (no seizure, no default flag, no claim) so a
// later round retries it once a slot frees up, instead of defaulting the loan
// with no recovery record.
function fullLedger(game, lender, borrower) {
  game.defaultClaims = Array.from({ length: 200 }, (_, index) => ({
    id: `open_${index}`,
    contractId: `contract-open_${index}`,
    lenderId: lender.id,
    borrowerId: borrower.id,
    principal: 10,
    remaining: 10,
    reason: 'loan-default',
    status: 'open',
    createdRound: 0
  }));
  return game.defaultClaims.map(claim => ({ ...claim }));
}

const fullLedgerLoan = startedRoom();
ownDeeds(fullLedgerLoan.game, fullLedgerLoan.borrower, [1, 3]);
const fullLedgerOffer = offer(fullLedgerLoan.game, fullLedgerLoan.borrower, [1, 3], { amount: 300 });
fullLedgerLoan.game.respondPlayerContract('socket-b', true, 'accept-full-ledger', fullLedgerOffer.contract.id);
const fullLedgerContract = fullLedgerLoan.game.playerContractById(fullLedgerOffer.contract.id);
const ledgerBefore = fullLedger(fullLedgerLoan.game, fullLedgerLoan.lender, fullLedgerLoan.borrower);
fullLedgerLoan.game.roundNumber = fullLedgerContract.cureRound + 1;
fullLedgerLoan.game.processPlayerContracts();
fullLedgerLoan.game.processPlayerContracts();
const contractBefore = JSON.stringify(fullLedgerContract);
const cashBefore = [fullLedgerLoan.lender.cash, fullLedgerLoan.borrower.cash];
fullLedgerLoan.game.processPlayerContracts();
assert.equal(fullLedgerContract.status, 'due', 'a loan that cannot file its claim stays due');
assert.equal(JSON.stringify(fullLedgerContract), contractBefore, 'the due contract is not modified by a failed default');
assert.equal(fullLedgerLoan.game.getTile(1).ownerId, fullLedgerLoan.borrower.id, 'collateral is not seized without a claim');
assert.equal(fullLedgerLoan.game.getTile(3).ownerId, fullLedgerLoan.borrower.id);
assert.notEqual(fullLedgerLoan.borrower.collateralLost, true);
assert.deepEqual([fullLedgerLoan.lender.cash, fullLedgerLoan.borrower.cash], cashBefore);
assert.deepEqual(fullLedgerLoan.game.defaultClaims, ledgerBefore, 'the open claims are neither evicted nor changed');
fullLedgerLoan.game.defaultClaims[0].status = 'settled';
fullLedgerLoan.game.processPlayerContracts();
assert.equal(fullLedgerContract.status, 'defaulted', 'the next round retries once a slot is free');
assert.equal(fullLedgerLoan.game.getTile(1).ownerId, fullLedgerLoan.lender.id);
assert.equal(fullLedgerLoan.game.defaultClaims.some(claim => claim.contractId === fullLedgerContract.id), true);

const fullLedgerHybrid = startedRoom();
ownDeeds(fullLedgerHybrid.game, fullLedgerHybrid.borrower, [1, 3]);
const fullLedgerHybridOffer = legacyAcceptedContract(fullLedgerHybrid, {
  toPlayerId: fullLedgerHybrid.borrower.id,
  kind: 'hybrid',
  amount: 100,
  durationRounds: 1,
  propertyIndex: 1,
  conversionShare: 25,
  collateralTileIndices: [1, 3]
});
const fullLedgerHybridContract = fullLedgerHybrid.game.playerContractById(fullLedgerHybridOffer.contract.id);
fullLedgerHybrid.game.getTile(1).mortgaged = true; // the conversion target is gone: fall back to the default path
const hybridLedgerBefore = fullLedger(fullLedgerHybrid.game, fullLedgerHybrid.lender, fullLedgerHybrid.borrower);
fullLedgerHybrid.game.roundNumber = fullLedgerHybridContract.cureRound + 1;
fullLedgerHybrid.game.processPlayerContracts();
fullLedgerHybrid.game.processPlayerContracts();
assert.equal(fullLedgerHybridContract.status, 'due', 'a hybrid whose fallback default cannot file a claim stays due');
assert.equal(fullLedgerHybrid.game.getTile(1).ownerId, fullLedgerHybrid.borrower.id);
assert.equal(fullLedgerHybrid.game.getTile(3).ownerId, fullLedgerHybrid.borrower.id);
assert.equal(fullLedgerHybridContract.defaultReason, undefined);
assert.deepEqual(fullLedgerHybrid.game.defaultClaims, hybridLedgerBefore);

const bankruptHybrid = startedRoom();
ownDeeds(bankruptHybrid.game, bankruptHybrid.borrower, [1, 3]);
const hybridOffer = legacyAcceptedContract(bankruptHybrid, {
  toPlayerId: bankruptHybrid.borrower.id,
  kind: 'hybrid',
  amount: 100,
  durationRounds: 2,
  propertyIndex: 1,
  conversionShare: 25,
  collateralTileIndices: [1, 3]
});
assert.equal(hybridOffer.success, true);
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

// Bankruptcy has no later round to retry, so a borrower leaving with a full
// ledger still defaults the loan and the lender still seizes the collateral;
// the lost recovery record is flagged and announced instead of silent.
for (const kind of ['loan', 'hybrid']) {
  const ctx = startedRoom();
  ownDeeds(ctx.game, ctx.borrower, [1, 3]);
  const proposal = legacyAcceptedContract(ctx, {
    toPlayerId: ctx.borrower.id,
    kind,
    amount: 100,
    durationRounds: 2,
    collateralTileIndices: [1, 3],
    ...(kind === 'hybrid' ? { propertyIndex: 1, conversionShare: 25 } : {})
  });
  assert.equal(proposal.success, true);
  const contract = ctx.game.playerContractById(proposal.contract.id);
  contract.remaining = 70;
  const before = fullLedger(ctx.game, ctx.lender, ctx.borrower);
  ctx.game.handleBankruptcy(ctx.borrower, ctx.lender);
  assert.equal(contract.status, 'defaulted', kind + ' still defaults');
  assert.equal(ctx.game.getTile(1).ownerId, ctx.lender.id, kind + ' collateral is still seized');
  assert.equal(ctx.game.getTile(3).ownerId, ctx.lender.id);
  assert.equal(contract.defaultedPrincipal, 70);
  assert.equal(contract.unrecordedDefault, true, kind + ' flags the missing claim');
  assert.deepEqual(ctx.game.defaultClaims, before, 'open claims are neither evicted nor changed');
  assert.ok(ctx.game.feed.some(entry => entry.text === `${ctx.lender.nickname} could not record a recovery claim against ${ctx.borrower.nickname}: $70 written off.`), kind + ' announces the write-off');
}
assert.notEqual(bankruptHybrid.game.playerContractById(hybridOffer.contract.id).unrecordedDefault, true, 'a recorded claim is not flagged');

const convertedHybrid = startedRoom();
ownDeeds(convertedHybrid.game, convertedHybrid.borrower, [1, 3]);
const convertedOffer = legacyAcceptedContract(convertedHybrid, {
  toPlayerId: convertedHybrid.borrower.id,
  kind: 'hybrid',
  amount: 100,
  durationRounds: 1,
  propertyIndex: 1,
  conversionShare: 25,
  collateralTileIndices: [1, 3]
});
assert.equal(convertedOffer.success, true);
const convertedContract = convertedHybrid.game.playerContractById(convertedOffer.contract.id);
convertedHybrid.game.roundNumber = convertedContract.cureRound + 1;
convertedHybrid.game.processPlayerContracts();
convertedHybrid.game.processPlayerContracts();
assert.equal(convertedContract.status, 'converted');
assert.equal(convertedHybrid.game.getTile(1).equityShares[0].share, 25);
convertedHybrid.game.handleBankruptcy(convertedHybrid.borrower, null);
assert.equal(convertedContract.status, 'terminated');
assert.deepEqual(convertedHybrid.game.getTile(1).equityShares, []);
assert.equal(convertedHybrid.game.getTile(1).ownerId, null);
assert.equal(convertedHybrid.game.getTile(3).ownerId, null);
assert.equal(convertedHybrid.game.defaultClaims.some(claim => claim.contractId === convertedContract.id), false);

const legacyHybrid = startedRoom();
ownDeeds(legacyHybrid.game, legacyHybrid.borrower, [1]);
const legacyHybridOffer = legacyAcceptedContract(legacyHybrid, {
  toPlayerId: legacyHybrid.borrower.id,
  kind: 'hybrid',
  amount: 100,
  durationRounds: 2,
  propertyIndex: 1,
  conversionShare: 25,
  collateralTileIndex: 1
});
assert.equal(legacyHybridOffer.success, true);
const legacyHybridContract = legacyHybrid.game.playerContractById(legacyHybridOffer.contract.id);
delete legacyHybridContract.collateralTileIndices;
legacyHybrid.game.handleBankruptcy(legacyHybrid.borrower, legacyHybrid.lender);
assert.equal(legacyHybrid.game.getTile(1).ownerId, legacyHybrid.lender.id);
assert.deepEqual(legacyHybrid.game.defaultClaims[0].collateralTileIndices, [1]);

const missingHybridLender = startedRoom();
ownDeeds(missingHybridLender.game, missingHybridLender.borrower, [1, 3]);
const missingLenderOffer = legacyAcceptedContract(missingHybridLender, {
  toPlayerId: missingHybridLender.borrower.id,
  kind: 'hybrid',
  amount: 100,
  durationRounds: 2,
  propertyIndex: 1,
  conversionShare: 25,
  collateralTileIndices: [1, 3]
});
assert.equal(missingLenderOffer.success, true);
const missingLenderContract = missingHybridLender.game.playerContractById(missingLenderOffer.contract.id);
missingLenderContract.fromPlayerId = 'missing-lender';
missingHybridLender.game.handleBankruptcy(missingHybridLender.borrower, null);
assert.equal(missingLenderContract.status, 'defaulted');
assert.equal(missingHybridLender.game.getTile(1).ownerId, null);
assert.equal(missingHybridLender.game.getTile(3).ownerId, null);
assert.equal(missingHybridLender.game.defaultClaims[0].lenderId, 'missing-lender');
