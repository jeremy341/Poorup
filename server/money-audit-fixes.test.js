// Regression suite for the money / debt / loan / contract / market audit fixes
// (reports s01, s02, s04, s05, s07). Every check drives the public GameState
// or Room verbs the socket handlers call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoomManager } from './gameLogic.js';
import { TelemetryStore } from './telemetryModule.js';
import { netWorth, netWorthBreakdown } from './netWorth.js';
import { ROUND_LIMIT } from './gameData.js';
import { AUCTION_DURATION_MS } from './auctionApi.js';
import { isSponsorshipActor, sponsorshipBuyerShouldCancel } from './sponsorshipLogic.js';

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

function seatedRoom(count = 3, overrides = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 's-a', clientId: 'c-a', nickname: 'A', ...overrides });
  for (let index = 1; index < count; index += 1) {
    const letter = 'abcdef'[index];
    room.addOrReconnectPlayer({ socketId: `s-${letter}`, clientId: `c-${letter}`, nickname: letter.toUpperCase() });
  }
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

// ---- S04-1: the departing debtor's cash belongs to its creditor ----------
check('S04-1: a bankrupt debtor\'s cash goes to the creditor, not to a third-party default claim', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b, c] = game.players;
  game.roundNumber = 5;
  game.defaultClaims = [{ id: 'claim_x', contractId: 'x', lenderId: a.id, borrowerId: b.id, principal: 100, remaining: 100, status: 'open', createdRound: 2 }];
  b.cash = 150;
  game.pendingPayment = { playerId: b.id, creditorId: c.id, amountRemaining: 200, reason: 'rent' };
  const aBefore = a.cash;
  const cBefore = c.cash;
  assert.equal(room.declareBankruptcy('s-b').success, true);
  assert.equal(c.cash - cBefore, 150, 'the creditor receives the whole estate cash');
  assert.equal(a.cash, aBefore, 'a lender with a matured claim is not paid out of the dead seat');
  assert.equal(game.defaultClaims[0].status, 'open', 'the claim stays an unpaid write-off record');
});

// ---- S04-2: claim sweep respects reserved cash and unpaid debts ----------
function claimFor(a, b, round = 2) {
  return { id: 'claim_x', contractId: 'x', lenderId: a.id, borrowerId: b.id, principal: 100, remaining: 100, status: 'open', createdRound: round };
}

check('S04-2: a matured claim is never collected from the cash behind a leading auction bid', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b, c] = game.players;
  game.roundNumber = 5;
  game.defaultClaims = [claimFor(a, b)];
  b.cash = 120;
  game.auction = { active: true, highestBid: 100, highestBidderId: b.id, participants: [a.id, b.id, c.id], propertyTile: game.getTile(1) };
  game.handleBankruptcy(c, null);
  assert.equal(b.cash, 120, 'the leading bid stays funded');
  assert.equal(game.defaultClaims[0].status, 'open');
});

check('S04-2: a matured claim is never collected from a seat that still owes a pending payment', () => {
  const room = seatedRoom(4);
  const game = room.game;
  const [a, b, c, d] = game.players;
  game.roundNumber = 5;
  game.defaultClaims = [claimFor(a, b)];
  b.cash = 150;
  game.pendingPayment = { playerId: b.id, creditorId: c.id, amountRemaining: 200, reason: 'rent' };
  const aBefore = a.cash;
  game.handleBankruptcy(d, null);
  assert.equal(b.cash, 150);
  assert.equal(a.cash, aBefore);
  assert.equal(game.defaultClaims[0].status, 'open');
});

check('S04-2: a matured claim is never collected from a seat with a queued debt', () => {
  const room = seatedRoom(4);
  const game = room.game;
  const [a, b, c, d] = game.players;
  game.roundNumber = 5;
  game.defaultClaims = [claimFor(a, b)];
  b.cash = 150;
  game.pendingPayment = { playerId: c.id, creditorId: a.id, amountRemaining: 30, reason: 'rent' };
  game.pendingPaymentQueue = [{ payment: { playerId: b.id, creditorId: c.id, amountRemaining: 200, reason: 'rent' }, hooks: {}, turnOptions: {} }];
  game.handleBankruptcy(d, null);
  assert.equal(b.cash, 150);
  assert.equal(game.defaultClaims[0].status, 'open');
});

check('S04-2: a claim is still collected from a solvent seat with free cash', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b, c] = game.players;
  game.roundNumber = 5;
  game.defaultClaims = [claimFor(a, b)];
  b.cash = 300;
  game.auction = { active: true, highestBid: 100, highestBidderId: b.id, participants: [a.id, b.id, c.id], propertyTile: game.getTile(1) };
  game.handleBankruptcy(c, null);
  assert.equal(b.cash, 200);
  assert.equal(game.defaultClaims[0].status, 'settled');
});

