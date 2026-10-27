// F-003 / A56-02: a leading auction bid is reserved cash. Outflows that would
// dip into it are refused while the auction is open, so the high bid cannot be
// voided at close ("Auction ended without a valid winner").
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const COMMITTED = 'You cannot spend cash that is committed to your leading auction bid.';
const RAILROAD = 5;

function freshGame() {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  const g = room.game;
  return { g, a: g.players[0], b: g.players[1] };
}

function bankLoan(remaining) {
  return { status: 'active', principal: remaining, remaining, issuedRound: 1, dueRound: 50, cureRound: null };
}

// A bids 900 with 1000 cash, then repays a bank loan: the repayment that dips
// into the bid is refused, and the winner keeps the railroad at close.
function testBankRepaymentCannotVoidLeadingBid() {
  const { g, a } = freshGame();
  g.currentPlayerId = a.id;
  a.cash = 1000;
  a.bankLoan = bankLoan(300);
  g.startAuction(g.getTile(RAILROAD), a.id);
  assert.equal(g.placeAuctionBid('socket-a', 900).success, true);
  assert.deepEqual(g.repayBankLoan('socket-a', { amount: 300, requestId: 'escrow-bank-1' }), { success: false, error: COMMITTED });
  assert.equal(a.cash, 1000);
  assert.equal(a.bankLoan.remaining, 300);
  assert.equal(g.repayBankLoan('socket-a', { amount: 100, requestId: 'escrow-bank-2' }).success, true, 'cash above the bid may still repay');
  assert.equal(a.cash, 900);
  g.finishAuction();
  assert.equal(g.getTile(RAILROAD).ownerId, a.id);
  assert.equal(g.getTile(RAILROAD).purchasePricePaid, 900, 'auction winner basis is the actual winning bid');
  assert.equal(a.cash, 0);
}

function testBankRepaymentReleasesWhenOutbidOrClosed() {
  const { g, a, b } = freshGame();
  g.currentPlayerId = a.id;
  a.cash = 1000;
  a.bankLoan = bankLoan(300);
  g.startAuction(g.getTile(RAILROAD), a.id);
  g.placeAuctionBid('socket-a', 900);
  assert.equal(g.repayBankLoan('socket-a', { amount: 300, requestId: 'escrow-bank-3' }).success, false);
  b.cash = 1000;
  g.auction.cooldownUntil = 0;
  assert.equal(g.placeAuctionBid('socket-b', 950).success, true);
  assert.equal(g.repayBankLoan('socket-a', { amount: 300, requestId: 'escrow-bank-4' }).success, true, 'an outbid player holds no reserve');
  assert.equal(a.cash, 700);
  assert.equal(a.bankLoan.status, 'paid');
}

function testBankRepaymentUnchangedWithoutLeadingBid() {
  const { g, a, b } = freshGame();
  g.currentPlayerId = a.id;
  a.cash = 1000;
  a.bankLoan = bankLoan(300);
  assert.equal(g.repayBankLoan('socket-a', { amount: 300, requestId: 'escrow-bank-5' }).success, true, 'no auction');
  assert.equal(a.cash, 700);
  a.bankLoan = bankLoan(300);
  b.cash = 1000;
  g.startAuction(g.getTile(RAILROAD), b.id);
  g.placeAuctionBid('socket-b', 900);
  assert.equal(g.repayBankLoan('socket-a', { amount: 300, requestId: 'escrow-bank-6' }).success, true, 'a non-leading player keeps full cash');
  assert.equal(a.cash, 400);
}

// The player-contract repayment is off-turn for the bidder, so the reserve must
// hold regardless of whose turn it is.
function testPlayerContractRepaymentCannotVoidLeadingBid() {
  const { g, a, b } = freshGame();
  g.currentPlayerId = b.id;
  a.cash = 1000;
  const contract = { id: 'c-escrow-1', kind: 'loan', fromPlayerId: b.id, toPlayerId: a.id, status: 'active', remaining: 300, principal: 300, propertyIndex: null };
  g.playerContracts.push(contract);
  g.startAuction(g.getTile(RAILROAD), b.id);
  assert.equal(g.placeAuctionBid('socket-a', 900).success, true);
  assert.deepEqual(g.repayPlayerContract('socket-a', { contractId: contract.id, amount: 300, requestId: 'escrow-contract-1' }), { success: false, error: COMMITTED });
  assert.equal(a.cash, 1000);
  assert.equal(contract.remaining, 300);
  assert.equal(g.repayPlayerContract('socket-a', { contractId: contract.id, amount: 100, requestId: 'escrow-contract-2' }).success, true);
  assert.equal(a.cash, 900);
  assert.equal(contract.remaining, 200);
}

