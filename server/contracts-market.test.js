// Characterization suite for GameState.proposePlayerContract and
// GameState.tradeMarket (the two cc 44 twins). Pins every guard order and
// error string, the replay-cache semantics, loan/equity/hybrid term
// derivation, buy/sell cash+position math, crisis-buy tracking, and the
// ledger/feed tails. Captured from the pre-refactor methods.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function startedRoom(settings = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  for (const [key, value] of Object.entries(settings)) room.setRoomSetting(key, value);
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  game.currentPlayerId = game.players[0].id;
  return { room, game, a: game.players[0], b: game.players[1] };
}

check('contract guards preserve active pair, obligation and funding order off-turn', () => {
  const { game, a, b } = startedRoom();
  assert.deepEqual(game.proposePlayerContract('socket-z', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'Choose two active players.' });
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: a.id, amount: 10 }), { success: false, error: 'Choose two active players.' });
  game.currentPlayerId = b.id;
  assert.equal(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }).success, true);
  game.pendingPlayerContract = null;
  game.pendingTrade = { id: 'x' };
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'Resolve the current table obligation first.' });
  game.pendingTrade = null;
  a.cash = 5;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'The lender does not have enough cash for that offer.' });
  a.cash = 1500;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 'x' }), { success: false, error: 'The lender does not have enough cash for that offer.' });
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 0 }), { success: false, error: 'The lender does not have enough cash for that offer.' });
});

check('playerContractProposalCanBeCreatedOffTurn', () => {
  const { game, a, b } = startedRoom();
  game.currentPlayerId = b.id;
  const result = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100, premiumRate: 12, durationRounds: 3, requestId: 'off-turn-proposal' });
  assert.equal(result.success, true);
  assert.equal(game.pendingPlayerContract.fromPlayerId, a.id);
  assert.equal(game.pendingPlayerContract.toPlayerId, b.id);
});

check('offTurnContractResponsesSurviveTurnChanges', () => {
  const { game, a, b } = startedRoom();
  game.currentPlayerId = b.id;
  const proposal = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100, premiumRate: 12, durationRounds: 3 });
  assert.equal(proposal.success, true);
  game.currentPlayerId = a.id;
  const counter = game.counterPlayerContract('socket-b', { contractId: proposal.contract.id, amount: 120, premiumRate: 8 });
  assert.equal(counter.success, true);
  game.currentPlayerId = b.id;
  const accepted = game.respondPlayerContract('socket-a', true, 'off-turn-accept', counter.contract.id);
  assert.equal(accepted.success, true);
  assert.equal(a.cash, 1380);
  assert.equal(b.cash, 1620);

  const toDecline = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 80 });
  assert.equal(toDecline.success, true);
  game.currentPlayerId = a.id;
  const declined = game.respondPlayerContract('socket-b', false, 'off-turn-decline', toDecline.contract.id);
  assert.equal(declined.success, true);
  assert.equal(game.pendingPlayerContract, null);
});

check('offTurnProposalRetainsActiveSeatFundingAndObligationGuards', () => {
  const { game, a, b } = startedRoom();
  game.currentPlayerId = b.id;
  a.disconnected = true;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'Choose two active players.' });
  a.disconnected = false;
  b.disconnected = true;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'Choose two active players.' });
  b.disconnected = false;
  a.cash = 5;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'The lender does not have enough cash for that offer.' });
  a.cash = 1500;
  a.bankLoan = { status: 'active', remaining: 450 };
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'Loan-backed cash cannot be used for player contracts.' });
  a.bankLoan = null;
  game.pendingTrade = { id: 'open-obligation' };
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'Resolve the current table obligation first.' });
});

check('loan rejects a collateral index that resolves to no deed', () => {
  const { game, b } = startedRoom();
  const deed = game.getTile(1);
  deed.ownerId = b.id;
  assert.deepEqual(
    game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100, premiumRate: 12, durationRounds: 3, collateralTileIndex: 9999 }),
    { success: false, error: 'Collateral must be an unencumbered deed owned by the borrower.' }
  );
});