// ---- S04-3: net worth counts debts parked in the payment queue -----------
check('S04-3: net worth subtracts a pending payment and any queued debts of the same seat', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b, c] = game.players;
  const before = netWorthBreakdown(game, a).total;
  game.pendingPayment = { playerId: a.id, creditorId: b.id, amountRemaining: 120, reason: 'rent' };
  game.pendingPaymentQueue = [
    { payment: { playerId: a.id, creditorId: c.id, amountRemaining: 30, reason: 'card' }, hooks: {}, turnOptions: {} },
    { payment: { playerId: b.id, creditorId: c.id, amountRemaining: 999, reason: 'other seat' }, hooks: {}, turnOptions: {} }
  ];
  const breakdown = netWorthBreakdown(game, a);
  assert.equal(breakdown.pendingDebt, -150);
  assert.equal(breakdown.total, before - 150);
  assert.equal(Math.abs(netWorthBreakdown(game, c).pendingDebt), 0);
});

check('S04-3: a bank default that parks its balance as a pending payment does not raise net worth', () => {
  const room = seatedRoom(3, { rulesetOverrides: { bankLoans: true } });
  const game = room.game;
  const [a] = game.players;
  a.cash = 40;
  a.bankLoan = { id: 'loan-1', status: 'active', principal: 300, remaining: 450, collateralTileIndex: null, dueRound: 1 };
  const before = netWorthBreakdown(game, a).total;
  game.pendingPayment = { playerId: a.id, creditorId: null, amountRemaining: 450, reason: 'bank' };
  a.bankLoan.status = 'defaulted';
  a.bankLoan.remaining = 0;
  assert.equal(netWorthBreakdown(game, a).total, before, 'the debt only moved from the loan to the payment queue');
});

check('S04-3: unsecured bank default balance is counted once in positive net worth', () => {
  const room = seatedRoom(2, { rulesetOverrides: { bankLoans: true } });
  const game = room.game;
  const [a] = game.players;
  const deedIndices = [21, 23, 24, 26, 27, 29, 31, 32, 34, 37, 39];
  a.properties = [...deedIndices];
  for (const index of deedIndices) {
    const deed = game.getTile(index);
    deed.ownerId = a.id;
    deed.mortgaged = true;
    deed.houseCount = 0;
  }
  a.cash = 40;
  assert.equal(game.bankLoanTerms(a).collateralTileIndex, null, 'the mortgaged portfolio leaves no loan collateral');
  assert.equal(game.takeBankLoan('s-a', 'unsecured-networth-issue').success, true);
  assert.equal(game.repayBankLoan('s-a', { amount: 300, requestId: 'unsecured-networth-repay' }).success, true);
  assert.equal(a.bankLoan.remaining, 150);

  game.roundNumber = 3;
  a.bankLoan.status = 'due';
  a.bankLoan.dueRound = 1;
  a.bankLoan.cureRound = 2;
  game.processBankLoans();

  const after = netWorthBreakdown(game, a);
  assert.equal(game.pendingPayment.amountRemaining, 110);
  assert.equal(a.bankLoan.remaining, 110, 'the default hook mirrors the unpaid pending claim in the loan ledger');
  assert.equal(Math.abs(after.bankLoan), 0, 'the defaulted loan is represented by the pending claim');
  assert.equal(after.pendingDebt, -110);
  assert.equal(after.total, 1490, 'deeds worth 1600 less the single 110 claim');
  assert.equal(netWorth(game, a), 1490, 'the positive net worth remains above the clamp');
});

check('S04-3: a lender does not count a receivable from a borrower who owes a pending payment', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b] = game.players;
  game.playerContracts.push({ id: 'loan-x', kind: 'loan', status: 'active', fromPlayerId: a.id, toPlayerId: b.id, amount: 100, remaining: 100 });
  const solvent = netWorthBreakdown(game, a).contracts;
  assert.equal(solvent, 100);
  game.pendingPayment = { playerId: b.id, creditorId: null, amountRemaining: 10, reason: 'tax' };
  assert.equal(netWorthBreakdown(game, a).contracts, 0);
});

