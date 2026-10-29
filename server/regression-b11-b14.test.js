// Regression suite for two audit findings.
//
// B-11  economyApi.marketSnapshot spread the position maps shallowly, so the
//       returned economy payload aliased the live mutable position objects.
//       marketLogic mutates them in place, and every cacheTransaction call site
//       replays that payload verbatim on a duplicate requestId, so an already
//       returned snapshot rewrote itself retroactively.
//
// B-14  loanLogic.premiumRateAfterEvents applied the inflation-spiral premium
//       twice: once from a hardcoded 1.25 and again from the declared
//       loanPremiumMultiplier, overcharging every loan originated during it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { bankLoanTerms, takeBankLoan } from './loanLogic.js';
import { GLOBAL_EVENT_COMBINATIONS, GLOBAL_EVENT_SETTLEMENT_STEPS } from './globalEventData.js';

// The exact engine-written key sets. This is a serialized wire payload, so the
// deep copy must not add, drop, or rename anything.
const MARKET_POSITION_KEYS = ['averageCost', 'quantity', 'realizedPnl'];
const MARGIN_POSITION_KEYS = ['averageCost', 'quantity'];
const SHORT_POSITION_KEYS = ['borrowFee', 'collateral', 'entryQuote', 'quantity'];

function marketRoom(complexity) {
  const room = new RoomManager().createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', marketComplexity: complexity });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', true);
  room.setRoomSetting('marketComplexity', complexity);
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return { room, game: room.game, a: room.game.players[0], b: room.game.players[1] };
}

function loanRoom() {
  const room = new RoomManager().createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('globalEvents', true);
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return { room, game: room.game, a: room.game.players[0], b: room.game.players[1] };
}

// Drive an event all the way to the ACTIVE phase the way the round ladder does,
// so the pricing under test reads the declared effects object the engine built
// (never a hand-written stand-in). Events with a policy ballot resolve once every
// active seat has voted. The round turn is rewound afterwards so the borrowing
// seat is still the current player.
function activateEvent(game, { id = null, comboId = null, choiceId = null } = {}) {
  const combo = comboId ? GLOBAL_EVENT_COMBINATIONS.find(entry => entry.id === comboId) : null;
  if (comboId) assert.ok(combo, `unknown global-event combination: ${comboId}`);
  game.activateGlobalEvent(game.globalEventDefinition(combo ? combo.required[0] : id), combo);
  if (game.globalEvent.choices) {
    const choice = choiceId || game.globalEvent.choices.at(-1).id;
    game.activePlayers().forEach(player => {
      assert.equal(game.voteGlobalEvent(player.socketId, choice).success, true);
    });
  } else {
    game.advanceRound();
  }
  assert.equal(game.globalEvent.phase, 'active', `${comboId || id} should be active`);
  game.currentPlayerId = game.players[0].id;
  return game.globalEvent;
}

// ---------------------------------------------------------------- B-11 -----

test('B-11 marketSnapshot never aliases the live position objects', () => {
  const { room, game, a } = marketRoom('shorting');
  assert.equal(room.tradeMarket('a', 'brazil', 'buy', 1, 'b11-spot').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openMargin('a', 'ghana', 2, 'b11-margin').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openShort('a', 'japan', 1, 'b11-short').success, true);

  const snapshot = game.economySnapshot(a.id).market;
  assert.notEqual(snapshot.positions.brazil, a.marketPositions.brazil, 'market positions aliased');
  assert.notEqual(snapshot.margin.positions.ghana, a.marginPositions.ghana, 'margin positions aliased');
  assert.notEqual(snapshot.shorts.positions.japan, a.shortPositions.japan, 'short positions aliased');
  // The map objects themselves were never aliased - a shallow spread already
  // made a fresh one. Only the per-instrument values were shared.
  assert.notEqual(snapshot.positions, a.marketPositions);
  assert.notEqual(snapshot.margin.positions, a.marginPositions);
  assert.notEqual(snapshot.shorts.positions, a.shortPositions);
});