check('equity counter is not double-counted against the pending offer', () => {
  const { game, b } = startedRoom();
  const deed = game.getTile(1);
  deed.ownerId = b.id;
  const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'equity', amount: 50, propertyIndex: 1, equityShare: 80 });
  assert.equal(first.success, true);
  const counter = game.counterPlayerContract('socket-b', { contractId: first.contract.id, equityShare: 60 });
  assert.equal(counter.success, true);
  assert.equal(game.pendingPlayerContract.equityShare, 60);
});

check('loan contract derives totalDue, due and cure rounds, collateral', () => {
  const { game, b } = startedRoom();
  const deed = game.getTile(1);
  deed.ownerId = b.id;
  const result = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100, premiumRate: 12, durationRounds: 3, collateralTileIndex: 1 });
  assert.equal(result.success, true);
  const contract = game.pendingPlayerContract;
  assert.equal(contract.totalDue, 112);
  assert.equal(contract.remaining, 112);
  assert.equal(contract.dueRound, game.roundNumber + 3);
  assert.equal(contract.cureRound, contract.dueRound + 1);
  assert.equal(contract.collateralTileIndex, 1);
  assert.equal(contract.equityShare, 0);
});

check('borrower can negotiate every loan term before lender approval', () => {
  const { game, a, b } = startedRoom();
  const deed = game.getTile(1);
  deed.ownerId = b.id;
  const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100, premiumRate: 12, durationRounds: 3, collateralTileIndex: 1 });
  assert.equal(first.success, true);
  const counter = game.counterPlayerContract('socket-b', { contractId: first.contract.id, kind: 'loan', amount: 150, premiumRate: 5, durationRounds: 5, collateralTileIndex: 1 });
  assert.equal(counter.success, true);
  assert.equal(counter.countered, true);
  assert.equal(game.pendingPlayerContract.fromPlayerId, a.id);
  assert.equal(game.pendingPlayerContract.toPlayerId, b.id);
  assert.equal(game.pendingPlayerContract.amount, 150);
  assert.equal(game.pendingPlayerContract.premiumRate, 5);
  assert.equal(game.pendingPlayerContract.durationRounds, 5);
  assert.deepEqual(game.respondPlayerContract('socket-a', true, 'stale', 'contract-stale'), { success: false, error: 'No matching player contract was found.' });
  const accepted = game.respondPlayerContract('socket-a', true, 'counter-accept');
  assert.equal(accepted.success, true);
  assert.equal(a.cash, 1350);
  assert.equal(b.cash, 1650);
  assert.equal(game.pendingPlayerContract, null);
});

check('sender can adjust or cancel a pending contract without funding it', () => {
  const { game, a, b } = startedRoom();
  const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 80, premiumRate: 10, durationRounds: 2 });
  assert.equal(first.success, true);
  const adjusted = game.adjustPlayerContract('socket-a', { contractId: first.contract.id, kind: 'loan', amount: 120, premiumRate: 4, durationRounds: 4 });
  assert.equal(adjusted.success, true);
  assert.equal(adjusted.adjusted, true);
  assert.equal(game.pendingPlayerContract.amount, 120);
  assert.equal(a.cash, 1500);
  assert.equal(b.cash, 1500);
  assert.equal(game.pendingPlayerContract.amount, 120);
});

check('contract negotiation roles alternate after each counter', () => {
  const { game, a, b } = startedRoom();
  const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 80, premiumRate: 20, durationRounds: 2 });
  const counter = game.counterPlayerContract('socket-b', { contractId: first.contract.id, amount: 90, premiumRate: 10, durationRounds: 3 });
  assert.equal(counter.success, true);
  assert.equal(game.counterPlayerContract('socket-b', { contractId: counter.contract.id, amount: 90 }).success, false);
  const adjusted = game.adjustPlayerContract('socket-b', { contractId: counter.contract.id, amount: 95, premiumRate: 8, durationRounds: 4 });
  assert.equal(adjusted.success, true);
  assert.equal(game.pendingPlayerContract.toPlayerId, b.id);
  // B authored every surviving term, so the decision belongs to A. This line
  // used to assert the inverted hand-off (B accepting their own counter),
  // which was the B-01 exploit: the responder fell back to counterDepth
  // parity once the same seat negotiated twice in a row.
  assert.deepEqual(game.respondPlayerContract('socket-b', true, 'role-accept', adjusted.contract.id), {
    success: false, error: 'No matching player contract was found.'
  });
  assert.notEqual(game.pendingPlayerContract, null);
  assert.equal(game.respondPlayerContract('socket-a', true, 'role-accept-lender', adjusted.contract.id).success, true);
  assert.equal(a.cash, 1405);
  assert.equal(b.cash, 1595);
});

