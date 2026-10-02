// Regression suite B for the backend audit fixes, covering the bankruptcy
// module: B-03 (hybrid collateral re-validation), B-04 (obligations on every
// bankruptcy path), B-16 (plain-loan default claim) and B-17 (the claim
// ledger's production recovery path). Split from backend-fix-regressions.test.js
// so the two agents editing this campaign never write the same file.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { settleAfkPayment } from './socketRuntime.js';

const failures = [];
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

function startedRoom(options = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', ...options });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

function threeSeatRoom(options = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', ...options });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'c', clientId: 'c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

function ownDeeds(game, player, indices) {
  indices.forEach(index => {
    const tile = game.getTile(index);
    tile.ownerId = player.id;
    player.properties.push(tile.index);
  });
}

// The contract ladder reaches a default one step per round advance (due
// first, default past the cure turn), so walk it instead of pinning the
// exact step count.
function advanceUntilDefaulted(game, contract, maxRounds = 8) {
  for (let round = 0; round < maxRounds && contract.status !== 'defaulted'; round += 1) {
    game.advanceRound();
  }
  assert.equal(contract.status, 'defaulted', 'the loan defaults within a few round advances');
}

check('a hybrid note re-validates its pledged collateral basket at acceptance (B-03)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [lender, borrower] = game.players;
  const conversion = game.getTile(1);
  const pledged = game.getTile(3);
  ownDeeds(game, borrower, [conversion.index, pledged.index]);
  lender.cash = 5000;
  const offer = { toPlayerId: borrower.id, kind: 'hybrid', amount: 1000, premiumRate: 35, durationRounds: 2, propertyIndex: conversion.index, conversionShare: 25, collateralTileIndices: [pledged.index] };
  assert.equal(room.proposePlayerContract('a', offer).success, true);

  // The borrower mortgages the pledged deed while the offer sits pending:
  // the loan leg is secured against a deed that no longer exists.
  pledged.mortgaged = true;
  assert.deepEqual(room.respondPlayerContract('b', true, 'b03-mortgaged'), {
    success: false, error: 'The loan collateral is no longer available.'
  }, 'a hybrid must re-validate the basket the proposal checked, exactly like a loan');
  assert.equal(game.pendingPlayerContract, null);
  assert.equal(game.playerContracts.length, 0, 'the lender never funds against vanished security');
  assert.equal(lender.cash, 5000);
  assert.equal(borrower.cash, 1500);

  // The equity leg keeps its own rejection: mortgaging the conversion target
  // is still an equity rejection, not a loan one.
  pledged.mortgaged = false;
  assert.equal(room.proposePlayerContract('a', offer).success, true);
  conversion.mortgaged = true;
  assert.deepEqual(room.respondPlayerContract('b', true, 'b03-conversion-gone'), {
    success: false, error: 'The equity property is no longer available.'
  });

  // An intact basket still settles: the extra check cannot reject a valid
  // hybrid acceptance.
  conversion.mortgaged = false;
  const reoffer = room.proposePlayerContract('a', { ...offer, requestId: 'b03-clean' });
  assert.equal(reoffer.success, true);
  assert.equal(room.respondPlayerContract('b', true, 'b03-clean').success, true);
  assert.equal(lender.cash, 5000 - 1000, 'the lender funds the principal of a valid hybrid');
  assert.equal(borrower.cash, 1500 + 1000);
  assert.equal(game.playerContracts[0].collateralTileIndices.length, 1);
});

check('an AFK-forced bankruptcy releases the dead seat\'s table obligations (B-04)', () => {
  const room = threeSeatRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [, b, c] = game.players;
  assert.equal(room.proposeTrade('b', { toPlayerId: c.id, giveCash: 50, requestId: 'b04-trade' }).success, true);
  assert.notEqual(game.pendingTrade, null, 'the trade is live before the AFK seat exits');
  game.pendingPurchaseOffer = { playerId: b.id, tileIndex: 5 };
  b.cash = 100;
  game.pendingPayment = { playerId: b.id, creditorId: c.id, amountRemaining: 500, reason: 'rent' };

  // The AFK watchdog path: it reaches handleBankruptcy without the
  // declareBankruptcy preamble.
  assert.equal(settleAfkPayment(game, b), true);
  assert.equal(b.bankrupt, true);
  assert.equal(game.pendingTrade, null, 'a dead seat must not leave a trade gating the table');
  assert.equal(game.pendingPurchaseOffer, null);
  assert.equal(game.pendingPayment, null);
  assert.equal(room.proposeTrade('a', { toPlayerId: c.id, giveCash: 25, requestId: 'b04-survivor' }).success, true,
    'survivors are not blocked by the departed seat\'s obligations');
});

check('an unsettled-payment bankruptcy releases the dead seat\'s pending contract (B-04)', () => {
  const room = threeSeatRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [, b, c] = game.players;
  ownDeeds(game, b, [3]);
  const offer = game.proposePlayerContract('a', {
    toPlayerId: b.id, kind: 'loan', amount: 200, durationRounds: 2, collateralTileIndices: [3]
  });
  assert.equal(offer.success, true);
  assert.notEqual(game.pendingPlayerContract, null);
  b.disconnected = true;
  b.cash = 100;
  game.pendingPayment = { playerId: b.id, creditorId: c.id, amountRemaining: 500, reason: 'rent' };

  // gameLogic.trySettlePendingPayment reaches handleBankruptcy directly.
  assert.equal(game.trySettlePendingPayment(), false);
  assert.equal(b.bankrupt, true);
  assert.equal(game.pendingPlayerContract, null, 'a dead seat must not leave a contract gating the table');
  const survivor = game.proposePlayerContract('a', { toPlayerId: c.id, kind: 'loan', amount: 150, durationRounds: 2 });
  assert.equal(survivor.success, true, 'survivors can negotiate again after a forced bankruptcy');
});

check('a plain player-loan bankruptcy records the lender\'s default claim (B-16)', () => {
  const room = startedRoom({ rulesetPreset: 'after-hours' });
  const game = room.game;
  const [lender, borrower] = game.players;
  const pledged = game.getTile(3);
  ownDeeds(game, borrower, [pledged.index]);
  lender.cash = 5000;
  const offer = game.proposePlayerContract('a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 1000, premiumRate: 35, durationRounds: 2,
    collateralTileIndices: [pledged.index]
  });
  assert.equal(offer.success, true);
  assert.equal(game.respondPlayerContract('b', true, 'b16-accept').success, true);
  const contract = game.playerContractById(offer.contract.id);
  assert.equal(contract.remaining, 1350);
  const lenderCashBefore = lender.cash;

  game.handleBankruptcy(borrower, null);

  assert.equal(contract.status, 'defaulted');
  assert.equal(contract.defaultedPrincipal, 1350, 'the unpaid principal survives on the contract');
  const claim = game.defaultClaims.find(entry => entry.contractId === contract.id);
  assert.notEqual(claim, undefined, 'a plain loan defaults into the claim ledger exactly like a hybrid');
  assert.equal(claim.principal, 1350);
  assert.equal(claim.remaining, 1350);
  assert.equal(claim.status, 'open');
  assert.equal(claim.lenderId, lender.id);
  assert.equal(claim.borrowerId, borrower.id);
  assert.deepEqual(claim.collateralTileIndices, [pledged.index]);
  assert.equal(contract.defaultClaimId, claim.id);
  // The seizure happens exactly once: the default helper refuses a bankrupt
  // borrower and the basket re-walk is guarded by ownership.
  assert.equal(pledged.ownerId, lender.id);
  assert.equal(lender.properties.filter(index => index === pledged.index).length, 1);
  assert.equal(lender.cash, lenderCashBefore, 'bankruptcy itself moves no cash for the claim');
});

