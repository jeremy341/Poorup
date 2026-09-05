// Characterization suite for the trade negotiation and bot-candidate
// generator regions of GameState (proposeTrade / respondToTrade /
// getBotCandidates). Every assertion is pinned against the pre-refactor
// implementation: exact rejection strings, escrow/settlement cash math,
// ownership deltas, pendingTrade lifecycle, feed texts, and full deep-equal
// candidate arrays (id/kind/score/risk and tie-order) per personality and
// cash level. getBotCandidates uses no RNG (market quotes and loan terms are
// deterministic here), so no Math.random stubbing is required.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL - ${name}: ${error && error.message}`);
  }
}

// --- Fixtures ---------------------------------------------------------------

function makeRoom(roomCode, nicknames) {
  const manager = new RoomManager();
  const [first, ...rest] = nicknames;
  const room = manager.createRoom({ socketId: `socket-${first.toLowerCase()}`, clientId: `client-${first.toLowerCase()}`, nickname: first, roomCode });
  rest.forEach(nickname => {
    room.addOrReconnectPlayer({ socketId: `socket-${nickname.toLowerCase()}`, clientId: `client-${nickname.toLowerCase()}`, nickname });
  });
  assert.equal(room.startGame().success, true);
  return room;
}

function tradeRoom() {
  return makeRoom('TRADE01', ['A', 'B']);
}

function trioRoom() {
  return makeRoom('TRADE02', ['A', 'B', 'C']);
}

function playerOf(room, clientId) {
  return room.game.getPlayerByClient(clientId);
}

function own(room, player, indexes) {
  indexes.forEach(index => {
    room.game.getTile(index).ownerId = player.id;
    player.properties.push(index);
  });
}

// --- proposeTrade: rejection matrix ------------------------------------------

check('propose rejects unknown partner, self-trade, and unknown sender', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: 'ghost', requestCash: 10 }), { success: false, error: 'Choose a valid trade partner.' });
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: a.id, requestCash: 10 }), { success: false, error: 'Choose a valid trade partner.' });
  assert.deepEqual(game.proposeTrade('socket-zz', { toPlayerId: a.id, requestCash: 10 }), { success: false, error: 'Choose a valid trade partner.' });
  assert.deepEqual(game.proposeTrade('socket-a', {}), { success: false, error: 'Choose a valid trade partner.' });
  assert.equal(game.pendingTrade, null);
});

check('propose rejects bankrupt or disconnected participants', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  b.bankrupt = true;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }), { success: false, error: 'Both players must be active to trade.' });
  b.bankrupt = false;
  b.disconnected = true;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }), { success: false, error: 'Both players must be active to trade.' });
  b.disconnected = false;
  a.bankrupt = true;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }), { success: false, error: 'Both players must be active to trade.' });
  a.bankrupt = false;
  a.disconnected = true;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }), { success: false, error: 'Both players must be active to trade.' });
});

check('propose rejects while a trade is pending and does not replace it', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const first = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 });
  assert.equal(first.success, true);
  const second = game.proposeTrade('socket-b', { toPlayerId: a.id, giveCash: 5 });
  assert.deepEqual(second, { success: false, error: 'Another trade is already pending.' });
  assert.equal(game.pendingTrade.id, first.trade.id);
  assert.equal(game.feed.filter(entry => entry.text.includes('sent a trade offer')).length, 1);
});

check('propose rejects while a player contract is pending', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  game.currentPlayerId = a.id;
  const contract = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 50, premiumRate: 10, durationRounds: 2 });
  assert.equal(contract.success, true);
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }), { success: false, error: 'Another trade is already pending.' });
  assert.equal(game.pendingPlayerContract.id, contract.contract.id);
});

check('propose rejects empty offers', () => {
  const room = tradeRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id }), { success: false, error: 'Choose at least one cash or property item to include in the trade.' });
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 0, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [] }), { success: false, error: 'Choose at least one cash or property item to include in the trade.' });
  // Negative cash clamps to 0 first, so the offer is still empty.
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: -100 }), { success: false, error: 'Choose at least one cash or property item to include in the trade.' });
});