// ---- S04-4: bank-loan premium has no float drift -------------------------
check('S04-4: the bank-loan premium is the exact ceiling of principal x rate', () => {
  const room = seatedRoom(2, { rulesetOverrides: { bankLoans: true } });
  const game = room.game;
  const player = game.players[0];
  const premiumFor = (severity, event) => {
    game.settings.bankLoanSeverity = severity;
    game.globalEvent = event;
    return game.bankLoanTerms(player).premium;
  };
  const bankFirst = { id: 'city-election', phase: 'active', resolvedChoice: 'bank-first', effects: {} };
  const stagflation = { id: 'stagflation', phase: 'active', effects: { loanPremiumMultiplier: 1.5 } };
  assert.equal(premiumFor('fair', null), 60);
  assert.equal(premiumFor('predatory', null), 150);
  assert.equal(premiumFor('fair', bankFirst), 48);
  assert.equal(premiumFor('extreme', bankFirst), 192);
  assert.equal(premiumFor('fair', stagflation), 90);
  assert.equal(premiumFor('extreme', stagflation), 360);
});

// ---- S04-6: bank account upgrade idempotency and debts -------------------
check('S04-6: a padded request id replays the first upgrade instead of buying a second tier', () => {
  const room = seatedRoom(2, { rulesetOverrides: { bankAccountUpgrades: true } });
  const game = room.game;
  const a = game.players[0];
  a.cash = 2000;
  assert.equal(game.upgradeBankAccount('s-a', 'req-1').success, true);
  const replay = game.upgradeBankAccount('s-a', ' req-1 ');
  assert.equal(replay.duplicate, true);
  assert.equal(a.bankAccount.tier, 2);
  assert.equal(a.cash, 1800);
});

check('S04-6: a seat that owes a pending payment cannot spend its cash on an upgrade', () => {
  const room = seatedRoom(2, { rulesetOverrides: { bankAccountUpgrades: true } });
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 300;
  game.pendingPayment = { playerId: a.id, creditorId: b.id, amountRemaining: 250, reason: 'rent' };
  const result = game.upgradeBankAccount('s-a', 'x');
  assert.equal(result.success, false);
  assert.equal(a.cash, 300);
  assert.equal(a.bankAccount?.tier ?? 1, 1);
});

// ---- S07-1: the round-limit winner is picked after positions settle ------
check('S07-1: the round-limit winner is the richest seat after market settlement', () => {
  const room = seatedRoom(2, { rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true }, marketComplexity: 'margin' });
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 5000;
  b.cash = 5000;
  assert.equal(game.openMargin('s-a', 'brazil', 50, 'x').success, true);
  b.cash += netWorth(game, a) - netWorth(game, b) - 1;
  assert.equal(netWorth(game, a) - netWorth(game, b), 1, 'A leads by a dollar before settlement');
  game.roundNumber = ROUND_LIMIT + 1;
  assert.equal(game.endForRoundLimit(), true);
  assert.equal(netWorth(game, b) > netWorth(game, a), true, 'margin settles at a haircut, so B is ahead afterwards');
  assert.equal(game.lastWinner.id, b.id);
});

// ---- S07: market verbs ---------------------------------------------------
function marketRoom(complexity) {
  const room = seatedRoom(2, { rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true }, marketComplexity: complexity });
  return room;
}

check('S07-2: market telemetry records the validated instrument id, never the raw client string', () => {
  const room = marketRoom('shorting');
  const game = room.game;
  const player = game.players[0];
  const padded = ' '.repeat(5000) + 'BRAZIL ';
  const kinds = [];
  assert.equal(game.openMargin('s-a', padded, 1, 'm1').success, true);
  player.marketActionsThisTurn = 0;
  assert.equal(game.openShort('s-a', ['brazil'], 1, 's1').success, true);
  player.marketActionsThisTurn = 0;
  assert.equal(game.coverShort('s-a', '  Brazil', 1, 'c1').success, true);
  game.telemetryLog.filter(entry => entry.kind === 'market-volatility' && entry.data.instrumentId).forEach(entry => kinds.push(entry.data.instrumentId));
  assert.deepEqual(kinds, ['brazil', 'brazil', 'brazil']);
});

check('S07-4: reducing margin by a non-positive or non-numeric amount names the amount, not the balance', () => {
  const room = marketRoom('margin');
  const game = room.game;
  const player = game.players[0];
  assert.equal(game.openMargin('s-a', 'brazil', 2, 'm1').success, true);
  player.marketActionsThisTurn = 0;
  for (const amount of [0, 'abc', -5, null]) {
    const result = game.reduceMargin('s-a', amount, 'r-' + String(amount));
    assert.equal(result.success, false);
    assert.equal(result.error, 'Enter a whole amount to repay.');
  }
  assert.equal(game.reduceMargin('s-a', 10, 'r-ok').success, true);
});

