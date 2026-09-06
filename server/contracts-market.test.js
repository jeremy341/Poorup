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
  assert.equal(room.startGame().success, true);
  const game = room.game;
  game.currentPlayerId = game.players[0].id;
  return { room, game, a: game.players[0], b: game.players[1] };
}

check('contract guards run in original order with exact strings', () => {
  const { game, a, b } = startedRoom();
  assert.deepEqual(game.proposePlayerContract('socket-z', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'Choose two active players.' });
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: a.id, amount: 10 }), { success: false, error: 'Choose two active players.' });
  game.currentPlayerId = b.id;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'Player contracts are proposed during your turn.' });
  game.currentPlayerId = a.id;
  game.pendingTrade = { id: 'x' };
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'Resolve the current table obligation first.' });
  game.pendingTrade = null;
  a.cash = 5;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 10 }), { success: false, error: 'The lender does not have enough cash for that offer.' });
  a.cash = 1500;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 'x' }), { success: false, error: 'The lender does not have enough cash for that offer.' });
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 0 }), { success: false, error: 'The lender does not have enough cash for that offer.' });
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

check('loan collateral must be an unencumbered borrower deed', () => {
  const { game, a, b } = startedRoom();
  const wrongOwner = game.getTile(1);
  wrongOwner.ownerId = a.id;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, amount: 50, collateralTileIndex: 1 }), { success: false, error: 'Collateral must be an unencumbered deed owned by the borrower.' });
});

check('equity terms clamp share, verify owner, cap at 100 percent', () => {
  const { game, b } = startedRoom();
  const property = game.getTile(1);
  property.ownerId = b.id;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'equity', amount: 50, propertyIndex: 6 }), { success: false, error: 'Equity needs an unencumbered property owned by the recipient.' });
  const result = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'equity', amount: 50, propertyIndex: 1, equityShare: 3, equityControl: 'hostile' });
  assert.equal(result.success, true);
  const contract = game.pendingPlayerContract;
  assert.equal(contract.equityShare, 5);
  assert.equal(contract.equityControl, 'passive');
  assert.equal(contract.expiresRound, game.roundNumber + 3);
  assert.equal(contract.propertyIndex, 1);
  game.pendingPlayerContract = null;
  property.equityShares = [{ share: 96 }];
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'equity', amount: 50, propertyIndex: 1, equityShare: 5 }), { success: false, error: 'That property has no remaining equity to sell.' });
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
  g2.pendingPayment = { playerId: g2.players[1].id };
  assert.deepEqual(g2.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Resolve the table obligation before trading.' });
  g2.pendingPayment = null;
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

check('requestId replays return the memoized market result', () => {
  const { game, a } = marketRoom();
  a.cash = 10_000;
  const first = game.tradeMarket('socket-a', 'brazil', 'buy', 1, 'r-1');
  assert.equal(first.success, true);
  a.marketActionsThisTurn = 0;
  const replay = game.tradeMarket('socket-a', 'brazil', 'buy', 1, 'r-1');
  assert.equal(replay, first);
});

function hybridRoom(conversionShare = 30) {
  const ctx = startedRoom();
  const property = ctx.game.getTile(1);
  property.ownerId = ctx.b.id;
  ctx.b.properties.push(1);
  const result = ctx.game.proposePlayerContract('socket-a', {
    toPlayerId: ctx.b.id, kind: 'hybrid', amount: 100, premiumRate: 10,
    durationRounds: 2, propertyIndex: 1, conversionShare
  });
  assert.equal(result.success, true);
  return { ...ctx, property, contract: ctx.game.pendingPlayerContract };
}

check('hybrid proposal derives loan math plus conversion share', () => {
  const { game, contract } = hybridRoom();
  assert.equal(contract.totalDue, 110);
  assert.equal(contract.remaining, 110);
  assert.equal(contract.dueRound, game.roundNumber + 2);
  assert.equal(contract.cureRound, contract.dueRound + 1);
  assert.equal(contract.propertyIndex, 1);
  assert.equal(contract.conversionShare, 30);
});

check('hybrid rejects unowned targets, full cap tables, clamps conversion', () => {
  const { game, b, property } = hybridRoom(3);
  assert.equal(game.pendingPlayerContract.conversionShare, 5);
  game.pendingPlayerContract = null;
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'hybrid', amount: 50, propertyIndex: 6, conversionShare: 10 }), { success: false, error: 'Equity needs an unencumbered property owned by the recipient.' });
  property.equityShares = [{ share: 80 }];
  assert.deepEqual(game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'hybrid', amount: 50, propertyIndex: 1, conversionShare: 30 }), { success: false, error: 'That property has no remaining equity to sell.' });
});

check('hybrid accept moves cash with no equity recorded yet', () => {
  const { game, a, b, contract, property } = hybridRoom();
  const cashA = a.cash;
  const cashB = b.cash;
  assert.equal(game.respondPlayerContract('socket-b', true).success, true);
  assert.equal(a.cash, cashA - 100);
  assert.equal(b.cash, cashB + 100);
  assert.equal(contract.status, 'active');
  assert.deepEqual(property.equityShares || [], []);
});

check('hybrid accept revalidates the conversion target at settlement', () => {
  const { game, a, property } = hybridRoom();
  property.ownerId = a.id;
  assert.deepEqual(game.respondPlayerContract('socket-b', true), { success: false, error: 'The equity property is no longer available.' });
});

check('hybrid repays to paid before the due round', () => {
  const { game, contract } = hybridRoom();
  assert.equal(game.respondPlayerContract('socket-b', true).success, true);
  assert.equal(game.repayPlayerContract('socket-b', { contractId: contract.id }).success, true);
  assert.equal(contract.status, 'paid');
});

function convertedHybrid() {
  const ctx = hybridRoom();
  assert.equal(ctx.game.respondPlayerContract('socket-b', true).success, true);
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
  assert.equal(game.respondPlayerContract('socket-b', true).success, true);
  game.roundNumber = contract.dueRound;
  game.processPlayerContracts();
  assert.equal(contract.status, 'due');
  property.mortgaged = true;
  game.roundNumber = contract.cureRound + 1;
  game.processPlayerContracts();
  assert.equal(contract.status, 'defaulted');
  assert.deepEqual(property.equityShares || [], []);
});

const failed = results.filter(r => !r).length;
console.log(`\ncontracts+market tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