check('propose rejects non-finite cash and checks finiteness before properties', () => {
  const room = tradeRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 'abc' }), { success: false, error: 'Cash values must be valid numbers.' });
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 'xyz', givePropertyIndexes: [99] }), { success: false, error: 'Cash values must be valid numbers.' });
});

check('propose rejects offered tiles not owned, encumbered, or unknown', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1, 6]);
  const giveError = 'You can only offer properties that you own and that have no houses, hotels, or mortgage.';
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [3] }), { success: false, error: giveError });
  game.getTile(1).houseCount = 1;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1] }), { success: false, error: giveError });
  game.getTile(1).houseCount = 0;
  game.getTile(1).mortgaged = true;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1] }), { success: false, error: giveError });
  game.getTile(1).mortgaged = false;
  game.getTile(6).equityShares = [{ holderId: b.id, share: 20 }];
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [6] }), { success: false, error: giveError });
  game.getTile(6).equityShares = [];
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [999] }), { success: false, error: giveError });
  assert.equal(game.pendingTrade, null);
});

check('propose rejects requested tiles not owned by the partner or encumbered', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, b, [1]);
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestPropertyIndexes: [3] }), { success: false, error: 'The requested properties are not available for trade.' });
  game.getTile(1).houseCount = 2;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestPropertyIndexes: [1] }), { success: false, error: 'The requested properties are not available for trade.' });
  game.getTile(1).houseCount = 0;
  // The offered-property error wins over the requested-property one.
  own(room, a, [6]);
  game.getTile(6).mortgaged = true;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [6], requestPropertyIndexes: [3] }), { success: false, error: 'You can only offer properties that you own and that have no houses, hotels, or mortgage.' });
});

check('propose rejects when the sender cannot cover the offered cash', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  a.cash = 90;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100 }), { success: false, error: 'You do not have enough cash for this offer.' });
  assert.equal(game.pendingTrade, null);
});

// --- proposeTrade: acceptance and normalization -------------------------------

check('propose accepts a cash-only offer, stores normalized legs, and feeds', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const result = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100, requestCash: 50 });
  assert.equal(result.success, true);
  const trade = game.pendingTrade;
  assert.equal(result.trade, trade);
  assert.equal(typeof trade.id, 'string');
  assert.equal(trade.fromPlayerId, a.id);
  assert.equal(trade.fromPlayerName, 'A');
  assert.equal(trade.toPlayerId, b.id);
  assert.equal(trade.toPlayerName, 'B');
  assert.equal(trade.giveCash, 100);
  assert.equal(trade.requestCash, 50);
  assert.deepEqual(trade.givePropertyIndexes, []);
  assert.deepEqual(trade.requestPropertyIndexes, []);
  assert.equal(typeof trade.createdAt, 'number');
  assert.equal(game.feed[0].text, 'A sent a trade offer to B.');
  assert.equal(a.cash, 1500);
  assert.equal(b.cash, 1500);
});

check('propose normalizes malformed legs: non-array to empty, strings to numbers, negatives to zero', () => {
  const room = tradeRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  const missing = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 5, givePropertyIndexes: 'nope' });
  assert.equal(missing.success, true);
  assert.deepEqual(missing.trade.givePropertyIndexes, []);
  assert.deepEqual(missing.trade.requestPropertyIndexes, []);
  const room2 = tradeRoom();
  own(room2, playerOf(room2, 'client-a'), [1, 3]);
  const b2 = playerOf(room2, 'client-b');
  const stringy = room2.game.proposeTrade('socket-a', { toPlayerId: b2.id, givePropertyIndexes: ['1', 3], giveCash: -7, requestCash: '12' });
  assert.equal(stringy.success, true);
  assert.deepEqual(stringy.trade.givePropertyIndexes, [1, 3]);
  assert.equal(stringy.trade.giveCash, 0);
  assert.equal(stringy.trade.requestCash, 12);
});