check('loan collateral must be an unencumbered borrower deed', () => {
  const { game, a, b } = startedRoom();
  const wrongOwner = game.getTile(1);
  wrongOwner.ownerId = a.id;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 50, collateralTileIndex: 1 }), { success: false, error: 'Collateral must be an unencumbered deed owned by the borrower.' });
});

check('rent shares clamp share, verify owner and allow one investor', () => {
  const { game, b } = startedRoom();
  const property = game.getTile(1);
  property.ownerId = b.id;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'equity', amount: 50, propertyIndex: 6 }), { success: false, error: 'Rent shares need an unmortgaged deed owned by the recipient.' });
  const result = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'equity', amount: 50, propertyIndex: 1, equityShare: 3, equityControl: 'passive' });
  assert.equal(result.success, true);
  const contract = game.pendingPlayerContract;
  assert.equal(contract.equityShare, 5);
  assert.equal(contract.equityControl, 'passive');
  assert.equal(contract.expiresRound, game.roundNumber + 3);
  assert.equal(contract.propertyIndex, 1);
  game.pendingPlayerContract = null;
  property.equityShares = [{ share: 96 }];
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'equity', amount: 50, propertyIndex: 1, equityShare: 5 }), { success: false, error: 'A deed may have only one rent-share investor.' });
});

check('permanent equity proposals and negotiated control are rejected explicitly', () => {
  const { game, b } = startedRoom();
  game.getTile(1).ownerId = b.id;
  const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'equity', amount: 50, propertyIndex: 1, equityShare: 20, permanent: true });
  assert.equal(first.success, false);
  assert.match(first.error, /temporary/);
  const temporary = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'equity', amount: 50, propertyIndex: 1, equityShare: 20 });
  assert.equal(temporary.success, true);
  const adjusted = game.adjustPlayerContract('socket-a', { contractId: temporary.contract.id, equityControl: 'shared' });
  assert.equal(adjusted.success, false);
  assert.match(adjusted.error, /passive/);
  assert.equal(game.pendingPlayerContract, temporary.contract);
});

check('requestId replays return the memoized contract result', () => {
  const { game, b } = startedRoom();
  const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10, requestId: 'abc' });
  assert.equal(first.success, true);
  game.pendingPlayerContract = null;
  const replay = game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10, requestId: 'abc' });
  assert.equal(replay, first);
});

function marketRoom() {
  return startedRoom({ market: true });
}

