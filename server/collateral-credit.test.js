import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { handlePlayerLoanDefault, settleDefaultClaim } from './bankruptcyLogic.js';

function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'lender', clientId: 'lender', nickname: 'Lender' });
  room.addOrReconnectPlayer({ socketId: 'borrower', clientId: 'borrower', nickname: 'Borrower' });
  room.addOrReconnectPlayer({ socketId: 'other', clientId: 'other', nickname: 'Other' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
  room.setRoomSetting('bankLoans', true);
  assert.equal(room.startGame().success, true);
  const game = room.game, [lender, borrower, other] = game.players;
  game.currentPlayerId = borrower.id;
  return { manager, room, game, lender, borrower, other };
}
function own(ctx, indices, prices = []) {
  indices.forEach((index, position) => {
    const tile = ctx.game.getTile(index);
    tile.ownerId = ctx.borrower.id;
    if (prices[position] != null) tile.price = prices[position];
    ctx.borrower.properties.push(index);
  });
  ctx.game.refreshPlayerGroups(ctx.borrower);
}
function loan(ctx, amount = 300, indices = [1, 3]) {
  own(ctx, indices, indices.map(() => 60));
  const proposal = ctx.game.proposePlayerContract('lender', {
    toPlayerId: ctx.borrower.id, kind: 'loan', amount, premiumRate: 0,
    durationRounds: 1, collateralTileIndices: indices,
    collateralCreditVersion: 999, collateralCreditQuotes: [{ tileIndex: 1, value: 999999 }]
  });
  assert.equal(proposal.success, true, proposal.error);
  const acceptance = ctx.game.respondPlayerContract('borrower', true);
  assert.equal(acceptance.success, true, acceptance.error);
  ctx.contract = acceptance.contract;
  return ctx.contract;
}
function mature(ctx) {
  ctx.contract.status = 'due';
  ctx.game.roundNumber = ctx.contract.cureRound + 1;
  ctx.game.processPlayerContracts();
}
function fullLedger(ctx) {
  ctx.game.defaultClaims = Array.from({ length: 200 }, (_, index) => ({
    id: `full_${index}`, contractId: `full_${index}`, lenderId: ctx.lender.id,
    borrowerId: ctx.other.id, principal: 10, remaining: 10, status: 'open', createdRound: ctx.game.roundNumber
  }));
}
function snapshot(ctx) {
  return structuredClone({ players: ctx.game.players, tiles: ctx.game.tiles, contracts: ctx.game.playerContracts,
    claims: ctx.game.defaultClaims, feed: ctx.game.feed, pending: ctx.game.pendingPayment,
    queue: ctx.game.pendingPaymentQueue?.map(entry => entry.payment) });
}
const cases = [];
function check(name, fn) { cases.push([name, fn]); }
check('player credit uses locked server quotes and records only residual claim', () => {
  const ctx = fixture(), contract = loan(ctx);
  assert.equal(contract.collateralCreditVersion, 1);
  assert.deepEqual(contract.collateralCreditQuotes.map(quote => quote.value), [60, 60]);
  ctx.game.getTile(1).price = 999;
  ctx.game.getTile(3).price = 999;
  const cash = [ctx.borrower.cash, ctx.lender.cash];
  mature(ctx);
  assert.equal(contract.defaultedPrincipal, 300);
  assert.equal(contract.collateralCreditApplied, 120);
  assert.deepEqual(contract.collateralSeizedTileIndices, [1, 3]);
  assert.equal(contract.residualDebt, 180);
  assert.equal(contract.remaining, 180);
  assert.equal(ctx.game.defaultClaims[0].principal, 180);
  assert.equal(ctx.game.defaultClaims[0].remaining, 180);
  assert.deepEqual([ctx.borrower.cash, ctx.lender.cash], cash);
  assert.equal(settleDefaultClaim(ctx.game, contract.id, 30).success, true);
  assert.equal(contract.residualDebt, 150);
  assert.equal(contract.remaining, 150);
});
check('fully covered player debt seizes only enough deeds and pays no excess', () => {
  const ctx = fixture(), contract = loan(ctx, 50);
  const cash = [ctx.borrower.cash, ctx.lender.cash];
  mature(ctx);
  assert.equal(contract.collateralCreditApplied, 50);
  assert.equal(contract.remaining, 0);
  assert.equal(contract.residualDebt, 0);
  assert.deepEqual(contract.collateralSeizedTileIndices, [1]);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.borrower.id);
  assert.equal(ctx.game.defaultClaims.length, 0);
  assert.deepEqual([ctx.borrower.cash, ctx.lender.cash], cash);
  const before = snapshot(ctx);
  handlePlayerLoanDefault(ctx.game, contract);
  ctx.game.processPlayerContracts();
  assert.deepEqual(snapshot(ctx), before);
});
check('lost collateral has no credit and cannot be seized from its current holder', () => {
  const ctx = fixture(), contract = loan(ctx);
  ctx.game.applyPropertyOwnershipChange(ctx.borrower, ctx.other, ctx.game.getTile(1));
  mature(ctx);
  assert.equal(contract.collateralCreditApplied, 60);
  assert.equal(contract.remaining, 240);
  assert.deepEqual(contract.collateralSeizedTileIndices, [3]);
  assert.equal(ctx.game.getTile(1).ownerId, ctx.other.id);
});
check('full claim ledger blocks residual default before seizure', () => {
  const ctx = fixture(); loan(ctx); fullLedger(ctx);
  ctx.contract.status = 'due';
  ctx.game.roundNumber = ctx.contract.cureRound + 1;
  const before = snapshot(ctx);
  ctx.game.processPlayerContracts();
  assert.deepEqual(snapshot(ctx), before);
});
check('fully covered debt closes even with a full open-claim ledger', () => {
  const ctx = fixture(); loan(ctx, 50); fullLedger(ctx);
  mature(ctx);
  assert.equal(ctx.contract.status, 'defaulted');
  assert.equal(ctx.contract.remaining, 0);
  assert.equal(ctx.game.defaultClaims.length, 200);
  assert.deepEqual(ctx.contract.collateralSeizedTileIndices, [1]);
});
check('a second seizure failure restores the entire player default', () => {
  const ctx = fixture(); loan(ctx);
  ctx.contract.status = 'due'; ctx.game.roundNumber = ctx.contract.cureRound + 1;
  const before = snapshot(ctx), transfer = ctx.game.applyPropertyOwnershipChange.bind(ctx.game);
  let calls = 0;
  ctx.game.applyPropertyOwnershipChange = (...args) => { transfer(...args); if (++calls === 2) throw new Error('second seizure failed'); };
  ctx.game.processPlayerContracts();
  assert.deepEqual(snapshot(ctx), before);
});
check('a claim/feed commit failure restores property and ledger state', () => {
  const ctx = fixture(); loan(ctx);
  ctx.contract.status = 'due'; ctx.game.roundNumber = ctx.contract.cureRound + 1;
  const before = snapshot(ctx);
  ctx.game.feedMessage = () => { throw new Error('feed commit failed'); };
  ctx.game.processPlayerContracts();
  assert.deepEqual(snapshot(ctx), before);
});
check('bank offers stamp quotes and default residual joins the bank queue exactly once', () => {
  const ctx = fixture(); own(ctx, [39], [400]); ctx.borrower.cash = 0;
  const offer = ctx.game.getBankLoanOffer(ctx.borrower);
  assert.equal(offer.available, true);
  assert.equal(offer.collateralCreditVersion, 1);
  assert.equal(offer.collateralCreditQuotes[0].value, 400);
  assert.equal(ctx.game.takeBankLoan('borrower').success, true);
  const bank = ctx.borrower.bankLoan;
  assert.equal(bank.collateralCreditQuotes[0].value, 400);
  ctx.borrower.cash = 0;
  ctx.game.getTile(39).price = 1;
  ctx.game.defaultBankLoan(ctx.borrower);
  assert.equal(bank.defaultedPrincipal, 450);
  assert.equal(bank.collateralCreditApplied, 400);
  assert.equal(bank.residualDebt, 50);
  assert.equal(bank.remaining, 50);
  assert.equal(ctx.game.pendingPayment.amountRemaining, 50);
  const before = snapshot(ctx);
  ctx.game.defaultBankLoan(ctx.borrower);
  assert.deepEqual(snapshot(ctx), before);
  ctx.borrower.cash = 50; ctx.game.trySettlePendingPayment();
  assert.equal(bank.remaining, 0);
  assert.equal(bank.residualDebt, 0);
  assert.equal(ctx.game.pendingPayment, null);
});
check('older pending claims keep priority ahead of a bank residual', () => {
  const ctx = fixture(); own(ctx, [39], [400]); ctx.borrower.cash = 0;
  assert.equal(ctx.game.takeBankLoan('borrower').success, true);
  ctx.borrower.cash = 40;
  ctx.game.pendingPayment = { playerId: ctx.borrower.id, creditorId: ctx.other.id, amountRemaining: 40, reason: 'older claim' };
  ctx.game.defaultBankLoan(ctx.borrower);
  assert.equal(ctx.borrower.cash, 40);
  assert.equal(ctx.game.pendingPayment.reason, 'older claim');
  assert.equal(ctx.game.pendingPaymentQueue.length, 1);
  assert.equal(ctx.game.pendingPaymentQueue[0].payment.amountRemaining, 50);
  ctx.game.trySettlePendingPayment();
  assert.equal(ctx.borrower.cash, 0);
  assert.equal(ctx.game.pendingPayment.amountRemaining, 50);
});
check('fully covered bank debt has no excess cash or residual claim', () => {
  const ctx = fixture(); own(ctx, [39], [500]); ctx.borrower.cash = 0;
  assert.equal(ctx.game.takeBankLoan('borrower').success, true);
  const cash = ctx.borrower.cash;
  ctx.game.defaultBankLoan(ctx.borrower);
  assert.equal(ctx.borrower.bankLoan.collateralCreditApplied, 450);
  assert.equal(ctx.borrower.bankLoan.remaining, 0);
  assert.equal(ctx.borrower.cash, cash);
  assert.equal(ctx.game.pendingPayment, null);
});
check('new bankruptcy settlement is one credit pass including marked-bankrupt borrowers', () => {
  const ctx = fixture(), contract = loan(ctx, 50);
  ctx.borrower.bankrupt = true;
  ctx.game.settleBankruptLoan(ctx.borrower, contract);
  assert.equal(contract.collateralCreditApplied, 50);
  assert.deepEqual(contract.collateralSeizedTileIndices, [1]);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.borrower.id, 'the unused deed remains for general estate settlement');
  assert.equal(ctx.game.defaultClaims.length, 0);
});
check('legacy player and bank defaults retain their agreed settlement', () => {
  const ctx = fixture(), contract = loan(ctx, 50);
  delete contract.collateralCreditVersion;
  mature(ctx);
  assert.equal(ctx.game.getTile(1).ownerId, ctx.lender.id);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.lender.id);
  assert.equal(ctx.game.defaultClaims[0].principal, 50);
  assert.equal(contract.collateralCreditApplied, undefined);
  const bankCtx = fixture(); own(bankCtx, [39], [400]);
  bankCtx.borrower.bankLoan = { status: 'due', remaining: 450, collateralTileIndex: 39 };
  bankCtx.game.defaultBankLoan(bankCtx.borrower);
  assert.equal(bankCtx.borrower.bankLoan.remaining, 0);
  assert.equal(bankCtx.game.pendingPayment, null);
  assert.equal(bankCtx.borrower.bankLoan.collateralCreditApplied, undefined);
});
check('legal bankruptcy keeps secured priority with a full ledger and audits write-off', () => {
  const ctx = fixture(), contract = loan(ctx);
  fullLedger(ctx);
  const claimsBefore = structuredClone(ctx.game.defaultClaims);
  ctx.borrower.bankrupt = true;
  ctx.game.settleBankruptLoan(ctx.borrower, contract);
  assert.equal(contract.status, 'defaulted');
  assert.equal(contract.defaultedPrincipal, 300);
  assert.equal(contract.collateralCreditApplied, 120);
  assert.equal(contract.residualDebt, 180);
  assert.equal(contract.remaining, 180);
  assert.equal(contract.residualWrittenOff, 180);
  assert.equal(contract.unrecordedDefault, true);
  assert.equal(ctx.game.getTile(1).ownerId, ctx.lender.id);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.lender.id);
  assert.deepEqual(ctx.game.defaultClaims, claimsBefore);
});
check('bankruptcy residual claims are terminal and retain their audit balance', () => {
  const ctx = fixture(), contract = loan(ctx);
  ctx.borrower.bankrupt = true;
  ctx.game.settleBankruptLoan(ctx.borrower, contract);
  const claim = ctx.game.defaultClaims[0];
  assert.equal(contract.residualWrittenOff, 180);
  assert.equal(claim.principal, 180);
  assert.equal(claim.remaining, 180);
  assert.equal(claim.status, 'written-off');
  assert.equal(ctx.game.pendingPayment, null);
});
check('bankruptcy bank credit records residual write-off without parking dead-seat debt', () => {
  const ctx = fixture(); own(ctx, [39], [400]); ctx.borrower.cash = 0;
  assert.equal(ctx.game.takeBankLoan('borrower').success, true);
  ctx.borrower.cash = 0;
  ctx.borrower.bankrupt = true;
  ctx.game.settleBankLoanOnBankruptcy(ctx.borrower);
  const bank = ctx.borrower.bankLoan;
  assert.equal(bank.defaultedPrincipal, 450);
  assert.equal(bank.collateralCreditApplied, 400);
  assert.equal(bank.remaining, 50);
  assert.equal(bank.residualDebt, 50);
  assert.equal(bank.residualWrittenOff, 50);
  assert.equal(ctx.game.pendingPayment, null);
  assert.equal(ctx.game.pendingPaymentQueue.length, 0);
});
check('bank seizure failure restores loan, share contracts, cash, groups and claims', () => {
  const ctx = fixture(); own(ctx, [39], [400]); ctx.borrower.cash = 0;
  assert.equal(ctx.game.takeBankLoan('borrower').success, true);
  ctx.borrower.cash = 0;
  const agreement = ctx.borrower.bankLoan;
  const before = snapshot(ctx);
  ctx.game.feedMessage = () => { throw new Error('bank commit failed'); };
  ctx.game.defaultBankLoan(ctx.borrower);
  assert.equal(ctx.borrower.bankLoan, agreement, 'agreement identity survives rollback');
  assert.deepEqual(snapshot(ctx), before);
});
check('ordinary direct defaults cannot seize from a marked-bankrupt seat', () => {
  const ctx = fixture(), contract = loan(ctx);
  ctx.borrower.bankrupt = true;
  const before = snapshot(ctx);
  handlePlayerLoanDefault(ctx.game, contract);
  assert.deepEqual(snapshot(ctx), before);
});
check('lender exit terminates new credit loans without seizing borrower collateral', () => {
  const ctx = fixture(), contract = loan(ctx);
  ctx.game.settleBankruptLoan(ctx.lender, contract);
  assert.equal(contract.status, 'terminated');
  assert.equal(ctx.game.getTile(1).ownerId, ctx.borrower.id);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.borrower.id);
  assert.equal(contract.collateralCreditApplied, undefined);
});
check('bank disbursement replay respects disabled lending and ended matches', () => {
  const ctx = fixture(); ctx.borrower.cash = 0;
  assert.equal(ctx.game.takeBankLoan('borrower', 'replay-bank').success, true);
  ctx.game.settings.bankLoans = false;
  assert.equal(ctx.game.takeBankLoan('borrower', 'replay-bank').success, false);
  ctx.game.settings.bankLoans = true;
  ctx.game.started = false;
  assert.equal(ctx.game.takeBankLoan('borrower', 'replay-bank').success, false);
});