check('room-level proposeTrade and respondToTrade delegate to the game', () => {
  const room = tradeRoom();
  const b = playerOf(room, 'client-b');
  const result = room.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 20 });
  assert.equal(result.success, true);
  assert.equal(room.game.pendingTrade.id, result.trade.id);
  assert.deepEqual(room.respondToTrade('socket-b', { tradeId: result.trade.id, accept: false }), { success: true, accepted: false });
});

// --- respondToTrade: lifecycle rejections --------------------------------------

check('respond rejects unknown sockets, missing trades, and stale ids', () => {
  const room = tradeRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: 'x', accept: true }), { success: false, error: 'No matching trade offer was found.' });
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }).trade;
  assert.deepEqual(game.respondToTrade('socket-zz', { tradeId: trade.id, accept: true }), { success: false, error: 'No matching trade offer was found.' });
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: 'stale', accept: true }), { success: false, error: 'No matching trade offer was found.' });
  assert.deepEqual(game.respondToTrade('socket-b', {}), { success: false, error: 'No matching trade offer was found.' });
  assert.equal(game.pendingTrade.id, trade.id);
  assert.equal(game.feed[0].text, 'A sent a trade offer to B.');
});

check('respond rejects anyone but the receiving player', () => {
  const room = trioRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  const c = playerOf(room, 'client-c');
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }).trade;
  assert.deepEqual(game.respondToTrade('socket-a', { tradeId: trade.id, accept: true }), { success: false, error: 'Only the receiving player can respond to this trade.' });
  assert.deepEqual(game.respondToTrade('socket-c', { tradeId: trade.id, accept: false }), { success: false, error: 'Only the receiving player can respond to this trade.' });
  assert.equal(game.pendingTrade.id, trade.id);
  assert.equal(c.bankrupt, false);
  assert.equal(b.cash, 1500);
});

check('declining feeds the receiver message, clears pending, and keeps counters', () => {
  const room = tradeRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }).trade;
  const before = game.feed.length;
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: trade.id, accept: false }), { success: true, accepted: false });
  assert.equal(game.pendingTrade, null);
  assert.equal(game.feed[0].text, 'B declined the trade offer.');
  assert.equal(game.feed.length, before + 1);
  assert.equal(game.tradesCompleted, 0);
  // Undefined accept also declines.
  const again = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 });
  assert.equal(again.success, true);
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: again.trade.id }), { success: true, accepted: false });
  assert.equal(game.pendingTrade, null);
});

// --- respondToTrade: acceptance-time validation ---------------------------------

check('accept clears the trade when a participant died or left', () => {
  const mutations = [
    room => { playerOf(room, 'client-a').bankrupt = true; },
    room => { playerOf(room, 'client-a').disconnected = true; },
    room => { playerOf(room, 'client-b').bankrupt = true; },
    room => { playerOf(room, 'client-b').disconnected = true; }
  ];
  for (const mutate of mutations) {
    const room = tradeRoom();
    const game = room.game;
    const b = playerOf(room, 'client-b');
    own(room, playerOf(room, 'client-a'), [1]);
    const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1], requestCash: 10 }).trade;
    mutate(room);
    assert.deepEqual(game.respondToTrade('socket-b', { tradeId: trade.id, accept: true }), { success: false, error: 'The trade is no longer valid.' });
    assert.equal(game.pendingTrade, null);
    assert.equal(game.tradesCompleted, 0);
    assert.equal(game.feed[0].text, 'A sent a trade offer to B.');
  }
});

check('accept validates cash before properties', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1]);
  own(room, b, [6]);
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100, requestCash: 50, givePropertyIndexes: [1], requestPropertyIndexes: [6] }).trade;
  a.cash = 10;
  game.getTile(6).houseCount = 1;
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: trade.id, accept: true }), { success: false, error: 'One of the players no longer has enough cash.' });
  assert.equal(game.pendingTrade, null);
});