check('market guards keep order and wording', () => {
  const { game } = startedRoom();
  assert.deepEqual(game.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Market access is off for this room.' });
  const ready = marketRoom();
  const g2 = ready.game;
  assert.deepEqual(g2.tradeMarket('socket-z', 'brazil', 'buy', 1), { success: false, error: 'Market access is unavailable right now.' });
  g2.players[0].disconnected = true;
  assert.deepEqual(g2.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Market access is unavailable right now.' });
  g2.players[0].disconnected = false;
  g2.currentPlayerId = g2.players[1].id;
  assert.deepEqual(g2.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Market orders are available during your turn.' });
  g2.currentPlayerId = g2.players[0].id;
  g2.pendingTrade = { id: 't1' };
  assert.deepEqual(g2.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Resolve the table obligation before trading.' });
  g2.pendingTrade = null;
  g2.globalEvent = { id: 'halt', phase: 'active', effects: { tradingEnabled: false } };
  assert.deepEqual(g2.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Market trading is paused by the active global event.' });
  g2.globalEvent = null;
  assert.deepEqual(g2.tradeMarket('socket-a', 'nope', 'hold', 1), { success: false, error: 'Choose a valid market order.' });
  assert.deepEqual(g2.tradeMarket('socket-a', 'brazil', 'hold', 1), { success: false, error: 'Choose a valid market order.' });
  assert.deepEqual(g2.tradeMarket('socket-a', 'brazil', 'buy', 0), { success: false, error: 'Quantity must be between 1 and 1,000.' });
  assert.deepEqual(g2.tradeMarket('socket-a', 'brazil', 'buy', 1001), { success: false, error: 'Quantity must be between 1 and 1,000.' });
});

check('buy charges gross+fee and averages cost; feed and ledger record it', () => {
  const { game, a } = marketRoom();
  const quote = Number(game.marketQuotes?.brazil) || 100;
  const gross = quote * 2;
  const fee = Math.max(1, Math.ceil(gross * 0.02));
  a.cash = 10_000;
  const before = a.cash;
  const result = game.tradeMarket('socket-a', 'brazil', 'buy', 2);
  assert.equal(result.success, true);
  assert.equal(a.cash, before - gross - fee);
  assert.equal(a.marketPositions.brazil.quantity, 2);
  assert.equal(a.marketPositions.brazil.averageCost, (gross + fee) / 2);
  assert.equal(a.marketActionsThisTurn, 1);
  assert.equal(a.marketTrades, 1);
  assert.deepEqual(result.order, { instrumentId: 'brazil', side: 'buy', quantity: 2, quote, fee, total: gross + fee });
  assert.equal(game.marketLedger[0].instrumentId, 'brazil');
  assert.match(game.feed[0].text, /bought 2 .* index units?\./);
  assert.match(game.feed[0].text, /bought 2 HOUSING MARKET index units\./);
});

check('one order per turn; sell math realizes pnl and clears flat position', () => {
  const { game, a } = marketRoom();
  a.cash = 10_000;
  assert.equal(game.tradeMarket('socket-a', 'brazil', 'buy', 2).success, true);
  assert.deepEqual(game.tradeMarket('socket-a', 'brazil', 'sell', 1), { success: false, error: 'You have already placed a market order this turn.' });
  a.marketActionsThisTurn = 0;
  const position = a.marketPositions.brazil;
  const sellQuote = Number(game.marketQuotes.brazil) || position.averageCost;
  const gross = sellQuote;
  const fee = Math.max(1, Math.ceil(gross * 0.02));
  const cashBefore = a.cash;
  const result = game.tradeMarket('socket-a', 'brazil', 'sell', 1);
  assert.equal(result.success, true);
  assert.equal(a.cash, cashBefore + gross - fee);
  assert.equal(position.quantity, 1);
  assert.equal(position.realizedPnl, (sellQuote - position.averageCost) * 1 - fee);
  assert.equal(result.order.total, gross - fee);
  a.marketActionsThisTurn = 0;
  assert.deepEqual(game.tradeMarket('socket-a', 'brazil', 'sell', 5), { success: false, error: 'You do not hold enough of this index.' });
  a.marketActionsThisTurn = 0;
  game.tradeMarket('socket-a', 'brazil', 'sell', 1);
  assert.equal(position.quantity, 0);
  assert.equal(position.averageCost, 0);
});

check('insufficient cash rejects buy before any mutation', () => {
  const { game, a } = marketRoom();
  a.cash = 5;
  assert.deepEqual(game.tradeMarket('socket-a', 'brazil', 'buy', 2), { success: false, error: 'Not enough cash for this order.' });
  assert.equal(a.marketPositions.brazil, undefined);
  assert.equal(a.marketActionsThisTurn, 0); // seeded, not mutated by the rejected order
});

check('market order initializes a legacy missing position map', () => {
  const { game, a } = marketRoom();
  a.cash = 1000;
  a.marketPositions = undefined;
  assert.equal(game.tradeMarket('socket-a', 'brazil', 'buy', 1).success, true);
  assert.equal(a.marketPositions.brazil.quantity, 1);
});

check('crisis buys record under active multiplier<1 and flag profit on higher sell', () => {
  const { game, a } = marketRoom();
  a.cash = 10_000;
  game.globalEvent = { id: 'crash', phase: 'active', effects: { marketPriceMultiplier: 0.5 } };
  game.marketQuotes.brazil = 40;
  assert.equal(game.tradeMarket('socket-a', 'brazil', 'buy', 1).success, true);
  assert.equal(a.crisisMarketBuys.brazil.quote, 40);
  assert.equal(a.crisisMarketBuys.brazil.roundNumber, game.roundNumber);
  game.globalEvent = null;
  a.marketActionsThisTurn = 0;
  game.marketQuotes.brazil = 90;
  assert.equal(game.tradeMarket('socket-a', 'brazil', 'sell', 1).success, true);
  assert.equal(a.crisisMarketProfit, true);
  assert.equal(a.crisisMarketBuys.brazil, undefined);
});

check('market event price shock applies once per active event', () => {
  const { game } = marketRoom();
  game.marketQuotes.brazil = 100;
  game.globalEvent = { id: 'housing-bubble', phase: 'active', startedRound: 3, effects: { marketPriceMultiplier: 0.5, marketVolatility: 0.0001 } };
  game.advanceMarket();
  assert.equal(game.marketQuotes.brazil <= 51, true);
  game.marketQuotes.brazil = 100;
  game.advanceMarket();
  assert.equal(game.marketQuotes.brazil >= 99, true);
});

check('a padded requestId replays as the same request instead of executing twice', () => {
  const { game, b } = startedRoom();
  const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 10, premiumRate: 12, durationRounds: 3, requestId: 'padded-proposal' });
  assert.equal(first.success, true);
  // " padded-proposal " names the same logical request. Keying on the raw
  // string misses the memo, so the second call runs the guard ladder again
  // and returns a different result object instead of the memoized one.
  const pendingAfterFirst = game.pendingPlayerContract;
  game.pendingPlayerContract = null;
  const padded = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 10, premiumRate: 12, durationRounds: 3, requestId: '  padded-proposal  ' });
  assert.equal(padded, first, 'a whitespace-padded requestId must replay, not re-execute');
  assert.equal(game.pendingPlayerContract, null, 'the replay must not install a fresh pending contract');
  assert.equal(pendingAfterFirst.id, first.contract.id);
  assert.ok(b.id);
});

check('requestId replays return the memoized market result', () => {
  const { game, a } = marketRoom();
  a.cash = 10_000;
  const first = game.tradeMarket('socket-a', 'brazil', 'buy', 1, 'r-1');
  assert.equal(first.success, true);
  a.marketActionsThisTurn = 0;
  const replay = game.tradeMarket('socket-a', 'brazil', 'buy', 1, 'r-1');
  assert.equal(replay, first);
});

// Accepted pre-upgrade data is constructed directly: new hybrid proposals are
// forbidden, while legacy due/default/conversion and repayment remain supported.
function hybridRoom(conversionShare = 30) {
  const ctx = startedRoom();
  const property = ctx.game.getTile(1);
  property.ownerId = ctx.b.id;
  ctx.b.properties.push(1);
  const contract = {
    id: 'legacy-hybrid', kind: 'hybrid', fromPlayerId: ctx.a.id, toPlayerId: ctx.b.id,
    amount: 100, premiumRate: 10, totalDue: 110, remaining: 110, durationRounds: 2,
    dueRound: ctx.game.roundNumber + 2, cureRound: ctx.game.roundNumber + 3,
    propertyIndex: 1, conversionShare, status: 'active', collateralTileIndex: null,
    collateralTileIndices: [], equityShare: 0
  };
  ctx.game.playerContracts.push(contract);
  ctx.a.playerContractIds.push(contract.id);
  ctx.b.playerContractIds.push(contract.id);
  ctx.a.cash -= 100;
  ctx.b.cash += 100;
  return { ...ctx, property, contract };
}

check('legacy accepted hybrid terms remain unchanged', () => {
  const { game, contract } = hybridRoom();
  assert.equal(contract.totalDue, 110);
  assert.equal(contract.remaining, 110);
  assert.equal(contract.dueRound, game.roundNumber + 2);
  assert.equal(contract.cureRound, contract.dueRound + 1);
  assert.equal(contract.propertyIndex, 1);
  assert.equal(contract.conversionShare, 30);
  assert.equal(contract.rulesVersion, undefined);
});

check('new hybrid proposals reject every conversion target explicitly', () => {
  const { game, b, property } = hybridRoom(5);
  for (const propertyIndex of [1, 6]) {
    const result = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'hybrid', amount: 50, propertyIndex, conversionShare: 10 });
    assert.equal(result.success, false);
    assert.match(result.error, /Hybrid contracts are no longer available/);
  }
  property.equityShares = [{ share: 80 }];
  assert.equal(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'hybrid', amount: 50, propertyIndex: 1, conversionShare: 30 }).success, false);
});