check('a matured default claim is collected the next time the table resolves a debt (B-17)', () => {
  const room = startedRoom();
  const game = room.game;
  const [lender, borrower] = game.players;
  const offer = game.proposePlayerContract('a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 1000, premiumRate: 35, durationRounds: 2
  });
  assert.equal(offer.success, true);
  assert.equal(game.respondPlayerContract('b', true, 'b17-accept').success, true);
  const contract = game.playerContractById(offer.contract.id);
  const lenderAfterFunding = lender.cash;
  const borrowerAfterFunding = borrower.cash;
  assert.equal(lenderAfterFunding, 500);
  assert.equal(borrowerAfterFunding, 2500);

  advanceUntilDefaulted(game, contract);
  const claim = game.defaultClaims.find(entry => entry.contractId === contract.id);
  assert.notEqual(claim, undefined, 'the live default path files the claim');
  assert.equal(claim.remaining, 1350);
  assert.equal(claim.status, 'open', 'the defaulting round records the claim instead of charging it');
  game.advanceRound();
  assert.equal(claim.status, 'open', 'a quiet round never collects: there is no client verb to drive one');

  // The next table debt beat pays it, with no socket verb and no client
  // change: a second default runs the ledger sweep.
  const second = game.proposePlayerContract('a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 200, premiumRate: 0, durationRounds: 2
  });
  assert.equal(second.success, true, 'the matured claim never gates the table');
  assert.equal(game.respondPlayerContract('b', true, 'b17-second').success, true);
  const lenderBeforeSweep = lender.cash;
  const borrowerBeforeSweep = borrower.cash;
  advanceUntilDefaulted(game, game.playerContractById(second.contract.id));

  assert.equal(claim.status, 'settled');
  assert.equal(claim.remaining, 0);
  assert.equal(lender.cash, lenderBeforeSweep + 1350, 'the lender recovers the defaulted principal');
  assert.equal(borrower.cash, borrowerBeforeSweep - 1350, 'collection moves cash, it never mints or burns it');
  assert.equal(claim.settledRound > claim.createdRound, true);
  assert.equal(Number.isInteger(lender.cash) && Number.isInteger(borrower.cash), true);
  assert.equal(game.feed.some(entry => entry.text === `B paid $${claim.principal} toward a default claim.`), true);
  assert.equal(lenderAfterFunding + borrowerAfterFunding, 3000);
});