check('accept rejects when the receiver cannot pay the requested cash', () => {
  const room = tradeRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 500 }).trade;
  b.cash = 100;
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: trade.id, accept: true }), { success: false, error: 'One of the players no longer has enough cash.' });
  assert.equal(game.pendingTrade, null);
});

check('accept rejects properties that stopped being tradable', () => {
  const cases = [
    { give: true, mutate: game => { game.getTile(1).ownerId = 'someone-else'; }, error: 'One of the offered properties is no longer tradable.' },
    { give: true, mutate: game => { game.getTile(1).houseCount = 1; }, error: 'One of the offered properties is no longer tradable.' },
    { give: true, mutate: game => { game.getTile(1).mortgaged = true; }, error: 'One of the offered properties is no longer tradable.' },
    { give: false, mutate: game => { game.getTile(6).mortgaged = true; }, error: 'One of the requested properties is no longer tradable.' },
    { give: false, mutate: game => { game.getTile(6).equityShares = [{ holderId: 'x', share: 10 }]; }, error: 'One of the requested properties is no longer tradable.' }
  ];
  for (const testCase of cases) {
    const room = tradeRoom();
    const game = room.game;
    const a = playerOf(room, 'client-a');
    const b = playerOf(room, 'client-b');
    own(room, a, [1]);
    own(room, b, [6]);
    const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1], requestPropertyIndexes: [6] }).trade;
    testCase.mutate(game);
    assert.deepEqual(game.respondToTrade('socket-b', { tradeId: trade.id, accept: true }), { success: false, error: testCase.error });
    assert.equal(game.pendingTrade, null);
    assert.equal(game.tradesCompleted, 0);
  }
});

// --- respondToTrade: settlement ------------------------------------------------

check('accepted trade moves cash and ownership exactly', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1]);
  own(room, b, [6]);
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100, requestCash: 50, givePropertyIndexes: [1], requestPropertyIndexes: [6] }).trade;
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: trade.id, accept: true }), { success: true, accepted: true });
  assert.equal(a.cash, 1500 - 100 + 50);
  assert.equal(b.cash, 1500 + 100 - 50);
  assert.equal(game.getTile(1).ownerId, b.id);
  assert.equal(game.getTile(6).ownerId, a.id);
  assert.deepEqual(a.properties, [6]);
  assert.deepEqual(b.properties, [1]);
  assert.equal(game.pendingTrade, null);
  assert.equal(game.tradesCompleted, 1);
  assert.equal(game.feed[0].text, 'A and B completed a trade.');
});

check('cash-only accepted trade leaves properties untouched', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 200 }).trade;
  assert.equal(game.respondToTrade('socket-b', { tradeId: trade.id, accept: true }).accepted, true);
  assert.equal(a.cash, 1300);
  assert.equal(b.cash, 1700);
  assert.deepEqual(a.properties, []);
  assert.deepEqual(b.properties, []);
  assert.equal(game.tradesCompleted, 1);
});

check('three or more traded properties flag group therapy for both sides', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1, 3]);
  own(room, b, [6]);
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1, 3], requestPropertyIndexes: [6] }).trade;
  game.respondToTrade('socket-b', { tradeId: trade.id, accept: true });
  assert.equal(a.groupTherapyTrade, true);
  assert.equal(b.groupTherapyTrade, true);
  assert.equal(game.tradesCompleted, 1);
  const room2 = tradeRoom();
  const a2 = playerOf(room2, 'client-a');
  const b2 = playerOf(room2, 'client-b');
  own(room2, a2, [1]);
  own(room2, b2, [6]);
  const trade2 = room2.game.proposeTrade('socket-a', { toPlayerId: b2.id, givePropertyIndexes: [1], requestPropertyIndexes: [6] }).trade;
  room2.game.respondToTrade('socket-b', { tradeId: trade2.id, accept: true });
  assert.equal(a2.groupTherapyTrade, false);
  assert.equal(b2.groupTherapyTrade, false);
});