check('the actual bankruptcy pipeline gives unused collateral to the estate creditor', () => {
  const ctx = fixture(), contract = loan(ctx, 50);
  ctx.game.handleBankruptcy(ctx.borrower, ctx.other);
  assert.equal(contract.collateralCreditApplied, 50);
  assert.deepEqual(contract.collateralSeizedTileIndices, [1]);
  assert.equal(ctx.game.getTile(1).ownerId, ctx.lender.id);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.other.id);
  assert.equal(ctx.game.defaultClaims.length, 0);
});
check('later borrower or lender exit closes a previously open new residual claim', () => {
  for (const party of ['borrower', 'lender']) {
    const ctx = fixture(), contract = loan(ctx);
    mature(ctx);
    assert.equal(settleDefaultClaim(ctx.game, contract.id, 30).success, true);
    const beforeCredit = contract.collateralCreditApplied;
    ctx.game.handleBankruptcy(ctx[party], null);
    assert.equal(contract.collateralCreditApplied, beforeCredit);
    assert.deepEqual(contract.collateralSeizedTileIndices, [1, 3]);
    assert.equal(contract.residualWrittenOff, 150);
    assert.equal(ctx.game.defaultClaims[0].status, 'written-off');
  }
});
check('missing quotes and departed deeds never create collateral credit', () => {
  const ctx = fixture(), contract = loan(ctx);
  contract.collateralCreditQuotes = [];
  mature(ctx);
  assert.equal(contract.collateralCreditApplied, 0);
  assert.equal(contract.remaining, 300);
  assert.equal(ctx.game.getTile(1).ownerId, ctx.borrower.id);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.borrower.id);
});
check('bank residual partial cash payment updates both outstanding fields', () => {
  const ctx = fixture(); own(ctx, [39], [400]); ctx.borrower.cash = 0;
  assert.equal(ctx.game.takeBankLoan('borrower').success, true);
  ctx.borrower.cash = 20;
  ctx.game.defaultBankLoan(ctx.borrower);
  assert.equal(ctx.borrower.bankLoan.collateralCreditApplied, 400);
  assert.equal(ctx.borrower.bankLoan.remaining, 30);
  assert.equal(ctx.borrower.bankLoan.residualDebt, 30);
  assert.equal(ctx.game.pendingPayment.amountRemaining, 30);
});
check('bank residual queue commit failure rolls back collateral and tendered cash', () => {
  const ctx = fixture(); own(ctx, [39], [400]); ctx.borrower.cash = 0;
  assert.equal(ctx.game.takeBankLoan('borrower').success, true);
  ctx.borrower.cash = 20;
  const before = snapshot(ctx), openDebt = ctx.game.openDebtSettlement.bind(ctx.game);
  ctx.game.openDebtSettlement = (...args) => { openDebt(...args); throw new Error('queue commit failure'); };
  ctx.game.defaultBankLoan(ctx.borrower);
  assert.deepEqual(snapshot(ctx), before);
});