check('a matured claim is also collected by the next bankruptcy on the table (B-17)', () => {
  const room = threeSeatRoom();
  const game = room.game;
  const [lender, borrower, other] = game.players;
  const offer = game.proposePlayerContract('a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 400, premiumRate: 50, durationRounds: 2
  });
  assert.equal(offer.success, true);
  assert.equal(game.respondPlayerContract('b', true, 'b17-beat-accept').success, true);
  const contract = game.playerContractById(offer.contract.id);
  advanceUntilDefaulted(game, contract);
  const claim = game.defaultClaims.find(entry => entry.contractId === contract.id);
  assert.equal(claim.remaining, 600);
  const lenderCash = lender.cash;
  const borrowerCash = borrower.cash;

  game.roundNumber += 1;
  game.handleBankruptcy(other, null);

  assert.equal(claim.status, 'settled', 'the bankruptcy ladder sweeps matured claims');
  assert.equal(lender.cash, lenderCash + 600);
  assert.equal(borrower.cash, borrowerCash - 600);
  assert.equal(borrower.bankrupt, false);
});

check('an unaffordable default claim stays open and never forces a payment (B-17)', () => {
  const room = threeSeatRoom();
  const game = room.game;
  const [lender, borrower, other] = game.players;
  const offer = game.proposePlayerContract('a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 1000, premiumRate: 35, durationRounds: 2
  });
  assert.equal(offer.success, true);
  assert.equal(game.respondPlayerContract('b', true, 'b17-broke-accept').success, true);
  const contract = game.playerContractById(offer.contract.id);
  borrower.cash = 10;

  advanceUntilDefaulted(game, contract);
  game.advanceRound();
  const second = game.proposePlayerContract('a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 100, premiumRate: 0, durationRounds: 2
  });
  assert.equal(second.success, true);
  assert.equal(game.respondPlayerContract('b', true, 'b17-broke-second').success, true);
  const lenderCash = lender.cash;
  const borrowerCash = borrower.cash;
  assert.equal(borrowerCash < 1350, true, 'the borrower still cannot cover the matured claim');
  advanceUntilDefaulted(game, game.playerContractById(second.contract.id));
  game.handleBankruptcy(other, null);

  const claim = game.defaultClaims.find(entry => entry.contractId === contract.id);
  assert.equal(claim.status, 'open', 'a claim the borrower cannot cover in full stays open');
  assert.equal(claim.remaining, 1350);
  assert.equal(lender.cash, lenderCash);
  assert.equal(borrower.cash, borrowerCash, 'the server never strips a seat below what it holds');
  assert.equal(borrower.bankrupt, false);
});

if (failures.length) {
  console.error(`\nbackend audit regressions B: ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log('backend audit regressions B: all passed');
}