test('B-11 mutating a snapshot leaves every live position book untouched', () => {
  const { room, game, a } = marketRoom('shorting');
  assert.equal(room.tradeMarket('a', 'brazil', 'buy', 1, 'b11-spot').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openMargin('a', 'ghana', 2, 'b11-margin').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openShort('a', 'japan', 1, 'b11-short').success, true);

  const live = {
    market: structuredClone(a.marketPositions),
    margin: structuredClone(a.marginPositions),
    short: structuredClone(a.shortPositions)
  };
  const snapshot = game.economySnapshot(a.id).market;
  // Scribble over the snapshot the way a hostile or buggy client would.
  snapshot.positions.brazil.quantity = -1;
  snapshot.positions.brazil.averageCost = -1;
  snapshot.positions.brazil.realizedPnl = -1;
  delete snapshot.positions.brazil;
  snapshot.positions.injected = { quantity: 1, averageCost: 1, realizedPnl: 1 };
  snapshot.margin.positions.ghana.quantity = -1;
  snapshot.margin.positions.ghana.averageCost = -1;
  delete snapshot.margin.positions.ghana;
  snapshot.shorts.positions.japan.quantity = -1;
  snapshot.shorts.positions.japan.entryQuote = -1;
  snapshot.shorts.positions.japan.collateral = -1;
  snapshot.shorts.positions.japan.borrowFee = -1;
  delete snapshot.shorts.positions.japan;

  assert.deepEqual(a.marketPositions, live.market);
  assert.deepEqual(a.marginPositions, live.margin);
  assert.deepEqual(a.shortPositions, live.short);
  assert.equal(Object.hasOwn(a.marketPositions, 'injected'), false);
});

test('B-11 in-place order legs cannot rewrite an already-returned snapshot', () => {
  const { room, game, a } = marketRoom('shorting');
  assert.equal(room.tradeMarket('a', 'brazil', 'buy', 1, 'b11-spot').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openMargin('a', 'ghana', 2, 'b11-margin').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openShort('a', 'japan', 1, 'b11-short').success, true);

  const taken = game.economySnapshot(a.id).market;
  const captured = {
    market: structuredClone(taken.positions),
    margin: structuredClone(taken.margin.positions),
    short: structuredClone(taken.shorts.positions)
  };

  // applyMarketBuy / openMargin / openShort all write straight into the live
  // position object, then reassign the same reference into the player.
  a.marketActionsThisTurn = 0;
  assert.equal(room.tradeMarket('a', 'brazil', 'buy', 3, 'b11-spot-2').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openMargin('a', 'ghana', 1, 'b11-margin-2').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openShort('a', 'japan', 2, 'b11-short-2').success, true);

  assert.equal(a.marketPositions.brazil.quantity, 4);
  assert.equal(a.marginPositions.ghana.quantity, 3);
  assert.equal(a.shortPositions.japan.quantity, 3);
  assert.deepEqual(taken.positions, captured.market);
  assert.deepEqual(taken.margin.positions, captured.margin);
  assert.deepEqual(taken.shorts.positions, captured.short);
});

test('B-11 position snapshots keep the exact key set and value shape', () => {
  const { room, game, a } = marketRoom('shorting');
  assert.equal(room.tradeMarket('a', 'brazil', 'buy', 1, 'b11-spot').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openMargin('a', 'ghana', 2, 'b11-margin').success, true);
  a.marketActionsThisTurn = 0;
  assert.equal(room.openShort('a', 'japan', 1, 'b11-short').success, true);

  const snapshot = game.economySnapshot(a.id).market;
  assert.deepEqual(Object.keys(snapshot.positions).sort(), Object.keys(a.marketPositions).sort());
  assert.deepEqual(Object.keys(snapshot.margin.positions).sort(), Object.keys(a.marginPositions).sort());
  assert.deepEqual(Object.keys(snapshot.shorts.positions).sort(), Object.keys(a.shortPositions).sort());
  assert.deepEqual(Object.keys(snapshot.positions.brazil).sort(), MARKET_POSITION_KEYS);
  assert.deepEqual(Object.keys(snapshot.margin.positions.ghana).sort(), MARGIN_POSITION_KEYS);
  assert.deepEqual(Object.keys(snapshot.shorts.positions.japan).sort(), SHORT_POSITION_KEYS);
  // Values must be faithful copies, not transformed or re-keyed numbers.
  assert.deepEqual(snapshot.positions, a.marketPositions);
  assert.deepEqual(snapshot.margin.positions, a.marginPositions);
  assert.deepEqual(snapshot.shorts.positions, a.shortPositions);
  // Empty and missing books still serialize as plain empty objects.
  const empty = game.economySnapshot(game.players[1].id).market;
  assert.deepEqual(empty.positions, {});
  assert.deepEqual(empty.margin.positions, {});
  assert.deepEqual(empty.shorts.positions, {});
  const spectator = game.economySnapshot().market;
  assert.deepEqual(spectator.positions, {});
  assert.equal(spectator.margin, null);
  assert.equal(spectator.shorts, null);
});