check('legacy active hybrid cash and unconverted state are preserved', () => {
  const { a, b, contract, property } = hybridRoom();
  assert.equal(a.cash, 1400);
  assert.equal(b.cash, 1600);
  assert.equal(contract.status, 'active');
  assert.deepEqual(property.equityShares || [], []);
});

check('legacy hybrid conversion target stays encumbered until the note resolves', () => {
  const { game, contract, property, b } = hybridRoom();
  assert.equal(game.isTradeableTile(property), false);
  assert.equal(game.canMortgageTile(b, property), false);
  assert.equal(contract.status, 'active');
});

check('legacy pending hybrid must be rebuilt or declined', () => {
  const { game, contract } = hybridRoom();
  game.playerContracts = [];
  contract.status = 'pending';
  game.pendingPlayerContract = contract;
  assert.match(game.respondPlayerContract('socket-b', true).error, /rebuilt/);
  assert.equal(game.pendingPlayerContract, contract);
  assert.equal(game.respondPlayerContract('socket-b', false).success, true);
});

check('legacy hybrid repays to paid before the due round with finance off', () => {
  const { game, contract } = hybridRoom();
  game.settings.playerFinance = false;
  assert.equal(game.repayPlayerContract('socket-b', { contractId: contract.id }).success, true);
  assert.equal(contract.status, 'paid');
});