// Trades are proposed before the auction opens (proposals are blocked while
// one is running). Accepting a trade that pays out of the leader's bid is
// refused, and the offer stays open to answer once the reserve is free.
function testTradeAcceptCannotVoidLeadingBid() {
  const { g, a, b } = freshGame();
  g.currentPlayerId = b.id;
  a.cash = 1000;
  b.cash = 1000;
  const proposal = g.proposeTrade('socket-b', { toPlayerId: a.id, giveCash: 0, requestCash: 300, givePropertyIndexes: [], requestPropertyIndexes: [], requestId: 'escrow-trade-1' });
  assert.equal(proposal.success, true);
  g.startAuction(g.getTile(RAILROAD), b.id);
  assert.equal(g.placeAuctionBid('socket-a', 900).success, true);
  assert.deepEqual(g.respondToTrade('socket-a', { tradeId: proposal.trade.id, accept: true }), { success: false, error: COMMITTED });
  assert.equal(g.pendingTrade?.id, proposal.trade.id, 'the offer is not cleared by a reserve refusal');
  assert.equal(a.cash, 1000);
  g.auction.cooldownUntil = 0;
  b.cash = 1000;
  assert.equal(g.placeAuctionBid('socket-b', 950).success, true);
  assert.equal(g.respondToTrade('socket-a', { tradeId: proposal.trade.id, accept: true }).success, true, 'outbid, so the cash is free again');
  assert.equal(a.cash, 700);
  assert.equal(b.cash, 1300);
}

// The proposer side: a trade that pays out of the proposer's own leading bid.
function testTradeProposerCannotVoidOwnLeadingBid() {
  const { g, a, b } = freshGame();
  g.currentPlayerId = a.id;
  a.cash = 1000;
  b.cash = 1000;
  const proposal = g.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 300, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [], requestId: 'escrow-trade-2' });
  assert.equal(proposal.success, true);
  g.startAuction(g.getTile(RAILROAD), a.id);
  assert.equal(g.placeAuctionBid('socket-a', 900).success, true);
  assert.deepEqual(g.respondToTrade('socket-b', { tradeId: proposal.trade.id, accept: true }), { success: false, error: COMMITTED });
  assert.equal(a.cash, 1000);
  assert.equal(b.cash, 1000);
}

// A lender who leads an auction may not fund an accepted player contract out of
// the reserved bid; the offer stays pending.
function testContractAcceptCannotVoidLenderLeadingBid() {
  const { g, a, b } = freshGame();
  g.currentPlayerId = a.id;
  a.cash = 1000;
  b.cash = 0;
  const proposal = g.proposePlayerContract('socket-a',{ toPlayerId: b.id, kind: 'loan', amount: 300, premiumRate: 10, durationRounds: 5, requestId: 'escrow-contract-3' });
  assert.equal(proposal.success, true);
  const contract = proposal.contract;
  g.startAuction(g.getTile(RAILROAD), a.id);
  assert.equal(g.placeAuctionBid('socket-a', 900).success, true);
  assert.deepEqual(g.respondPlayerContract('socket-b', true, 'escrow-accept-1', contract.id), { success: false, error: COMMITTED });
  assert.equal(g.pendingPlayerContract?.id, contract.id);
  assert.equal(a.cash, 1000);
  assert.equal(b.cash, 0);
}

// An accepted equity transfer is paid by the buyer, so a buyer who leads an
// auction may not spend the reserved bid on it.
function testEquityTransferCannotVoidBuyerLeadingBid() {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 's-seller', clientId: 'c-seller', nickname: 'Seller' });
  room.addOrReconnectPlayer({ socketId: 's-owner', clientId: 'c-owner', nickname: 'Owner' });
  room.addOrReconnectPlayer({ socketId: 's-buyer', clientId: 'c-buyer', nickname: 'Buyer' });
  assert.equal(room.startGame().success, true);
  const g = room.game;
  const [seller, owner, buyer] = g.players;
  const tile = g.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  seller.cash = 500;
  buyer.cash = 500;
  const source = {
    id: 'source-equity-escrow', kind: 'equity', fromPlayerId: seller.id, toPlayerId: owner.id,
    propertyIndex: tile.index, equityShare: 40, equityControl: 'passive', permanent: false,
    expiresRound: g.roundNumber + 4, amount: 100, status: 'active', createdRound: g.roundNumber
  };
  g.playerContracts.push(source);
  seller.playerContractIds.push(source.id);
  owner.playerContractIds.push(source.id);
  tile.equityShares = [{ holderId: seller.id, share: 40, contractId: source.id, control: 'passive' }];
  g.currentPlayerId = seller.id;
  const proposal = g.proposeEquityShareTransfer('s-seller', {
    fromPlayerId: seller.id, toPlayerId: buyer.id, contractId: source.id, sharePct: 15, price: 60, requestId: 'escrow-transfer-1'
  });
  assert.equal(proposal.success, true);
  g.startAuction(g.getTile(RAILROAD), seller.id);
  assert.equal(g.placeAuctionBid('s-buyer', 450).success, true);
  assert.deepEqual(g.respondPlayerContract('s-buyer', true, 'escrow-transfer-accept', proposal.transfer.id), { success: false, error: COMMITTED });
  assert.equal(g.pendingPlayerContract?.id, proposal.transfer.id, 'the transfer stays open');
  assert.equal(buyer.cash, 500);
  assert.equal(seller.cash, 500);
}