check('S07-5: a forced liquidation produces a telemetry event the store accepts', () => {
  const room = marketRoom('shorting');
  const game = room.game;
  const player = game.players[0];
  player.shortPositions.brazil = { quantity: 1, entryQuote: 1, collateral: 5, borrowFee: 1 };
  player.reservedCash = 5;
  game.advanceMarket();
  const event = game.telemetryLog.find(entry => entry.kind === 'market-liquidation');
  assert.ok(event, 'the forced buy-in is logged');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-money-tele-'));
  const store = new TelemetryStore(path.join(dir, 'telemetry.json'));
  try {
    const recorded = store.record(event.kind, { ...event.data, roundNumber: event.roundNumber });
    assert.equal(recorded.recorded, true, recorded.error);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- S04-7: short buy-in debt settlement ---------------------------------
check('S04-7: a rejected short-default payment is not replayed under the same request id', () => {
  const room = marketRoom('shorting');
  const game = room.game;
  const player = game.players[0];
  player.shortDefaultDebt = 100;
  player.cash = 500;
  assert.equal(game.settleShortDefault('s-a', -5, 'same-id').success, false);
  const retry = game.settleShortDefault('s-a', 5, 'same-id');
  assert.equal(retry.success, true, 'the corrected amount executes');
  assert.equal(player.shortDefaultDebt, 95);
});

check('S04-7: short-default repayment never dips into a leading auction bid', () => {
  const room = marketRoom('shorting');
  const game = room.game;
  const [a, b] = game.players;
  a.shortDefaultDebt = 100;
  a.cash = 150;
  game.auction = { active: true, highestBid: 120, highestBidderId: a.id, participants: [a.id, b.id], propertyTile: game.getTile(1) };
  const result = game.settleShortDefault('s-a', 100, 'bid-1');
  assert.equal(result.success, true);
  assert.equal(result.paid, 30, 'only the unreserved 30 is payable');
  assert.equal(a.cash, 120, 'the leading bid stays funded');
  assert.equal(a.shortDefaultDebt, 70);
});

// ---- S07-8: a stale crisis-buy reference is dropped with its position ----
check('S07-8: a crisis buy sold off at a loss does not seed a later profit flag', () => {
  const room = marketRoom('basic');
  const game = room.game;
  const a = game.players[0];
  a.cash = 10_000;
  game.globalEvent = { id: 'crash', phase: 'active', effects: { marketPriceMultiplier: 0.5 } };
  game.marketQuotes.brazil = 20;
  assert.equal(game.tradeMarket('s-a', 'brazil', 'buy', 1).success, true);
  a.marketActionsThisTurn = 0;
  game.marketQuotes.brazil = 15;
  assert.equal(game.tradeMarket('s-a', 'brazil', 'sell', 1).success, true);
  a.marketActionsThisTurn = 0;
  game.marketQuotes.brazil = 60;
  assert.equal(game.tradeMarket('s-a', 'brazil', 'buy', 1).success, true);
  game.globalEvent = null;
  a.marketActionsThisTurn = 0;
  game.marketQuotes.brazil = 50;
  assert.equal(game.tradeMarket('s-a', 'brazil', 'sell', 1).success, true);
  assert.equal(a.crisisMarketProfit, false, 'selling at 50 after buying at 60 is a loss');
});

// ---- S01-01 / S01-02: rescue cash settles the parked debts ---------------
function rentDebtRoom(count = 2, overrides = {}) {
  const room = seatedRoom(count, overrides);
  const game = room.game;
  const [a, b] = game.players;
  game.hasRolled = true;
  a.cash = 0;
  b.cash = 1000;
  game.tiles[37].ownerId = b.id;
  b.properties.push(37);
  game.tiles[37].houseCount = 1;
  a.position = 34;
  game.applyTile(a, game.getTile(37), {});
  assert.ok(game.pendingPayment, 'A landed on rent it cannot pay');
  return { room, game, a, b };
}

check('S01-01: a bank loan taken to cover a parked debt settles that debt', () => {
  const { game, a, b } = rentDebtRoom(2, { rulesetOverrides: { bankLoans: true } });
  const owed = game.pendingPayment.amountRemaining;
  const bCash = b.cash;
  assert.equal(game.takeBankLoan('s-a', 'rescue-1').success, true);
  assert.equal(game.pendingPayment, null, 'the debt is paid from the borrowed cash');
  assert.equal(b.cash, bCash + owed);
  assert.equal(a.cash, 300 - owed);
  assert.equal(game.endTurnRejection(a), null, 'the roll resolved, so the seat can end its turn');
});

check('S01-01: an accepted player loan settles the borrowers parked debt', () => {
  const { game, a } = rentDebtRoom(2);
  a.properties.push(3);
  game.tiles[3].ownerId = a.id;
  const owed = game.pendingPayment.amountRemaining;
  const offer = game.proposePlayerContract('s-b', { toPlayerId: a.id, kind: 'loan', amount: 300, premiumRate: 10, durationRounds: 3, collateralTileIndex: 3, requestId: 'x1' });
  assert.equal(offer.success, true, offer.error);
  assert.equal(game.respondPlayerContract('s-a', true, 'y1').success, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(a.cash, 300 - owed);
  assert.equal(game.endTurnRejection(a), null);
});

check('S01-01: a loan too small for the debt leaves it parked', () => {
  const { game, a } = rentDebtRoom(2, { rulesetOverrides: { bankLoans: true } });
  game.pendingPayment.amountRemaining = 500;
  assert.equal(game.takeBankLoan('s-a', 'rescue-2').success, true);
  assert.equal(game.pendingPayment.amountRemaining, 500);
  assert.equal(a.cash, 300);
});

check('S01-02: queued pay-each debts settle in one pass once the debtor holds the cash', () => {
  const room = seatedRoom(4);
  const game = room.game;
  const [a, ...others] = game.players;
  game.hasRolled = true;
  a.cash = 20;
  others.forEach(player => { player.cash = 1000; });
  game.applyCard(a, { action: 'payEach', amount: 50, text: 'Elected chairperson' }, {});
  assert.equal(game.pendingPayment.amountRemaining, 30);
  assert.equal(game.pendingPaymentQueue.length, 2);
  a.cash = 270;
  assert.equal(game.trySettlePendingPayment(), true);
  assert.equal(game.pendingPayment, null, 'the whole queue cleared');
  assert.equal(game.pendingPaymentQueue.length, 0);
  assert.equal(a.cash, 270 - 30 - 50 - 50);
  assert.equal(game.endTurnRejection(a), null);
});

check('S01-02: a queued debt the debtor cannot cover yet stays parked', () => {
  const room = seatedRoom(4);
  const game = room.game;
  const [a, ...others] = game.players;
  game.hasRolled = true;
  a.cash = 20;
  others.forEach(player => { player.cash = 1000; });
  game.applyCard(a, { action: 'payEach', amount: 50, text: 'Elected chairperson' }, {});
  a.cash = 60;
  game.trySettlePendingPayment();
  assert.equal(a.cash, 30, 'only the head claim was affordable');
  assert.equal(game.pendingPayment.amountRemaining, 50);
  assert.equal(game.pendingPayment.playerId, a.id);
  assert.equal(game.pendingPaymentQueue.length, 1, 'the head was promoted and one claim waits behind it');
});

// ---- S02 F1 (bankruptcyLogic half): the creditor leaves a parked debt ----
check('S02-F1: a creditor declaring bankruptcy resolves the debtor roll its debt was holding', () => {
  const { room, game, a, b } = rentDebtRoom(3);
  assert.equal(game.pendingPayment.creditorId, b.id);
  assert.equal(game.awaitingEndTurn, false, 'the roll is unresolved while the debt is parked');
  a.cash = 10;
  assert.equal(room.declareBankruptcy('s-b').success, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.currentPlayerId, a.id);
  assert.equal(game.endTurnRejection(a), null, 'the debtor can end the turn instead of being wedged');
});

check('S02-F1: a creditor leaving an off-turn debt does not resolve the current roll', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b, c] = game.players;
  game.hasRolled = true;
  game.pendingPayment = { playerId: c.id, creditorId: b.id, amountRemaining: 50, reason: 'bank loan' };
  assert.equal(room.declareBankruptcy('s-b').success, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.awaitingEndTurn, false, 'the current roll was not the one this debt belonged to');
  assert.equal(game.currentPlayerId, a.id);
});

// ---- S05-01: contract terms start when the offer is accepted -------------
function ownDeed(game, player, index) {
  game.getTile(index).ownerId = player.id;
  player.properties.push(index);
}

check('S05-01: a loan accepted rounds after the offer runs its full term from acceptance', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [, b, c] = game.players;
  game.currentPlayerId = c.id;
  ownDeed(game, b, 3);
  const offer = game.proposePlayerContract('s-a', { toPlayerId: b.id, kind: 'loan', amount: 100, premiumRate: 10, durationRounds: 3, collateralTileIndices: [3], requestId: 'l1' });
  assert.equal(offer.success, true, offer.error);
  game.roundNumber += 5;
  const accepted = game.respondPlayerContract('s-b', true, 'acc1', offer.contract.id);
  assert.equal(accepted.success, true, accepted.error);
  assert.equal(accepted.contract.dueRound, game.roundNumber + 3);
  assert.equal(accepted.contract.cureRound, game.roundNumber + 4);
  game.advanceRound();
  game.advanceRound();
  assert.equal(accepted.contract.status, 'active', 'two rounds into a three round term is not overdue');
  assert.equal(game.getTile(3).ownerId, b.id, 'the pledged deed is still the borrowers');
});

check('S05-01: an equity deal accepted late keeps its full term', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [, b, c] = game.players;
  game.currentPlayerId = c.id;
  ownDeed(game, b, 1);
  const offer = game.proposePlayerContract('s-a', { toPlayerId: b.id, kind: 'equity', amount: 300, durationRounds: 3, propertyIndex: 1, equityShare: 40, requestId: 'e1' });
  assert.equal(offer.success, true, offer.error);
  game.roundNumber += 4;
  const accepted = game.respondPlayerContract('s-b', true, 'acc2', offer.contract.id);
  assert.equal(accepted.success, true, accepted.error);
  assert.equal(accepted.contract.expiresRound, game.roundNumber + 3);
  game.advanceRound();
  assert.equal(accepted.contract.status, 'active');
  assert.equal(game.getTile(1).equityShares.length, 1);
});