check('player-loan repayment rejects a missing lender without destroying cash', () => {
  const { game, b } = startedRoom();
  assert.equal(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100, premiumRate: 10 }).success, true);
  assert.equal(game.respondPlayerContract('socket-b', true).success, true);
  const contract = game.playerContracts[0];
  game.removePlayerByClient('client-a');
  const cashBefore = b.cash;
  const result = game.repayPlayerContract('socket-b', { contractId: contract.id });
  assert.deepEqual(result, { success: false, error: 'That loan is no longer available to repay.' });
  assert.equal(b.cash, cashBefore);
  assert.equal(contract.status, 'active');
});

check('contract acceptance rechecks loan-backed lender cash', () => {
  const { game, a, b } = startedRoom();
  const first = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100 });
  assert.equal(first.success, true);
  a.bankLoan = { status: 'active', remaining: 450 };
  assert.deepEqual(game.respondPlayerContract('socket-b', true, null, first.contract.id), { success: false, error: 'Loan-backed cash cannot be used for player contracts.' });
  assert.equal(game.pendingPlayerContract, null);
  assert.equal(a.cash, 1500);
});

function convertedHybrid() {
  const ctx = hybridRoom();
  ctx.game.settings.playerFinance = false;
  ctx.game.roundNumber = ctx.contract.dueRound;
  ctx.game.processPlayerContracts();
  assert.equal(ctx.contract.status, 'due');
  ctx.game.roundNumber = ctx.contract.cureRound + 1;
  ctx.game.processPlayerContracts();
  return ctx;
}

check('hybrid past cure converts into an equity share', () => {
  const { contract, property, a, b } = convertedHybrid();
  assert.equal(contract.status, 'converted');
  assert.equal(contract.convertedRound != null, true);
  const entry = property.equityShares.find(e => e.contractId === contract.id);
  assert.equal(entry.share, 30);
  assert.equal(entry.holderId, a.id);
  assert.equal(b.properties.includes(1), true);
});

check('converted hybrid equity pays rent and dies with the deed', () => {
  const { game, a, b, contract, property } = convertedHybrid();
  const cashA = a.cash;
  const cashB = b.cash;
  game.settleEquityShares(property, b, 100);
  assert.equal(a.cash, cashA + 30);
  assert.equal(b.cash, cashB - 30);
  game.applyPropertyOwnershipChange(b, a, property);
  assert.equal(contract.status, 'terminated');
});

check('hybrid with a lost conversion target falls back to loan default', () => {
  const { game, contract, property } = hybridRoom();
  game.roundNumber = contract.dueRound;
  game.processPlayerContracts();
  assert.equal(contract.status, 'due');
  property.mortgaged = true;
  game.roundNumber = contract.cureRound + 1;
  game.processPlayerContracts();
  assert.equal(contract.status, 'defaulted');
  assert.deepEqual(property.equityShares || [], []);
});