check('opposing last votes flag a coalition trade; matching or missing do not', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }).trade;
  a.lastVoteChoice = 'low-tax';
  b.lastVoteChoice = 'bank-first';
  game.respondToTrade('socket-b', { tradeId: trade.id, accept: true });
  assert.equal(a.coalitionTrade, true);
  assert.equal(b.coalitionTrade, true);
  const room2 = tradeRoom();
  const a2 = playerOf(room2, 'client-a');
  const b2 = playerOf(room2, 'client-b');
  const trade2 = room2.game.proposeTrade('socket-a', { toPlayerId: b2.id, requestCash: 10 }).trade;
  a2.lastVoteChoice = 'low-tax';
  b2.lastVoteChoice = 'low-tax';
  room2.game.respondToTrade('socket-b', { tradeId: trade2.id, accept: true });
  assert.equal(a2.coalitionTrade, false);
  assert.equal(b2.coalitionTrade, false);
  const room3 = tradeRoom();
  const a3 = playerOf(room3, 'client-a');
  const b3 = playerOf(room3, 'client-b');
  const trade3 = room3.game.proposeTrade('socket-a', { toPlayerId: b3.id, requestCash: 10 }).trade;
  a3.lastVoteChoice = 'low-tax';
  room3.game.respondToTrade('socket-b', { tradeId: trade3.id, accept: true });
  assert.equal(a3.coalitionTrade, false);
  assert.equal(b3.coalitionTrade, false);
});

check('stagflation combo counts completed trades on both players only while active', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }).trade;
  game.globalEvent = { phase: 'active', id: 'stagflation' };
  game.respondToTrade('socket-b', { tradeId: trade.id, accept: true });
  assert.equal(a.tradesDuringCombo, 1);
  assert.equal(b.tradesDuringCombo, 1);
  const trade2 = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }).trade;
  game.globalEvent = { phase: 'warning', id: 'stagflation' };
  game.respondToTrade('socket-b', { tradeId: trade2.id, accept: true });
  assert.equal(a.tradesDuringCombo, 1);
  const trade3 = game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }).trade;
  game.globalEvent = { phase: 'active', id: 'housing-bubble' };
  game.respondToTrade('socket-b', { tradeId: trade3.id, accept: true });
  assert.equal(a.tradesDuringCombo, 1);
});

check('completed trade settles a matching pending payment and reports it in the feed', () => {
  const room = trioRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100 }).trade;
  game.pendingPayment = { playerId: a.id, amountRemaining: 10 };
  game.respondToTrade('socket-b', { tradeId: trade.id, accept: true });
  assert.equal(a.cash, 1500 - 100 - 10);
  assert.equal(b.cash, 1500 + 100);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.feed[0].text, 'A paid the remaining $10.');
  assert.equal(game.feed[1].text, 'A and B completed a trade.');
});

check('a pending payment on a third player is not touched by the trade', () => {
  const room = trioRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const c = playerOf(room, 'client-c');
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100 }).trade;
  game.pendingPayment = { playerId: c.id, amountRemaining: 10 };
  game.respondToTrade('socket-b', { tradeId: trade.id, accept: true });
  assert.equal(game.pendingPayment.amountRemaining, 10);
  assert.equal(a.cash, 1400);
  assert.equal(c.cash, 1500);
  assert.equal(game.feed[0].text, 'A and B completed a trade.');
});

// --- getBotCandidates -----------------------------------------------------------

function botRoom(personality, cash) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', roomCode: 'BOTCAND' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  room.addOrReconnectPlayer({ socketId: null, clientId: 'bot-1', nickname: 'BOT', isBot: true, personality });
  room.setRoomSetting('bots', 1);
  room.setRoomSetting('market', true);
  room.setRoomSetting('casino', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const bot = game.getPlayerByClient('bot-1');
  const a = game.getPlayerByClient('client-a');
  bot.cash = cash;
  own(room, bot, [3, 6, 8, 9]);
  own(room, a, [1]);
  game.currentPlayerId = bot.id;
  return { room, game, bot, a };
}