check('S05-01: permanent new equity is rejected and saved permanent equity remains active', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b, c] = game.players;
  game.currentPlayerId = c.id;
  ownDeed(game, b, 1);
  const offer = game.proposePlayerContract('s-a', { toPlayerId: b.id, kind: 'equity', amount: 300, durationRounds: 3, propertyIndex: 1, equityShare: 40, permanent: true, requestId: 'e2' });
  assert.deepEqual(offer, { success: false, error: 'Rent shares must be temporary, for 1 to 20 rounds.' });
  assert.equal(game.pendingPlayerContract, null);
  const legacy = { id: 'legacy-permanent', kind: 'equity', status: 'active', fromPlayerId: a.id, toPlayerId: b.id, amount: 300, propertyIndex: 1, equityShare: 40, permanent: true, expiresRound: null };
  game.playerContracts.push(legacy);
  game.getTile(1).equityShares = [{ contractId: legacy.id, holderId: a.id, share: 40 }];
  game.roundNumber += 30;
  game.processPlayerContracts();
  assert.equal(legacy.status, 'active', 'saved permanent agreements do not expire');
  assert.equal(legacy.expiresRound, null);
  assert.equal(game.getTile(1).equityShares[0].share, 40);
});

// ---- S05-03: an unanswered contract offer lapses -------------------------
check('S05-03: an unanswered contract offer expires and releases the table', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [, b, c] = game.players;
  game.currentPlayerId = c.id;
  const offer = game.proposePlayerContract('s-a', { toPlayerId: b.id, kind: 'loan', amount: 1, premiumRate: 0, durationRounds: 3, requestId: 'frz' });
  assert.equal(offer.success, true, offer.error);
  assert.equal(game.tableObligationPending(), true);
  const created = Number(game.pendingPlayerContract.createdAt);
  assert.equal(Number.isFinite(created), true, 'the offer is time-stamped');
  assert.equal(game.expireStaleContract(created + 1000, 120_000), false, 'a fresh offer stays');
  assert.ok(game.pendingPlayerContract);
  assert.equal(game.expireStaleContract(created + 120_000, 120_000), true);
  assert.equal(game.pendingPlayerContract, null);
  assert.equal(game.tableObligationPending(), false);
  assert.equal(game.expireStaleContract(created + 999_999, 120_000), false, 'nothing left to expire');
});