check('new hybrid proposals reject even valid or invalid collateral explicitly', () => {
  const { game, a, b } = startedRoom();
  const deed = game.getTile(1);
  deed.ownerId = b.id;
  const spare = game.getTile(3);
  for (const ownerId of [b.id, a.id]) {
    spare.ownerId = ownerId;
    const result = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'hybrid', amount: 100, premiumRate: 10, durationRounds: 3, propertyIndex: 1, conversionShare: 25, collateralTileIndex: 3 });
    assert.equal(result.success, false);
    assert.match(result.error, /Hybrid contracts are no longer available/);
    assert.equal(game.pendingPlayerContract, null);
  }
});

// --- W19: contract table invariants ------------------------------------------

const NOT_RUNNING = { success: false, error: 'The game is not running.' };

check('every contract verb is refused once the match is not running', () => {
  const { game, a, b } = startedRoom();
  const proposal = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 50 });
  assert.equal(proposal.success, true);
  game.started = false;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 50, requestId: 'after-end' }), NOT_RUNNING);
  assert.deepEqual(game.proposeEquityShareTransfer('socket-a', { fromPlayerId: a.id, toPlayerId: b.id, contractId: 'any', sharePct: 10, price: 20 }), NOT_RUNNING);
  assert.deepEqual(game.counterPlayerContract('socket-b', { contractId: proposal.contract.id, amount: 60 }), NOT_RUNNING);
  assert.deepEqual(game.adjustPlayerContract('socket-a', { contractId: proposal.contract.id, amount: 60 }), NOT_RUNNING);
  assert.deepEqual(game.respondPlayerContract('socket-b', true, 'after-end-accept', proposal.contract.id), NOT_RUNNING);
  assert.deepEqual(game.repayPlayerContract('socket-b', { contractId: proposal.contract.id }), NOT_RUNNING);
  assert.equal(game.pendingPlayerContract.id, proposal.contract.id, 'the open offer is untouched');
  assert.equal(a.cash, 1500);
  assert.equal(b.cash, 1500);
});

check('a player-loan repayment refuses loan-backed cash', () => {
  const { game, b } = startedRoom();
  const proposal = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100, premiumRate: 10 });
  assert.equal(proposal.success, true);
  assert.equal(game.respondPlayerContract('socket-b', true).success, true);
  const contract = game.playerContracts[0];
  b.bankLoan = { status: 'active', remaining: 450 };
  const cashBefore = b.cash;
  assert.deepEqual(game.repayPlayerContract('socket-b', { contractId: contract.id }), { success: false, error: 'Loan-backed cash cannot be used for player contracts.' });
  assert.equal(b.cash, cashBefore, 'no cash moved');
  assert.equal(contract.status, 'active');
  assert.equal(contract.remaining, 110);
});

check('a loan repayment settles the lender own parked debt', () => {
  const { game, a, b } = startedRoom();
  const proposal = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100 });
  assert.equal(proposal.success, true);
  assert.equal(game.respondPlayerContract('socket-b', true).success, true);
  const contract = game.playerContracts[0];
  game.pendingPayment = { playerId: a.id, creditorId: null, amountRemaining: 50, reason: 'rent' };
  const cashBefore = a.cash;
  assert.equal(game.repayPlayerContract('socket-b', { contractId: contract.id }).success, true);
  assert.equal(a.cash, cashBefore + 100 - 50, 'the repayment paid the lender debt');
  assert.equal(game.pendingPayment, null);
  assert.equal(contract.status, 'paid');
});

// Two live equity shares of the same deed, each 50% of its rent.
function twoHolderEquityRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'two-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'two-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'two-c', nickname: 'C' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [owner, firstHolder, secondHolder] = game.players;
  const property = game.getTile(1);
  property.ownerId = owner.id;
  owner.properties.push(property.index);
  const contractFor = (id, holderId) => {
    const contract = {
      id, kind: 'equity', fromPlayerId: holderId, toPlayerId: owner.id, amount: 100,
      propertyIndex: property.index, equityShare: 50, equityControl: 'passive',
      permanent: false, expiresRound: game.roundNumber + 5, durationRounds: 3,
      createdRound: game.roundNumber, status: 'active'
    };
    game.playerContracts.push(contract);
    return contract;
  };
  contractFor('two-holder-a', firstHolder.id);
  contractFor('two-holder-b', secondHolder.id);
  property.equityShares = [
    { holderId: firstHolder.id, share: 50, contractId: 'two-holder-a', control: 'passive' },
    { holderId: secondHolder.id, share: 50, contractId: 'two-holder-b', control: 'passive' }
  ];
  return { game, owner, firstHolder, secondHolder, property };
}