const ROLL = { id: 'roll', kind: 'roll', risk: 0, score: 0 };
const build = (tileIndex, cash, score) => ({ id: `build:${tileIndex}`, kind: 'build', tileIndex, cost: 50, risk: 50 / Math.max(1, cash), score });
const mortgage = (tileIndex, proceeds, score) => ({ id: `mortgage:${tileIndex}`, kind: 'mortgage', tileIndex, proceeds, risk: 0.25, score });
const loan = score => ({ id: 'loan:emergency', kind: 'loan', principal: 300, risk: 1.5, score });
const tradeAsk = (partnerId, score, requestCash) => ({ id: `trade:${partnerId}:1`, kind: 'trade', toPlayerId: partnerId, givePropertyIndexes: [3], requestPropertyIndexes: [1], giveCash: 0, requestCash, risk: 0.2, score });
const market = (cash, score) => ({ id: 'market:brazil', kind: 'market', instrumentId: 'brazil', side: 'buy', quantity: 1, risk: 100 / Math.max(1, cash), score });
const casino = (color, stake, score) => ({ id: 'casino:red', kind: 'casino', color, stake, risk: 0.55, score });

const BUILDS_150 = [build(6, 150, 10), build(8, 150, 10), build(9, 150, 10)];
const MORTGAGES_150 = [mortgage(3, 30, 8), mortgage(6, 50, 8), mortgage(8, 50, 8), mortgage(9, 60, 8)];

check('non-bots and missing players produce no candidates', () => {
  const { game, a } = botRoom('speculator', 150);
  assert.deepEqual(game.getBotCandidates(a), []);
  assert.deepEqual(game.getBotCandidates(null), []);
  assert.deepEqual(game.getBotCandidates(undefined), []);
});

check('speculator at 150: full candidate array with score/risk/tie-order pinned', () => {
  const { game, bot, a } = botRoom('speculator', 150);
  assert.deepEqual(game.getBotCandidates(bot), [
    market(150, 20),
    loan(18),
    ...BUILDS_150,
    tradeAsk(a.id, 8, 0),
    ...MORTGAGES_150,
    ROLL
  ]);
});

check('builder at 1500: build-only board, mortgage/loan/casino gated out', () => {
  const { game, bot, a } = botRoom('builder', 1500);
  assert.deepEqual(game.getBotCandidates(bot), [
    build(6, 1500, 30), build(8, 1500, 30), build(9, 1500, 30),
    tradeAsk(a.id, 8, 0),
    market(1500, 4),
    ROLL
  ]);
});

check('chaos at 120: green casino leads, non-speculator loan sinks below roll', () => {
  const { game, bot, a } = botRoom('chaos', 120);
  assert.deepEqual(game.getBotCandidates(bot), [
    casino('green', 9, 18),
    build(6, 120, 10), build(8, 120, 10), build(9, 120, 10),
    tradeAsk(a.id, 8, 0),
    mortgage(3, 30, 8), mortgage(6, 50, 8), mortgage(8, 50, 8), mortgage(9, 60, 8),
    market(120, 4),
    ROLL,
    loan(-20)
  ]);
});

check('shark at 500: red casino stake 3%, trade asks 40', () => {
  const { game, bot, a } = botRoom('shark', 500);
  assert.deepEqual(game.getBotCandidates(bot), [
    casino('red', 15, 11),
    build(6, 500, 10), build(8, 500, 10), build(9, 500, 10),
    tradeAsk(a.id, 8, 40),
    market(500, 4),
    ROLL
  ]);
});

check('diplomat at 500 leads with the group-collection trade ask at score 24', () => {
  const { game, bot, a } = botRoom('diplomat', 500);
  assert.deepEqual(game.getBotCandidates(bot), [
    tradeAsk(a.id, 24, 0),
    build(6, 500, 10), build(8, 500, 10), build(9, 500, 10),
    market(500, 4),
    ROLL
  ]);
});