check('S05-03: an unanswered equity-share transfer expires too', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b, c] = game.players;
  game.currentPlayerId = c.id;
  ownDeed(game, b, 1);
  // Restored active equity retains its transfer rights; new rent shares cannot resell.
  const equity = { id: 'legacy-transfer-source', kind: 'equity', status: 'active', fromPlayerId: a.id, toPlayerId: b.id, amount: 300, propertyIndex: 1, equityShare: 40, permanent: true, expiresRound: null };
  game.playerContracts.push(equity);
  game.getTile(1).equityShares = [{ contractId: equity.id, holderId: a.id, share: 40 }];
  const transfer = game.proposeEquityShareTransfer('s-a', { fromPlayerId: a.id, toPlayerId: c.id, contractId: equity.id, sharePct: 20, price: 50, requestId: 'tr' });
  assert.equal(transfer.success, true, transfer.error);
  const created = Number(game.pendingPlayerContract.createdAt);
  assert.equal(game.expireStaleContract(created + 200_000, 120_000), true);
  assert.equal(game.pendingPlayerContract, null);
});

// ---- S05-04 / S05-05: sponsorship summary and equity top-up --------------
function sponsorFixture() {
  const room = seatedRoom(3);
  const game = room.game;
  const [buyer, investor, other] = game.players;
  const tile = game.getTile(1);
  buyer.cash = 20;
  investor.cash = 500;
  other.cash = 500;
  game.currentPlayerId = buyer.id;
  game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index };
  return { game, buyer, investor, other, tile };
}