// D8: a seat that owes money cannot bid. The cash behind a bid is the cash the
// debt collects, and a bid the debt eats voids the sale at close.
function testDebtorCannotBid() {
  const { g, a, b } = freshGame();
  g.currentPlayerId = a.id;
  a.cash = 1000;
  g.startAuction(g.getTile(RAILROAD), a.id);
  g.pendingPayment = { playerId: a.id, creditorId: b.id, amountRemaining: 400, reason: 'rent' };
  assert.deepEqual(g.placeAuctionBid('socket-a', 500), {
    success: false, error: 'Settle your pending payment before bidding.'
  });
  assert.equal(g.auction.highestBid, 0, 'the parked debt keeps the bid out');
  assert.equal(g.auction.highestBidderId, null);
  // A queued claim blocks the bid exactly like the parked one.
  g.pendingPayment = null;
  g.pendingPaymentQueue = [{ payment: { playerId: a.id, creditorId: b.id, amountRemaining: 300 }, hooks: {}, turnOptions: {} }];
  assert.deepEqual(g.placeAuctionBid('socket-a', 500), {
    success: false, error: 'Settle your pending payment before bidding.'
  });
  assert.equal(g.auction.highestBid, 0);
  // A debt-free seat still bids.
  g.pendingPaymentQueue = [];
  assert.equal(g.placeAuctionBid('socket-a', 500).success, true);
  assert.equal(g.auction.highestBid, 500);
}

// D8: the active event blocks NEW auctions. An auction that is already open
// keeps its clock and finishes normally (the T13 intent): freezing a live
// auction would strand the bids that are already on the table.
function testRunningAuctionSurvivesTheEventPause() {
  const { g, a } = freshGame();
  g.currentPlayerId = a.id;
  a.cash = 1000;
  g.startAuction(g.getTile(RAILROAD), a.id);
  g.globalEvent = { id: 'bank-run', phase: 'active', effects: { auctionBlocked: true } };
  assert.equal(g.placeAuctionBid('socket-a', 500).success, true,
    'a running auction is not frozen by the event');
  assert.equal(g.auction.highestBid, 500);
  g.finishAuction();
  assert.equal(g.auction, null);
  assert.equal(g.getTile(RAILROAD).ownerId, a.id, 'the running auction still sells');
  assert.equal(a.cash, 500, 'the winner pays the bid');
  const blocked = g.startAuction(g.getTile(RAILROAD), a.id);
  assert.equal(blocked.success, false, 'starting a new auction during the pause is blocked');
  assert.equal(blocked.error, 'Auctions are paused by the active Bank Run.');
}

// D8: the leading bid stays reserved from spendable cash while a debt is
// parked, so a debt rescue cannot eat the money the bid needs.
function testLeadingBidStaysReservedWhileDebtIsParked() {
  const { g, a } = freshGame();
  g.currentPlayerId = a.id;
  a.cash = 1000;
  g.startAuction(g.getTile(RAILROAD), a.id);
  assert.equal(g.placeAuctionBid('socket-a', 900).success, true);
  g.pendingPayment = { playerId: a.id, creditorId: null, amountRemaining: 400, reason: 'rent' };
  assert.equal(g.spendableCash(a), 100, 'the leading bid is still reserved');
  assert.equal(g.spendableCash(a) >= 400, false, 'the parked debt cannot be funded out of the reserved bid');
}

const SUITES = [
  ['bank repayment cannot void the leading bid', testBankRepaymentCannotVoidLeadingBid],
  ['bank repayment releases when outbid or closed', testBankRepaymentReleasesWhenOutbidOrClosed],
  ['bank repayment unchanged without a leading bid', testBankRepaymentUnchangedWithoutLeadingBid],
  ['player-contract repayment cannot void the leading bid', testPlayerContractRepaymentCannotVoidLeadingBid],
  ['trade accept cannot void the leading bid', testTradeAcceptCannotVoidLeadingBid],
  ['trade proposer cannot void own leading bid', testTradeProposerCannotVoidOwnLeadingBid],
  ['contract accept cannot void lender leading bid', testContractAcceptCannotVoidLenderLeadingBid],
  ['equity transfer accept cannot void buyer leading bid', testEquityTransferCannotVoidBuyerLeadingBid],
  ['a seat with an unpaid debt cannot bid', testDebtorCannotBid],
  ['a running auction survives the event pause', testRunningAuctionSurvivesTheEventPause],
  ['the leading bid stays reserved while a debt is parked', testLeadingBidStaysReservedWhileDebtIsParked]
];

let passed = 0;
const failed = [];
for (const [name, fn] of SUITES) {
  try {
    fn();
    passed += 1;
    console.log(`PASS — ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`FAIL — ${name}: ${error && error.message}`);
  }
}
console.log(`auction bid escrow tests: ${SUITES.length} suites — ${passed} passed, ${failed.length} failed`);
if (failed.length) process.exitCode = 1;