test('B-11 a replayed requestId returns the original positions, not the live ones', () => {
  const { room, game, a } = marketRoom('basic');
  const first = room.tradeMarket('a', 'brazil', 'buy', 1, 'b11-replay');
  assert.equal(first.success, true);
  const frozenOrder = structuredClone(first.order);
  const frozenPositions = structuredClone(first.economy.market.positions);
  const frozenCash = a.cash;
  assert.equal(frozenPositions.brazil.quantity, 1);

  // A second, distinct order moves the live position on.
  a.marketActionsThisTurn = 0;
  const second = room.tradeMarket('a', 'brazil', 'buy', 4, 'b11-next');
  assert.equal(second.success, true);
  assert.equal(a.marketPositions.brazil.quantity, 5);
  assert.notEqual(a.cash, frozenCash);
  assert.equal(second.economy.market.positions.brazil.quantity, 5);

  // Replaying the first requestId must serve the cached response verbatim:
  // the receipt stayed frozen, so the positions have to stay frozen too.
  const replay = room.tradeMarket('a', 'brazil', 'buy', 1, 'b11-replay');
  assert.equal(replay, first);
  assert.deepEqual(replay.order, frozenOrder);
  assert.deepEqual(replay.economy.market.positions, frozenPositions);
  assert.deepEqual(first.economy.market.positions, frozenPositions);
  assert.equal(first.economy.market.positions.brazil.quantity, 1);
  // And the live book is still the newer one.
  assert.equal(game.economySnapshot(a.id).market.positions.brazil.quantity, 5);
});