check('public bankruptcy preserves the complete estate on player collateral failure and safely retries', () => {
  const ctx = fixture(), contract = loan(ctx);
  ctx.game.pendingPayment = { playerId: ctx.borrower.id, creditorId: ctx.other.id, amountRemaining: 100, reason: 'older estate debt' };
  const before = snapshot(ctx), transfer = ctx.game.applyPropertyOwnershipChange.bind(ctx.game);
  let transfers = 0;
  ctx.game.applyPropertyOwnershipChange = (...args) => { transfer(...args); if (++transfers === 2) throw new Error('one-time second secured transfer failure'); };
  const failed = ctx.game.handleBankruptcy(ctx.borrower, ctx.other);
  assert.equal(failed?.success, false);
  assert.equal(failed.retryable, true);
  assert.deepEqual(snapshot(ctx), before);
  assert.equal(ctx.borrower.bankrupt, false);
  assert.equal(contract.status, 'active');
  assert.equal(ctx.game.handleBankruptcy(ctx.borrower, ctx.other).success, true);
  assert.equal(ctx.borrower.bankrupt, true);
  assert.equal(contract.status, 'defaulted');
  assert.equal(contract.collateralCreditApplied, 120);
  assert.equal(ctx.game.getTile(1).ownerId, ctx.lender.id);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.lender.id);
  assert.deepEqual(ctx.other.properties, []);
});
check('public bankruptcy preserves bank collateral and cash on failure and safely retries', () => {
  const ctx = fixture(); own(ctx, [39], [400]); ctx.borrower.cash = 0;
  assert.equal(ctx.game.takeBankLoan('borrower').success, true);
  ctx.borrower.cash = 0;
  const agreement = ctx.borrower.bankLoan, before = snapshot(ctx), feed = ctx.game.feedMessage.bind(ctx.game);
  let failed = false;
  ctx.game.feedMessage = text => { if (!failed && text.includes('The bank seized')) { failed = true; throw new Error('one-time bank foreclosure failure'); } feed(text); };
  assert.equal(ctx.game.handleBankruptcy(ctx.borrower, ctx.other)?.success, false);
  assert.deepEqual(snapshot(ctx), before);
  assert.equal(ctx.borrower.bankLoan, agreement);
  assert.equal(ctx.game.handleBankruptcy(ctx.borrower, ctx.other).success, true);
  assert.equal(ctx.borrower.bankrupt, true);
  assert.equal(agreement.status, 'defaulted');
  assert.equal(agreement.collateralCreditApplied, 400);
  assert.equal(agreement.residualWrittenOff, 50);
  assert.equal(ctx.game.getTile(39).ownerId, null);
  assert.deepEqual(ctx.other.properties, []);
});
check('all secured agreements roll back together if the final default fails', () => {
  const ctx = fixture(), first = loan(ctx, 100, [1]);
  own(ctx, [3], [60]);
  const proposal = ctx.game.proposePlayerContract('other', { toPlayerId: ctx.borrower.id, kind: 'loan', amount: 100, durationRounds: 1, collateralTileIndices: [3] });
  assert.equal(proposal.success, true);
  assert.equal(ctx.game.respondPlayerContract('borrower', true).success, true);
  const second = proposal.contract, before = snapshot(ctx), transfer = ctx.game.applyPropertyOwnershipChange.bind(ctx.game);
  let transfers = 0;
  ctx.game.applyPropertyOwnershipChange = (...args) => { transfer(...args); if (++transfers === 2) throw new Error('second agreement failure'); };
  assert.equal(ctx.game.handleBankruptcy(ctx.borrower, null)?.success, false);
  assert.deepEqual(snapshot(ctx), before);
  assert.equal(first.status, 'active');
  assert.equal(second.status, 'active');
  assert.equal(ctx.game.handleBankruptcy(ctx.borrower, null).success, true);
  assert.equal(first.collateralCreditApplied, 60);
  assert.equal(second.collateralCreditApplied, 60);
  assert.equal(ctx.game.getTile(1).ownerId, ctx.lender.id);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.other.id);
});
check('declared bankruptcy preserves debt gates on a failed preparation', () => {
  const ctx = fixture(); loan(ctx);
  ctx.game.pendingPayment = { playerId: ctx.borrower.id, creditorId: ctx.other.id, amountRemaining: 100, reason: 'must survive failed declaration' };
  const before = snapshot(ctx), transfer = ctx.game.applyPropertyOwnershipChange.bind(ctx.game);
  let failed = false;
  ctx.game.applyPropertyOwnershipChange = (...args) => { transfer(...args); if (!failed) { failed = true; throw new Error('one-time failure'); } };
  assert.equal(ctx.game.declareBankruptcy('borrower').success, false);
  assert.deepEqual(snapshot(ctx), before);
  assert.equal(ctx.game.declareBankruptcy('borrower').success, true);
});

