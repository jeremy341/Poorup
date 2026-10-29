// Table-driven pin for the market order gates. MARKET_ORDER_GUARDS checks six pending-flow fields in one predicate, but
// contracts-market and marketExpansion only exercised pendingTrade and pendingPayment, so deleting a term left every market suite green.
// Each case sets one condition on an otherwise clean table and asserts the exact guard error. The same six obligation fields are then
// pinned on the margin, short and option entry points (marketExpansion) and on the casino (economyApi).
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { MARKET_ORDER_GUARDS } from './marketLogic.js';

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

const TABLE_OBLIGATION_TRADE = 'Resolve the table obligation before trading.';
const TABLE_OBLIGATION_CASINO = 'Resolve the table obligation before betting.';

// One truthy value per pending-flow field. The gate sees only the field.
const OBLIGATIONS = [
  ['pendingPayment', { playerId: 'x', creditorId: null, amountRemaining: 10, reason: 'rent' }],
  ['auction', { active: true }],
  ['pendingPurchaseOffer', { playerId: 'x', tileIndex: 1 }],
  ['pendingSponsoredPurchase', { buyerId: 'x', contributions: [] }],
  ['pendingTrade', { id: 't1' }],
  ['pendingPlayerContract', { id: 'c1' }]
];

function tableRoom(settings = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.setRoomSetting('market', true);
  for (const [key, value] of Object.entries(settings)) room.setRoomSetting(key, value);
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

// Each scenario arranges one condition on a clean table. `error` must equal
// the MARKET_ORDER_GUARDS entry that owns that condition.
const TRADE_SCENARIOS = [
  { name: 'market access off', error: 'Market access is off for this room.', arrange: game => { game.settings.market = false; } },
  { name: 'seat disconnected', error: 'Market access is unavailable right now.', arrange: game => { game.players[0].disconnected = true; } },
  { name: 'seat bankrupt', error: 'Market access is unavailable right now.', arrange: game => { game.players[0].bankrupt = true; } },
  { name: 'game not started', error: 'Market access is unavailable right now.', arrange: game => { game.started = false; } },
  { name: 'not your turn', error: 'Market orders are available during your turn.', arrange: game => { game.currentPlayerId = game.players[1].id; } },
  { name: 'second order this turn', error: 'You have already placed a market order this turn.', arrange: game => { game.players[0].marketActionsThisTurn = 1; } },
  ...OBLIGATIONS.map(([field, value]) => ({
    name: `pending ${field} alone`,
    error: TABLE_OBLIGATION_TRADE,
    arrange: game => { game[field] = value; }
  })),
  {
    name: 'margin maintenance due',
    error: 'Settle your margin maintenance before trading.',
    arrange: game => { Object.assign(game.players[0], { marginBalance: 1000, marginMaintenance: 250 }); }
  },
  {
    name: 'short buy-in debt unpaid',
    error: 'Settle your short buy-in debt before trading.',
    arrange: game => { game.players[0].shortDefaultDebt = 100; }
  },
  {
    name: 'global event halts trading',
    error: 'Market trading is paused by the active global event.',
    arrange: game => { game.globalEvent = { id: 'halt', phase: 'active', effects: { tradingEnabled: false } }; }
  }
];

check('order gate table has a scenario for every MARKET_ORDER_GUARDS entry', () => {
  const covered = new Set(TRADE_SCENARIOS.map(scenario => scenario.error));
  for (const guard of MARKET_ORDER_GUARDS) {
    assert.ok(covered.has(guard.error), `no scenario exercises guard "${guard.error}"`);
  }
});

check('clean table accepts the same market buy the scenarios reject', () => {
  const room = tableRoom();
  const result = room.game.tradeMarket('socket-a', 'brazil', 'buy', 1);
  assert.equal(result.success, true, JSON.stringify(result));
});

// A margin call must not lock the seat out of the risk-reducing side of the
// book: selling raises the cash that repays the maintenance, so the gate may
// only stop orders that add exposure.
check('a sell stays available while margin maintenance is due', () => {
  const room = tableRoom();
  const player = room.game.players[0];
  Object.assign(player, {
    marginBalance: 1000,
    marginMaintenance: 250,
    marketPositions: { brazil: { quantity: 2, averageCost: 100, realizedPnl: 0 } }
  });
  assert.deepEqual(room.game.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Settle your margin maintenance before trading.' });
  const sell = room.game.tradeMarket('socket-a', 'brazil', 'sell', 1);
  assert.equal(sell.success, true, JSON.stringify(sell));
  assert.equal(player.marketPositions.brazil.quantity, 1);
  assert.ok(player.cash > 1500, 'the sale credits the cash that repays the maintenance');
});

// An unpaid short buy-in is a forced obligation to the house. The spot book
// honours the same check the expansion ladder applies.
check('a spot order is refused while short buy-in debt is unpaid', () => {
  const room = tableRoom();
  room.game.players[0].shortDefaultDebt = 100;
  assert.deepEqual(room.game.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Settle your short buy-in debt before trading.' });
});

// The buy-in gate may only stop orders that add exposure. A sell raises the cash that repays the debt, so refusing it would trap
// the seat in the obligation it must settle, the same rule the margin-maintenance gate uses above.
check('a sell stays available while short buy-in debt is unpaid', () => {
  const room = tableRoom();
  const player = room.game.players[0];
  player.marketPositions = { brazil: { quantity: 2, averageCost: 100, realizedPnl: 0 } };
  player.shortDefaultDebt = 100;
  assert.deepEqual(room.game.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Settle your short buy-in debt before trading.' });
  const sell = room.game.tradeMarket('socket-a', 'brazil', 'sell', 1);
  assert.equal(sell.success, true, JSON.stringify(sell));
  assert.equal(player.marketPositions.brazil.quantity, 1);
  assert.ok(player.cash > 1500, 'the sale credits the cash that repays the buy-in debt');
});

for (const scenario of TRADE_SCENARIOS) {
  check(`tradeMarket rejects with its own guard when ${scenario.name}`, () => {
    const room = tableRoom();
    scenario.arrange(room.game);
    assert.deepEqual(room.game.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: scenario.error });
  });
}

// Margin, short and option entry points share expansionGuard. The obligation
// check sits in expansionTurnRejection, so every entry must reject with it.
const EXPANSION_ENTRIES = [
  ['openMargin', room => room.openMargin('socket-a', 'brazil', 1, 'exp-open-margin')],
  ['reduceMargin', room => room.reduceMargin('socket-a', 10, 'exp-reduce-margin')],
  ['openShort', room => room.openShort('socket-a', 'brazil', 1, 'exp-open-short')],
  ['coverShort', room => room.coverShort('socket-a', 'brazil', 1, 'exp-cover-short')],
  ['openOption', room => room.openOption('socket-a', { instrumentId: 'brazil', quantity: 1, premium: 1, requestId: 'exp-open-option' })],
  ['exerciseOption', room => room.exerciseOption('socket-a', 'missing-option', 'exp-exercise-option')],
  ['closePosition', room => room.closePosition('socket-a', 'missing-option', 'exp-close-position')]
];

check('expansion entry points accept a clean margin open before obligations are set', () => {
  const room = tableRoom({ marketComplexity: 'derivatives' });
  assert.equal(room.openMargin('socket-a', 'brazil', 1, 'exp-baseline').success, true);
});

for (const [field, value] of OBLIGATIONS) {
  check(`margin/short/option entries reject while pending ${field} is set`, () => {
    const room = tableRoom({ marketComplexity: 'derivatives' });
    room.game[field] = value;
    for (const [entry, call] of EXPANSION_ENTRIES) {
      assert.deepEqual(call(room), { success: false, error: TABLE_OBLIGATION_TRADE }, `${entry} with ${field}`);
    }
  });
}

// The casino wheel uses its own obligation list in economyApi.js. It has the
// same six fields and must keep its own error string.
check('casino baseline is not blocked by the obligation gate on a clean table', () => {
  const room = tableRoom({ casino: true });
  const result = room.placeCasinoBet('socket-a', 'red', 10, 'casino-baseline');
  assert.notEqual(result.error, TABLE_OBLIGATION_CASINO);
});

for (const [field, value] of OBLIGATIONS) {
  check(`casino rejects while pending ${field} is set`, () => {
    const room = tableRoom({ casino: true });
    room.game[field] = value;
    assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 10, `casino-${field}`), { success: false, error: TABLE_OBLIGATION_CASINO });
  });
}

const failed = results.filter(result => !result).length;
console.log(`\nmarket order guards: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