check('S05-04: the sponsorship summary carries the request id the accept replay is keyed on', () => {
  const { game } = sponsorFixture();
  const requested = game.requestPurchaseSponsorship('s-a', { mode: 'equity', sharePct: 30, requestId: 'rid-77' });
  assert.equal(requested.success, true);
  assert.equal(requested.sponsorship.requestId, 'rid-77');
  assert.equal(game.summarySponsoredPurchase().requestId, 'rid-77');
});

check('S05-05: an equity investor who funded part of the need can top up and complete the purchase', () => {
  const { game, buyer, investor, other, tile } = sponsorFixture();
  assert.equal(game.requestPurchaseSponsorship('s-a', { mode: 'equity', sharePct: 30, requestId: 'rid-78' }).success, true);
  const need = tile.price - buyer.cash;
  assert.equal(game.contributeToSponsoredPurchase('s-b', { amount: 15 }).success, true);
  assert.equal(game.contributeToSponsoredPurchase('s-c', { amount: 1 }).success, false, 'still one investor');
  const topUp = game.contributeToSponsoredPurchase('s-b', { amount: need - 15 });
  assert.equal(topUp.success, true, topUp.error);
  assert.equal(game.pendingSponsoredPurchase.contributions.length, 1, 'one investor entry');
  assert.equal(game.pendingSponsoredPurchase.contributions[0].amount, need);
  assert.equal(investor.cash, 500 - need);
  assert.equal(game.acceptSponsoredPurchase('s-a', { requestId: 'rid-78' }).success, true);
  assert.equal(tile.ownerId, buyer.id);
  assert.equal(tile.equityShares.length, 1);
  assert.equal(other.cash, 500);
});

check('S05-05: gift sponsors still cannot contribute twice', () => {
  const { game } = sponsorFixture();
  assert.equal(game.requestPurchaseSponsorship('s-a').success, true);
  assert.equal(game.contributeToSponsoredPurchase('s-b', { amount: 10 }).success, true);
  assert.equal(game.contributeToSponsoredPurchase('s-b', { amount: 10 }).success, false);
});

// ---- S01-03: lobby capacity counts every retained seat -------------------
check('S01-03: a post-game lobby with eliminated seats retained is full at maxPlayers', () => {
  const room = seatedRoom(4);
  const game = room.game;
  const [a, d] = [game.players[0], game.players[3]];
  assert.equal(game.settings.maxPlayers, 4);
  game.declareBankruptcy(d.socketId);
  assert.equal(game.started, true);
  game.endGame(a);
  assert.equal(game.nonBankruptPlayers().length, 3);
  assert.equal(game.players.length, 4);
  assert.equal(game.canJoin(), false, 'the rematch revives all four seats, so no fifth fits');
  assert.equal(room.addOrReconnectPlayer({ socketId: 's-e', clientId: 'c-e', nickname: 'E' }).success, false);
});

check('S01-03: a running or fresh table keeps its existing join rules', () => {
  const room = seatedRoom(3);
  assert.equal(room.game.canJoin(), false, 'a started game admits nobody');
  const manager = new RoomManager();
  const lobby = manager.createRoom({ socketId: 's-a', clientId: 'c-a', nickname: 'A' });
  assert.equal(lobby.game.canJoin(), true);
});

// ---- S18-2: a bot buyer's request cannot park the table on a idle human --
check('S18-2: a bot buyer cancels an open request once no bot can fund it and the window has passed', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [human, buyer, sponsor] = game.players;
  buyer.cash = 20;
  human.cash = 1500;
  sponsor.cash = 1500;
  game.currentPlayerId = buyer.id;
  game.hasRolled = true;
  const tile = game.getTile(1);
  game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index, price: tile.price };
  assert.equal(game.requestPurchaseSponsorship(buyer.socketId).success, true);
  buyer.isBot = true;
  sponsor.isBot = true;
  sponsor.cash = 100; // below the 180 reserve: no bot can fund
  const sponsorship = game.pendingSponsoredPurchase;
  assert.equal(sponsorshipBuyerShouldCancel(game, buyer, sponsorship), false, 'a human with cash gets a window to fund first');
  assert.equal(isSponsorshipActor(game, buyer), false);
  sponsorship.createdAt = Date.now() - 31_000;
  assert.equal(sponsorshipBuyerShouldCancel(game, buyer, sponsorship), true, 'the window is wall-clock, since the round cannot advance');
  assert.equal(isSponsorshipActor(game, buyer), true, 'the buyer takes the seat to decline');
});