check('survivor at 150 mortgages score 24 above builds', () => {
  const { game, bot, a } = botRoom('survivor', 150);
  assert.deepEqual(game.getBotCandidates(bot), [
    mortgage(3, 30, 24), mortgage(6, 50, 24), mortgage(8, 50, 24), mortgage(9, 60, 24),
    ...BUILDS_150,
    tradeAsk(a.id, 8, 0),
    market(150, 4),
    ROLL,
    loan(-20)
  ]);
});

check('cash thresholds: mortgage below 180, loan up to 250, casino above 20', () => {
  const kinds = ctx => ctx.game.getBotCandidates(ctx.bot).map(candidate => candidate.kind);
  assert.equal(kinds(botRoom('builder', 180)).includes('mortgage'), false);
  const under = kinds(botRoom('builder', 179));
  assert.equal(under.filter(kind => kind === 'mortgage').length, 4);
  assert.equal(kinds(botRoom('survivor', 250)).includes('loan'), true);
  assert.equal(kinds(botRoom('survivor', 251)).includes('loan'), false);
  assert.equal(kinds(botRoom('chaos', 20)).includes('casino'), false);
  assert.equal(kinds(botRoom('chaos', 21)).includes('casino'), true);
});

check('market/casino toggles and per-turn throttles drop their candidates', () => {
  const ctx = botRoom('speculator', 150);
  ctx.game.settings.market = false;
  assert.equal(kindsOf(ctx).includes('market'), false);
  ctx.game.settings.market = true;
  ctx.bot.marketActionsThisTurn = 1;
  assert.equal(kindsOf(ctx).includes('market'), false);
  const chaos = botRoom('chaos', 150);
  chaos.bot.casinoBetsThisRound = 1;
  assert.equal(kindsOf(chaos).includes('casino'), false);
  chaos.bot.casinoBetsThisRound = 0;
  chaos.game.settings.casino = false;
  assert.equal(kindsOf(chaos).includes('casino'), false);
});

function kindsOf(ctx) {
  return ctx.game.getBotCandidates(ctx.bot).map(candidate => candidate.kind);
}

check('trade candidate needs a human partner and a same-group deed on both sides', () => {
  const ctx = botRoom('diplomat', 500);
  const hasTrade = () => kindsOf(ctx).includes('trade');
  assert.equal(hasTrade(), true);
  ctx.game.getTile(1).ownerId = null;
  ctx.a.properties = [];
  assert.equal(hasTrade(), false);
  const ctx2 = botRoom('diplomat', 500);
  ctx2.game.getTile(1).ownerId = null;
  ctx2.a.properties = [];
  own(ctx2.room, ctx2.a, [11]);
  assert.equal(kindsOf(ctx2).includes('trade'), false);
  const ctx3 = botRoom('diplomat', 500);
  ctx3.game.getTile(3).houseCount = 1;
  assert.equal(kindsOf(ctx3).includes('trade'), false);
  const ctx4 = botRoom('diplomat', 500);
  ctx4.a.disconnected = true;
  assert.equal(hasTradeIn(ctx4), false);
});

function hasTradeIn(ctx) {
  return kindsOf(ctx).includes('trade');
}

check('build candidates follow full-set and even-build rules; mortgages drop encumbered deeds', () => {
  const ctx = botRoom('builder', 150);
  ctx.game.getTile(6).houseCount = 1;
  const candidates = ctx.game.getBotCandidates(ctx.bot);
  assert.deepEqual(candidates.filter(candidate => candidate.kind === 'build').map(candidate => candidate.tileIndex), [8, 9]);
  assert.deepEqual(candidates.filter(candidate => candidate.kind === 'mortgage').map(candidate => candidate.tileIndex), [3]);
});

check('after rolling, only the roll candidate remains', () => {
  const { game, bot } = botRoom('chaos', 120);
  game.hasRolled = true;
  assert.deepEqual(game.getBotCandidates(bot), [ROLL]);
});

console.log(`\n${passed + failures.length} trade/candidate checks — ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  process.exitCode = 1;
}