check('an equity rent share settles the holder debt only after every share is paid', () => {
  const { game, owner, firstHolder, secondHolder, property } = twoHolderEquityRoom();
  owner.cash = 100;
  game.pendingPayment = {
    playerId: firstHolder.id, creditorId: null, amountRemaining: 60, reason: 'rent',
    equityTileIndex: property.index, equityOwnerId: owner.id
  };
  const firstCash = firstHolder.cash;
  const secondCash = secondHolder.cash;
  game.settleEquityShares(property, owner, 100);
  assert.equal(secondHolder.cash - secondCash, 50, 'the other share was paid in full before the debt was settled');
  assert.equal(firstHolder.cash - firstCash, -10, 'the holder paid its own parked debt out of its rent share');
  assert.equal(owner.cash, 0);
  assert.equal(game.pendingPayment, null, 'the parked debt was settled by the rent inflow');
});

check('an equity rent share still settles a distinct queued debt of the recipient', () => {
  const { game, owner, firstHolder, secondHolder, property } = twoHolderEquityRoom();
  owner.cash = 100;
  const firstCash = firstHolder.cash;
  const secondCash = secondHolder.cash;
  // The holder owes two claims of its own, neither of them the rent that the
  // share is paid for: a head claim and a queued one behind it.
  game.pendingPayment = {
    playerId: firstHolder.id, creditorId: secondHolder.id, amountRemaining: 50, reason: 'bank',
    equityTileIndex: null, equityOwnerId: null
  };
  game.pendingPaymentQueue = [{
    payment: {
      playerId: firstHolder.id, creditorId: secondHolder.id, amountRemaining: 30, reason: 'tax',
      equityTileIndex: null, equityOwnerId: null
    },
    hooks: {}, turnOptions: {}
  }];
  game.settleEquityShares(property, owner, 100);
  assert.equal(game.pendingPayment, null, 'the distinct head claim and the queued claim are both settled');
  assert.equal(game.pendingPaymentQueue.length, 0, 'the queue is empty once the claims are paid');
  assert.equal(firstHolder.cash - firstCash, -30, 'the rent share paid the recipient own claims');
  assert.equal(secondHolder.cash - secondCash, 130, 'the creditor of both claims was paid');
});

check('equity payouts never exceed the rent collected', () => {
  const { game, owner, firstHolder, secondHolder, property } = twoHolderEquityRoom();
  // The deed is over-booked: 60% + 60% of the same rent.
  property.equityShares = [
    { holderId: firstHolder.id, share: 60, contractId: 'two-holder-a', control: 'passive' },
    { holderId: secondHolder.id, share: 60, contractId: 'two-holder-b', control: 'passive' }
  ];
  const ownerCash = owner.cash;
  const firstCash = firstHolder.cash;
  const secondCash = secondHolder.cash;
  game.settleEquityShares(property, owner, 100);
  assert.equal(firstHolder.cash - firstCash, 60);
  assert.equal(secondHolder.cash - secondCash, 40, 'the share past 100 percent is prorated away');
  assert.equal(owner.cash, ownerCash - 100, 'the deed never pays out more than the rent collected');
});

check('a failed contract activation moves no cash and keeps the offer open', () => {
  const { game, a, b } = startedRoom();
  const proposal = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100, premiumRate: 10 });
  assert.equal(proposal.success, true);
  game.feedMessage = () => { throw new Error('injected commit failure'); };
  const accepted = game.respondPlayerContract('socket-b', true, 'failed-activation', proposal.contract.id);
  assert.equal(accepted.success, false);
  assert.equal(a.cash, 1500, 'the lender keeps its cash');
  assert.equal(b.cash, 1500, 'the borrower is not paid');
  assert.deepEqual(game.playerContracts, [], 'no half-booked contract');
  assert.equal(game.pendingPlayerContract.id, proposal.contract.id, 'the offer stays open for a retry');
  assert.equal(game.pendingPlayerContract.status, 'pending');
});

const failed = results.filter(r => !r).length;
console.log(`\ncontracts+market tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