check('S18-2: a request a bot can still fund is never cancelled for age alone', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [human, buyer, sponsor] = game.players;
  buyer.cash = 20;
  human.cash = 1500;
  sponsor.cash = 1500;
  game.currentPlayerId = buyer.id;
  game.hasRolled = true;
  const tile = game.getTile(1);
  game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index, price: tile.price };
  assert.equal(game.requestPurchaseSponsorship(buyer.socketId).success, true);
  buyer.isBot = true;
  sponsor.isBot = true;
  game.pendingSponsoredPurchase.createdAt = Date.now() - 600_000;
  assert.equal(sponsorshipBuyerShouldCancel(game, buyer, game.pendingSponsoredPurchase), false);
});

// ---- S06-01: per-seat trade counters reset for a rematch -----------------
check('S06-01: a rematch starts every seat at zero completed trades', () => {
  const room = seatedRoom(2);
  const game = room.game;
  const [a, b] = game.players;
  a.tradesCompleted = 3;
  b.tradesCompleted = 2;
  game.tradesCompleted = 5;
  game.endGame(a);
  assert.equal(room.startGame().success, true);
  assert.equal(game.tradesCompleted, 0);
  assert.equal(a.tradesCompleted, 0);
  assert.equal(b.tradesCompleted, 0);
});

// ---- S06-05: revoking a leading bid restores the response window ---------
check('S06-05: a bankrupt leading bidder revoked bid gives the others a fresh bid window', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b, c] = game.players;
  const nearEnd = Date.now() + 200;
  game.auction = { active: true, highestBid: 100, highestBidderId: c.id, participants: [a.id, b.id, c.id], propertyTile: game.getTile(1), endsAt: nearEnd };
  const before = Date.now();
  game.handleBankruptcy(c, null);
  assert.equal(game.auction.highestBidderId, null);
  assert.equal(game.auction.endsAt >= before + AUCTION_DURATION_MS, true, 'the five second window restarts');
});

check('S06-05: a bankruptcy that does not hold the lead leaves the auction clock alone', () => {
  const room = seatedRoom(3);
  const game = room.game;
  const [a, b, c] = game.players;
  const endsAt = Date.now() + 200;
  game.auction = { active: true, highestBid: 100, highestBidderId: a.id, participants: [a.id, b.id, c.id], propertyTile: game.getTile(1), endsAt };
  game.handleBankruptcy(c, null);
  assert.equal(game.auction.endsAt, endsAt);
});

// ---- S05-06: equity is only sold on unencumbered deeds -------------------
function hybridOnDeed(basket) {
  const room = seatedRoom(3);
  const game = room.game;
  const [, b, c] = game.players;
  game.currentPlayerId = c.id;
  ownDeed(game, b, 1);
  ownDeed(game, b, 3);
  // Historical active hybrid: issuance is retired, but its pledged basket and conversion survive.
  const hybrid = { id: 'legacy-hybrid', kind: 'hybrid', status: 'active', fromPlayerId: game.players[0].id, toPlayerId: b.id, amount: 200, remaining: 200, totalDue: 200, premiumRate: 0, durationRounds: 2, dueRound: game.roundNumber + 2, propertyIndex: 1, conversionShare: 20, collateralTileIndices: basket };
  game.playerContracts.push(hybrid);
  return { game, b };
}

check('S05-06: a deed that is both a hybrid conversion target and pledged collateral takes no equity', () => {
  const { game, b } = hybridOnDeed([1]);
  assert.equal(game.isPlayerContractCollateral(b, game.getTile(1)), true);
  const equity = game.proposePlayerContract('s-c', { toPlayerId: b.id, kind: 'equity', amount: 300, durationRounds: 5, propertyIndex: 1, equityShare: 30, permanent: false, requestId: 'e1' });
  assert.equal(equity.success, false);
  assert.equal(equity.error, 'Rent shares need an unencumbered deed owned by the recipient.');
});

check('S05-06: an unpledged legacy hybrid target rejects a second investor and still converts', () => {
  const { game, b } = hybridOnDeed([3]);
  const equity = game.proposePlayerContract('s-c', { toPlayerId: b.id, kind: 'equity', amount: 300, durationRounds: 5, propertyIndex: 1, equityShare: 30, permanent: false, requestId: 'e2' });
  assert.deepEqual(equity, { success: false, error: 'A deed may have only one rent-share investor.' });
  const hybrid = game.playerContracts.find(contract => contract.id === 'legacy-hybrid');
  hybrid.status = 'due';
  hybrid.cureRound = game.roundNumber - 1;
  game.processPlayerContracts();
  assert.equal(hybrid.status, 'converted', 'the historical conversion right is honored');
  assert.equal(game.getTile(1).equityShares[0].share, 20);
});

if (failures.length) {
  console.error(`\nmoney audit fixes: ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log('money audit fixes: all passed');
}