test('B-11 a cached casino replay freezes balanceAfter and positions together', () => {
  const room = new RoomManager().createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', true);
  room.setRoomSetting('casino', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const a = game.players[0];
  game.currentPlayerId = a.id;

  assert.equal(room.tradeMarket('a', 'brazil', 'buy', 1, 'b11-casino-spot').success, true);
  const spin = room.placeCasinoBet('a', 'red', 10, 'b11-casino');
  assert.equal(spin.success, true);
  const frozenBalanceAfter = spin.result.balanceAfter;
  const frozenPositions = structuredClone(spin.economy.market.positions);
  assert.equal(frozenPositions.brazil.quantity, 1);

  // A later market order rewrites the live position object in place.
  a.marketActionsThisTurn = 0;
  assert.equal(room.tradeMarket('a', 'brazil', 'buy', 6, 'b11-casino-spot-2').success, true);
  assert.equal(a.marketPositions.brazil.quantity, 7);

  const replay = room.placeCasinoBet('a', 'red', 10, 'b11-casino');
  assert.equal(replay, spin);
  assert.equal(replay.result.balanceAfter, frozenBalanceAfter);
  assert.deepEqual(replay.economy.market.positions, frozenPositions);
  assert.equal(replay.economy.market.positions.brazil.quantity, 1);
  // The live book moved on; only the replay stayed put.
  assert.equal(game.economySnapshot(a.id).market.positions.brazil.quantity, 7);
});

// ---------------------------------------------------------------- B-14 -----

test('B-14 no active event leaves the plain base premium', () => {
  const { game, a } = loanRoom();
  assert.equal(game.globalEvent, null);
  const terms = bankLoanTerms(game, a);
  assert.equal(terms.severity, 'predatory');
  assert.equal(terms.principal, 300);
  assert.equal(terms.premium, 150);
  assert.equal(terms.totalDue, 450);
});

test('B-14 inflation-spiral applies its declared 1.25 exactly once', () => {
  const { game, a } = loanRoom();
  const definition = game.globalEventDefinition('inflation-spiral');
  assert.equal(definition.effects.loanPremiumMultiplier, 1.25);
  const event = activateEvent(game, { id: 'inflation-spiral' });
  assert.equal(event.effects.loanPremiumMultiplier, 1.25);

  // 300 + ceil(300 * 0.5 * 1.25) = 300 + ceil(187.5) = 488. The old double
  // application produced 300 + ceil(300 * 0.5 * 1.25 * 1.25) = 535.
  const terms = bankLoanTerms(game, a);
  assert.equal(terms.premium, 188);
  assert.equal(terms.totalDue, 488);
  assert.notEqual(terms.totalDue, 535);

  // ...and that is what an actual origination charges.
  a.cash = 0;
  const issued = takeBankLoan(game, 'a', 'b14-inflation');
  assert.equal(issued.success, true);
  assert.equal(issued.loan.totalDue, 488);
  assert.equal(issued.loan.remaining, 488);
  assert.equal(a.cash, 300);
});

test('B-14 every other premium event still applies its declared multiplier once', () => {
  const cases = [
    { id: 'interest-rate-shock', multiplier: 1.35, totalDue: 503 },
    { id: 'debt-amnesty', multiplier: 1.15, totalDue: 473 },
    { id: 'stagflation', comboId: 'stagflation', multiplier: 1.5, totalDue: 525 },
    { id: 'moral-hazard', comboId: 'moral-hazard', choiceId: 'let-the-ledger-run', multiplier: 1.6, totalDue: 540 }
  ];
  for (const entry of cases) {
    const { game, a } = loanRoom();
    const event = activateEvent(game, {
      id: entry.id,
      comboId: entry.comboId || null,
      choiceId: entry.choiceId || null
    });
    assert.equal(event.id, entry.id);
    assert.equal(event.effects.loanPremiumMultiplier, entry.multiplier);
    const terms = bankLoanTerms(game, a);
    assert.equal(terms.premium, Math.ceil(300 * 0.5 * entry.multiplier), `${entry.id} premium`);
    assert.equal(terms.totalDue, entry.totalDue, `${entry.id} totalDue`);
  }
});

test('B-14 the bank-first election discount still applies, alone and combined', () => {
  const bankFirst = loanRoom();
  activateEvent(bankFirst.game, { id: 'city-election', choiceId: 'bank-first' });
  assert.equal(bankFirst.game.globalEvent.resolvedChoice, 'bank-first');
  // 300 + ceil(300 * 0.5 * 0.8) = 420
  assert.equal(bankLoanTerms(bankFirst.game, bankFirst.a).totalDue, 420);

  const otherPlatform = loanRoom();
  activateEvent(otherPlatform.game, { id: 'city-election', choiceId: 'low-tax' });
  assert.equal(bankLoanTerms(otherPlatform.game, otherPlatform.a).totalDue, 450);

  // Ordering probe: the declared multiplier lands before the election shave and
  // each is applied exactly once. 300 + ceil(300 * 0.5 * 1.25 * 0.8) = 450.
  const combined = loanRoom();
  combined.game.globalEvent = { id: 'city-election', phase: 'active', resolvedChoice: 'bank-first', effects: { loanPremiumMultiplier: 1.25 } };
  assert.equal(bankLoanTerms(combined.game, combined.a).totalDue, 450);
});

test('B-14 inflation-spiral still reprices loans taken before the event, once', () => {
  const { game, a } = loanRoom();
  a.cash = 0;
  const issued = takeBankLoan(game, 'a', 'b14-preexisting');
  assert.equal(issued.success, true);
  assert.equal(issued.loan.totalDue, 450);
  assert.equal(issued.loan.remaining, 450);

  // The activation-time reprice table is unchanged by the origination fix.
  const reprice = GLOBAL_EVENT_SETTLEMENT_STEPS.find(step => step.handler === 'settleInterestRateShock');
  assert.equal(reprice.appliesTo(game, { id: 'inflation-spiral', effects: { loanPremiumMultiplier: 1.25 } }), true);

  activateEvent(game, { id: 'inflation-spiral' });
  assert.equal(a.bankLoan.remaining, 563, 'the full $450 balance repriced by 1.25 exactly once');
  assert.equal(a.bankLoan.totalDue, 563);
  // The settlementApplied guard keeps the reprice from compounding on later rounds.
  game.applyGlobalEventActivationSettlements();
  assert.equal(a.bankLoan.remaining, 563);
  assert.equal(a.bankLoan.totalDue, 563);
});