check('a player-default failure restores an earlier bank default in the same exit', () => {
  const ctx = fixture(), contract = loan(ctx, 100, [1]);
  own(ctx, [39], [400]); ctx.borrower.cash = 0;
  assert.equal(ctx.game.takeBankLoan('borrower').success, true);
  ctx.borrower.cash = 0;
  const bankLoan = ctx.borrower.bankLoan, before = snapshot(ctx), transfer = ctx.game.applyPropertyOwnershipChange.bind(ctx.game);
  let failed = false;
  ctx.game.applyPropertyOwnershipChange = (...args) => { transfer(...args); if (!failed) { failed = true; throw new Error('player default after bank settlement'); } };
  assert.equal(ctx.game.handleBankruptcy(ctx.borrower, ctx.other).success, false);
  assert.deepEqual(snapshot(ctx), before);
  assert.equal(ctx.borrower.bankLoan, bankLoan);
  assert.equal(bankLoan.status, 'active');
  assert.equal(contract.status, 'active');
  assert.equal(ctx.game.handleBankruptcy(ctx.borrower, ctx.other).success, true);
  assert.equal(bankLoan.collateralCreditApplied, 400);
  assert.equal(contract.collateralCreditApplied, 60);
  assert.equal(ctx.game.getTile(39).ownerId, null);
  assert.equal(ctx.game.getTile(1).ownerId, ctx.lender.id);
});
check('public bankruptcy with a full ledger commits secured priority and residual write-off', () => {
  const ctx = fixture(), contract = loan(ctx);
  fullLedger(ctx);
  assert.equal(ctx.game.handleBankruptcy(ctx.borrower, ctx.other).success, true);
  assert.equal(ctx.borrower.bankrupt, true);
  assert.equal(contract.collateralCreditApplied, 120);
  assert.equal(contract.residualWrittenOff, 180);
  assert.equal(contract.unrecordedDefault, true);
  assert.equal(ctx.game.getTile(1).ownerId, ctx.lender.id);
  assert.equal(ctx.game.getTile(3).ownerId, ctx.lender.id);
});

let failures = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS - ${name}`); }
  catch (error) { failures++; console.error(`FAIL - ${name}: ${error.stack}`); }
}
if (failures) process.exitCode = 1;
