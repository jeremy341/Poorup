import assert from 'node:assert/strict';
import { GameState, RoomManager } from './gameLogic.js';
import { freshMarketQuotes, MARKET_INSTRUMENTS } from './marketLogic.js';

function startedRoom({ market = true } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', market);
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return { room, game: room.game, a: room.game.players[0], b: room.game.players[1] };
}

const cases = [
  ['seedsSharedRoundZeroBaseline', () => {
    const freshGame = new GameState({ market: true });
    assert.deepEqual(freshGame.marketQuoteHistory[0], { round: 0, quotes: freshMarketQuotes(), eventId: null });
    const { game } = startedRoom();
    assert.equal(game.marketQuoteHistory.length, 1);
    assert.deepEqual(game.marketQuoteHistory[0], { round: 0, quotes: freshMarketQuotes(), eventId: null });
    game.marketQuotes.brazil = 175;
    game.resetForNewGame();
    assert.deepEqual(game.marketQuoteHistory[0], { round: 0, quotes: freshMarketQuotes(), eventId: null });
  }],
  ['appendsExactlyOnceAfterEachEnabledMarketRound', () => {
    const { game } = startedRoom();
    game.advanceRound();
    assert.equal(game.marketQuoteHistory.length, 2);
    game.advanceRound();
    assert.equal(game.marketQuoteHistory.length, 3);
    assert.deepEqual(game.marketQuoteHistory.map(point => point.round), [0, 1, 2]);
  }],
  ['capsHistoryAt128Points', () => {
    const { game } = startedRoom();
    for (let i = 0; i < 130; i += 1) game.advanceRound();
    assert.equal(game.marketQuoteHistory.length, 128);
    assert.equal(game.marketQuoteHistory[0].round, 3);
    assert.equal(game.marketQuoteHistory.at(-1).round, 130);
  }],
  ['capturesPostShockQuotesAndOnlyActiveEventId', () => {
    const { game } = startedRoom();
    game.globalEvent = { id: 'test-shock', phase: 'warning', startedRound: 0, durationRounds: 5, effects: { marketPriceMultiplier: 2 } };
    game.advanceRound();
    const point = game.marketQuoteHistory.at(-1);
    assert.equal(point.eventId, 'test-shock');
    for (const instrument of MARKET_INSTRUMENTS) {
      assert.ok(point.quotes[instrument.id] > 150, `${instrument.id} should contain post-shock quote`);
    }
    game.globalEvent = { id: 'future-event', phase: 'warning', effects: { marketPriceMultiplier: 3 } };
    game.advanceRound();
    assert.equal(game.marketQuoteHistory.at(-1).eventId, null);
  }],
  ['disabledMarketDoesNotAppend', () => {
    const { game } = startedRoom({ market: false });
    assert.equal(game.marketQuoteHistory.length, 1);
    game.advanceRound();
    assert.equal(game.marketQuoteHistory.length, 1);
    assert.equal(game.marketRound, 0);
  }],
  ['snapshotsCloneHistoryForEverySeat', () => {
    const { room, game, a, b } = startedRoom();
    game.advanceRound();
    const first = game.economySnapshot(a.id).market;
    const second = game.economySnapshot(b.id).market;
    assert.deepEqual(first.quoteHistory, second.quoteHistory);
    first.quoteHistory[0].quotes.brazil = -1;
    first.quoteHistory.pop();
    assert.equal(game.marketQuoteHistory.length, 2);
    assert.equal(game.marketQuoteHistory[0].quotes.brazil, 100);
    const summary = game.getGameSummary(a.id);
    assert.deepEqual(summary.economy.market.quoteHistory, second.quoteHistory);
    summary.economy.market.quoteHistory[0].quotes.brazil = 1;
    assert.equal(game.marketQuoteHistory[0].quotes.brazil, 100);
  }],
  ['legacyMissingHistoryFallsBackSafely', () => {
    const { game, a } = startedRoom();
    delete game.marketQuoteHistory;
    const snapshot = game.economySnapshot(a.id).market;
    assert.deepEqual(snapshot.quoteHistory, [{ round: game.marketRound, quotes: freshMarketQuotes(), eventId: null }]);
    assert.deepEqual(game.summaryEconomy().market.quoteHistory, snapshot.quoteHistory);
    game.marketQuoteHistory = [{ round: 0, quotes: { ...freshMarketQuotes(), brazil: 0 }, eventId: null }];
    assert.deepEqual(game.economySnapshot(a.id).market.quoteHistory, snapshot.quoteHistory);
  }],
  ['marketOrdersDoNotMutateSharedQuotesOrHistory', () => {
    const { room, game, a } = startedRoom();
    const beforeQuotes = { ...game.marketQuotes };
    const beforeHistory = structuredClone(game.marketQuoteHistory);
    const result = room.tradeMarket('a', 'brazil', 'buy', 1);
    assert.equal(result.success, true);
    assert.deepEqual(game.marketQuotes, beforeQuotes);
    assert.deepEqual(game.marketQuoteHistory, beforeHistory);
  }]
];

let passed = 0;
const failures = [];
for (const [name, run] of cases) {
  try {
    run();
    passed += 1;
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push([name, error]);
    console.error(`FAIL - ${name}: ${error.message}`);
  }
}

const ids = Object.keys(freshMarketQuotes());
assert.deepEqual(ids, MARKET_INSTRUMENTS.map(instrument => instrument.id));
assert.ok(Object.values(freshMarketQuotes()).every(quote => Number.isInteger(quote) && quote > 0));
console.log(`market quote history: ${cases.length} cases — ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
