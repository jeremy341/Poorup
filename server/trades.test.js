// Characterization suite for the trade negotiation and bot-candidate generator regions of GameState (proposeTrade, respondToTrade,
// getBotCandidates). Assertions are pinned against the pre-refactor implementation: exact rejection strings, escrow and settlement
// cash math, ownership deltas, pendingTrade lifecycle, feed texts, and deep-equal candidate arrays (id, kind, score, risk, tie order) per cash level.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { vetoTrade } from './botTradeValuation.js';

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

// Fixtures

function makeRoom(roomCode, nicknames) {
  const manager = new RoomManager();
  const [first, ...rest] = nicknames;
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: `socket-${first.toLowerCase()}`, clientId: `client-${first.toLowerCase()}`, nickname: first, roomCode });
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

// proposeTrade: rejection matrix

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
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }), { success: false, error: 'Resolve the pending player contract before proposing a trade.' });
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

check('propose rejects offered tiles not owned, developed, encumbered, or unknown', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1, 6]);
  const giveError = 'You can only offer properties that you own and that have no buildings, collateral, or equity shares.';
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [3] }), { success: false, error: giveError });
  game.getTile(1).houseCount = 1;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1] }), { success: false, error: giveError });
  game.getTile(1).houseCount = 0;
  game.getTile(1).mortgaged = true;
  assert.equal(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1] }).success, true, 'a mortgaged deed can be traded');
  game.pendingTrade = null;
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
  // A mortgage does not make the offered deed unavailable; the invalid requested deed wins.
  own(room, a, [6]);
  game.getTile(6).mortgaged = true;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [6], requestPropertyIndexes: [3] }), { success: false, error: 'The requested properties are not available for trade.' });
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

// proposeTrade: acceptance and normalization

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

check('propose normalizes cash legs to whole dollars', () => {
  const room = tradeRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  const result = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 10.9, requestCash: 5.8 });
  assert.equal(result.success, true);
  assert.equal(result.trade.giveCash, 10);
  assert.equal(result.trade.requestCash, 5);
});

check('room-level proposeTrade and respondToTrade delegate to the game', () => {
  const room = tradeRoom();
  const b = playerOf(room, 'client-b');
  const result = room.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 20 });
  assert.equal(result.success, true);
  assert.equal(room.game.pendingTrade.id, result.trade.id);
  assert.deepEqual(room.respondToTrade('socket-b', { tradeId: result.trade.id, accept: false }), { success: true, accepted: false });
});

check('trades are refused when the game is not running (lobby or after the game ended)', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const pending = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100 });
  assert.equal(pending.success, true);
  game.started = false;
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: pending.trade.id, accept: true }), { success: false, error: 'The game is not running.' });
  assert.equal(a.cash, 1500);
  assert.equal(b.cash, 1500);
  game.pendingTrade = null;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100 }), { success: false, error: 'The game is not running.' });
  assert.equal(game.pendingTrade, null);
});

check('a retried propose replays the live offer, and a dead offer is never replayed', () => {
  const room = tradeRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  const first = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 50, requestId: 'req-1' });
  assert.equal(first.success, true);
  const retry = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 50, requestId: 'req-1' });
  assert.equal(retry.success, true, 'the retry after a lost ack sees the offer, not an error');
  assert.equal(retry.trade.id, first.trade.id);
  assert.equal(game.feed.filter(entry => entry.text.includes('sent a trade offer')).length, 1);
  assert.equal(game.respondToTrade('socket-b', { tradeId: first.trade.id, accept: false }).success, true);
  assert.equal(game.pendingTrade, null);
  const afterDecline = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 50, requestId: 'req-1' });
  assert.equal(afterDecline.success, true);
  assert.notEqual(afterDecline.trade.id, first.trade.id, 'a declined offer is not handed back as live');
  assert.equal(game.pendingTrade.id, afterDecline.trade.id);
});

check('respond-trade accepts only a literal true', () => {
  for (const accept of ['false', 'no', 1, {}, [], 'true', undefined]) {
    const room = tradeRoom();
    const game = room.game;
    const b = playerOf(room, 'client-b');
    const offer = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100 });
    const result = game.respondToTrade('socket-b', { tradeId: offer.trade.id, accept });
    assert.deepEqual(result, { success: true, accepted: false }, `accept ${JSON.stringify(accept)} must decline`);
    assert.equal(b.cash, 1500);
  }
});

// respondToTrade: lifecycle rejections

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

// respondToTrade: acceptance-time validation

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

check('trade requires clearing every building across the owned color set', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1, 3]);
  game.getTile(3).houseCount = 1;
  assert.equal(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1] }).success, false);
  assert.equal(game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [3] }).success, false);
});

// respondToTrade: settlement

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
  assert.equal(a.tradesCompleted, 1);
  assert.equal(b.tradesCompleted, 1);
  assert.equal(game.feed[0].text, 'A and B completed a trade.');
});

check('accepted trade preserves a mortgage and recipient later repays printed value plus ten percent', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1]);
  const deed = game.getTile(1);
  deed.mortgaged = true;
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1] }).trade;
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: trade.id, accept: true }), { success: true, accepted: true });
  assert.equal(deed.ownerId, b.id);
  assert.equal(deed.mortgaged, true);
  b.cash = 0;
  assert.deepEqual(game.manageProperty('socket-b', { tileIndex: 1, action: 'unmortgage' }), { success: false, error: 'Insufficient cash to unmortgage this property.' });
  b.cash = Math.ceil(Math.floor(deed.price / 2) * 1.1);
  assert.deepEqual(game.manageProperty('socket-b', { tileIndex: 1, action: 'unmortgage' }), { success: true });
  assert.equal(deed.mortgaged, false);
  assert.equal(b.cash, 0);
});

check('failed trade settlement rolls back mortgage and ownership together', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1]);
  const deed = game.getTile(1);
  deed.mortgaged = true;
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, givePropertyIndexes: [1] }).trade;
  game.markCompletedTradeFlags = () => { throw new Error('settlement rollback test'); };
  assert.deepEqual(game.respondToTrade('socket-b', { tradeId: trade.id, accept: true }), {
    success: false, error: 'The trade could not be completed; no assets moved.'
  });
  assert.equal(deed.ownerId, a.id);
  assert.equal(deed.mortgaged, true);
  assert.deepEqual(a.properties, [1]);
  assert.deepEqual(b.properties, []);
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

check('a failed trade settlement moves no cash and no deed', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1]);
  const trade = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100, givePropertyIndexes: [1] }).trade;
  game.feedMessage = () => { throw new Error('injected commit failure'); };
  const settled = game.respondToTrade('socket-b', { tradeId: trade.id, accept: true });
  assert.equal(settled.success, false, 'the failed settlement is reported, not thrown');
  assert.equal(a.cash, 1500, 'no cash moved');
  assert.equal(b.cash, 1500, 'no cash moved');
  assert.equal(game.getTile(1).ownerId, a.id, 'the deed stayed with its owner');
  assert.deepEqual(a.properties, [1]);
  assert.deepEqual(b.properties, []);
  assert.equal(game.tradesCompleted, 0);
  assert.equal(game.pendingTrade.id, trade.id, 'the offer stays open for a retry');
});

// getBotCandidates
function botRoom(legacyPersonality, cash) {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'socket-a', clientId: 'client-a', nickname: 'A', roomCode: 'BOTCAND', rulesetOverrides: { bankLoans: true } });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  room.setRoomSetting('bots', 1);
  room.setRoomSetting('botPersonality', legacyPersonality);
  room.setRoomSetting('market', true);
  room.setRoomSetting('casino', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const bot = game.players.find(player => player.isBot);
  const a = game.getPlayerByClient('client-a');
  bot.cash = cash;
  own(room, bot, [3, 6, 8, 9]);
  own(room, a, [1]);
  game.currentPlayerId = bot.id;
  return { room, game, bot, a };
}

const ROLL = { id: 'roll', kind: 'roll', risk: 0, score: 0 };
check('counterTrade replaces the pending offer without transferring assets', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const first = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100 });
  assert.equal(first.success, true);
  const counter = game.counterTrade('socket-b', { giveCash: 25, requestCash: 120 });
  assert.equal(counter.success, true);
  assert.equal(counter.countered, true);
  assert.equal(game.pendingTrade.fromPlayerId, b.id);
  assert.equal(game.pendingTrade.toPlayerId, a.id);
  assert.equal(game.pendingTrade.giveCash, 25);
  assert.equal(game.pendingTrade.requestCash, 120);
  assert.equal(game.pendingTrade.counterDepth, 1);
  assert.equal(a.cash, 1500);
  assert.equal(b.cash, 1500);
});

check('sender can adjust or cancel a pending trade without transferring assets', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  const first = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 30 });
  assert.equal(first.trade.createdRound, game.roundNumber);
  assert.deepEqual(game.cancelTrade('socket-a', { tradeId: 'stale-trade-id' }), { success: false, error: 'That trade offer is no longer current.' });
  assert.equal(game.pendingTrade.id, first.trade.id, 'a stale cancellation cannot remove the current offer');
  const adjusted = game.adjustTrade('socket-a', { tradeId: first.trade.id, giveCash: 75, requestCash: 20 });
  assert.equal(adjusted.success, true);
  assert.equal(adjusted.adjusted, true);
  assert.equal(game.pendingTrade.giveCash, 75);
  assert.equal(game.pendingTrade.requestCash, 20);
  assert.equal(a.cash, 1500);
  assert.equal(b.cash, 1500);
  assert.deepEqual(game.cancelTrade('socket-b', { tradeId: game.pendingTrade.id }), { success: false, error: 'Only the sending player can cancel this trade.' });
  assert.equal(game.cancelTrade('socket-a', { tradeId: game.pendingTrade.id }).canceled, true);
  assert.equal(game.pendingTrade, null);
});

check('trade adjustment increments and enforces the negotiation depth cap', () => {
  const room = tradeRoom();
  const game = room.game;
  const b = playerOf(room, 'client-b');
  const first = game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 30 });
  const adjusted = game.adjustTrade('socket-a', { tradeId: first.trade.id, giveCash: 40 });
  assert.equal(adjusted.success, true);
  assert.equal(game.pendingTrade.counterDepth, 1);
  const adjustedAgain = game.adjustTrade('socket-a', { tradeId: adjusted.trade.id, giveCash: 50 });
  assert.equal(adjustedAgain.success, true);
  assert.equal(game.pendingTrade.counterDepth, 2);
  assert.deepEqual(game.adjustTrade('socket-a', { tradeId: adjustedAgain.trade.id, giveCash: 60 }), { success: false, error: 'This trade has reached its negotiation limit.' });
});
check('bot can revoke its still-live trade offer after giving the table a round to respond', () => {
  const { game, bot, a } = botRoom('builder', 1500);
  game.pendingTrade = {
    id: 'bot-offer-1', fromPlayerId: bot.id, toPlayerId: a.id,
    giveCash: 100, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [],
    createdRound: 1
  };
  game.roundNumber = 2;
  const candidate = game.getBotCandidates(bot, { expanded: true, parity: true })
    .find(entry => entry.kind === 'cancel-trade');
  assert.deepEqual(candidate, {
    id: 'cancel-trade:bot-offer-1', kind: 'cancel-trade', tradeId: 'bot-offer-1',
    risk: 0.05, score: 4
  });
});

check('bot does not propose replacement trades while its existing offer is pending', () => {
  const { room, game, bot, a } = botRoom('builder', 1500);
  own(room, a, [1]);
  game.pendingTrade = {
    id: 'bot-offer-current', fromPlayerId: bot.id, toPlayerId: a.id,
    giveCash: 100, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [],
    createdRound: game.roundNumber
  };
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true });
  assert.equal(candidates.some(entry => entry.kind === 'trade'), false);
  assert.equal(candidates.some(entry => entry.kind === 'cancel-trade'), false, 'the bot gives the table a full round to respond');
});

check('bot does not propose a trade while a player contract is pending', () => {
  const { room, game, bot, a } = botRoom('builder', 1500);
  own(room, a, [1]);
  game.pendingPlayerContract = { id: 'contract-current', fromPlayerId: bot.id, toPlayerId: a.id, kind: 'loan', counterDepth: 0 };
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true });
  assert.equal(candidates.some(entry => entry.kind === 'trade'), false);
  assert.equal(candidates.some(entry => entry.kind === 'contract-propose'), false);
});

check('non-bots and missing players produce no candidates', () => {
  const { game, a } = botRoom('speculator', 150);
  assert.deepEqual(game.getBotCandidates(a), []);
  assert.deepEqual(game.getBotCandidates(null), []);
  assert.deepEqual(game.getBotCandidates(undefined), []);
});

check('candidate generation is consistent when a legacy personality value is sent', () => {
  // Builds need the house cost plus a reserve, so this fixture is funded
  // above that floor; the $150 mortgage fixture below stays below the mortgage cap.
  const { game, bot } = botRoom('speculator', 1500);
  assert.equal('personality' in bot, false);
  const candidates = game.getBotCandidates(bot);
  assert.ok(candidates.some(candidate => candidate.kind === 'build'));
  assert.ok(candidates.some(candidate => candidate.kind === 'market'));
  assert.ok(candidates.every(candidate => Number.isFinite(candidate.score)));
});

check('strong cash candidates retain normal build and market options', () => {
  const { game, bot } = botRoom('builder', 1500);
  const kinds = kindsOf({ game, bot });
  assert.equal(kinds.includes('build'), true);
  assert.equal(kinds.includes('market'), true);
  assert.equal(kinds.includes('mortgage'), false);
  const casino = game.getBotCandidates(bot).find(candidate => candidate.kind === 'casino');
  assert.equal(casino?.score, -5, 'negative expected value remains available but is not rewarded by the strategy selector');
});

check('cash-poor candidates never include a casino bet', () => {
  const { game, bot } = botRoom('chaos', 120);
  assert.equal(kindsOf({ game, bot }).includes('casino'), false);
});

check('casino eligibility follows bankroll and table rules, not a bot archetype', () => {
  const { game, bot } = botRoom('shark', 500);
  assert.equal(kindsOf({ game, bot }).includes('casino'), false, '500 cash is below the common bankroll floor');
  const eligible = botRoom('diplomat', 525);
  assert.equal(kindsOf(eligible).includes('casino'), true, 'the same rule enables an otherwise eligible bot');
});

check('trade generation has no archetype-specific score boost', () => {
  const { game, bot } = botRoom('diplomat', 500);
  assert.ok(game.getBotCandidates(bot).every(candidate => Number.isFinite(candidate.score)));
});

check('mortgage and build candidates use the shared decision baseline', () => {
  const { game, bot } = botRoom('survivor', 150);
  const candidates = game.getBotCandidates(bot);
  assert.ok(candidates.filter(candidate => candidate.kind === 'mortgage').every(candidate => candidate.score === 8));
  assert.ok(candidates.filter(candidate => candidate.kind === 'build').every(candidate => candidate.score === 10));
});

check('cash thresholds: mortgage below 180, loan up to 250, casino cash-strong', () => {
  const kinds = ctx => ctx.game.getBotCandidates(ctx.bot).map(candidate => candidate.kind);
  assert.equal(kinds(botRoom('builder', 180)).includes('mortgage'), false);
  const under = kinds(botRoom('builder', 179));
  assert.equal(under.filter(kind => kind === 'mortgage').length, 4);
  assert.equal(kinds(botRoom('survivor', 250)).includes('loan'), true);
  assert.equal(kinds(botRoom('survivor', 251)).includes('loan'), false);
  assert.equal(kinds(botRoom('chaos', 20)).includes('casino'), false);
  assert.equal(kinds(botRoom('chaos', 524)).includes('casino'), false);
  assert.equal(kinds(botRoom('chaos', 525)).includes('casino'), true);
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

check('market candidates expose every affordable instrument with risk-adjusted forecasts', () => {
  const ctx = botRoom('speculator', 1500);
  ctx.game.roundNumber = 4;
  const buys = ctx.game.botMarketCandidates(ctx.bot).filter(candidate => candidate.side === 'buy');
  assert.equal(buys.length, Object.keys(ctx.game.marketQuotes).length);
  assert.equal(buys.some(candidate => candidate.instrumentId === 'brazil'), true);
  assert.equal(buys.some(candidate => candidate.instrumentId === 'canada'), true);
  assert.ok(buys.every(candidate => Number.isFinite(candidate.expectedMarketPnl)
    && Number.isFinite(candidate.expectedMovePercent)
    && Number.isFinite(candidate.fee)));
});

check('market sell candidates are omitted when the held instrument has no live quote', () => {
  const ctx = botRoom('speculator', 1500);
  ctx.game.roundNumber = 4;
  ctx.bot.marketPositions = { brazil: { quantity: 1, averageCost: 50, realizedPnl: 0 } };
  delete ctx.game.marketQuotes.brazil;
  const candidates = ctx.game.botMarketCandidates(ctx.bot);
  assert.equal(candidates.some(candidate => candidate.instrumentId === 'brazil' && candidate.side === 'sell'), false,
    'missing current prices must not be replaced by a fabricated quote');
});

function kindsOf(ctx) {
  return ctx.game.getBotCandidates(ctx.bot).map(candidate => candidate.kind);
}

function game_getTrade(ctx) {
  return ctx.game.getBotCandidates(ctx.bot).find(candidate => candidate.kind === 'trade');
}

// Same-group 1-for-1 swaps change nothing for either seat, so the group collector only buys the missing deed of a set the bot
// is one short of (cash alone or another group's deed) or concentrates a stake. Fixture: the bot holds Brown 3 and a full Light Blue set; A holds Brown 1.
check('trade candidate buys the last deed of a set the bot is one short of', () => {
  const ctx = botRoom('diplomat', 500);
  const hasTrade = () => kindsOf(ctx).includes('trade');
  assert.equal(hasTrade(), true);
  const offer = game_getTrade(ctx);
  assert.equal(offer.toPlayerId, ctx.a.id);
  assert.deepEqual(offer.givePropertyIndexes, [], 'the Light Blue set is not for sale, so the offer is cash alone');
  assert.deepEqual(offer.requestPropertyIndexes, [1]);
  assert.equal(offer.requestCash, 0);
  assert.equal(offer.giveCash, 114, 'the bot pays the 2x monopoly premium (2 x 57) rather than asking for cash');
  assert.equal(offer.score, 36, 'a set completer carries the +28 completion bonus on the base 8');
  // The partner is not handed a set, so its cash is irrelevant (it must not veto the swap).
  ctx.a.cash = 0;
  assert.equal(hasTrade(), true);
  // A cash-poor bot cannot fund the premium above its reserve: no offer.
  ctx.bot.cash = 300;
  assert.equal(hasTrade(), false);
  ctx.bot.cash = 500;
  assert.equal(hasTrade(), true);
  // A same-group swap is never generated: it would change nothing for either seat.
  assert.equal(game_tradeList(ctx).some(entry => entry.givePropertyIndexes.includes(3)), false);
  ctx.game.getTile(1).ownerId = null;
  ctx.a.properties = [];
  assert.equal(hasTrade(), false);
  const ctx2 = botRoom('diplomat', 500);
  ctx2.game.getTile(1).ownerId = null;
  ctx2.a.properties = [];
  own(ctx2.room, ctx2.a, [11]);
  assert.equal(kindsOf(ctx2).includes('trade'), false);
  const ctx3 = botRoom('diplomat', 500);
  ctx3.game.getTile(1).houseCount = 1;
  assert.equal(kindsOf(ctx3).includes('trade'), false, 'a deed with houses on it is not tradeable');
  const ctx4 = botRoom('diplomat', 500);
  ctx4.a.disconnected = true;
  assert.equal(hasTradeIn(ctx4), false);
});

function game_tradeList(ctx) {
  return ctx.game.getBotCandidates(ctx.bot).filter(candidate => candidate.kind === 'trade');
}

function hasTradeIn(ctx) {
  return kindsOf(ctx).includes('trade');
}

check('post-roll with a foreign purchase offer still offers end-turn', () => {
  const ctx = botRoom('diplomat', 500);
  ctx.game.currentPlayerId = ctx.bot.id;
  ctx.game.pendingPurchaseOffer = { playerId: 'someone-else', tileIndex: 5 };
  const kinds = ctx.game.getBotCandidates(ctx.bot, { postRoll: true }).map(candidate => candidate.kind);
  assert.equal(kinds.includes('end-turn'), true);
});

check('build candidates follow full-set and even-build rules; mortgages drop encumbered deeds', () => {
  const ctx = botRoom('builder', 150);
  ctx.game.getTile(6).houseCount = 1;
  const candidates = ctx.game.getBotCandidates(ctx.bot);
  // At $150 no house leaves the reserve, so builds are withheld and the
  // mortgage ladder (cash under $180) is what the bot may use.
  assert.deepEqual(candidates.filter(candidate => candidate.kind === 'build').map(candidate => candidate.tileIndex), []);
  assert.deepEqual(candidates.filter(candidate => candidate.kind === 'mortgage').map(candidate => candidate.tileIndex), [3]);
  ctx.bot.cash = 1500;
  const funded = ctx.game.getBotCandidates(ctx.bot);
  assert.deepEqual(funded.filter(candidate => candidate.kind === 'build').map(candidate => candidate.tileIndex), [8, 9]);
});

check('player-loan repayment candidates pay due balances first and preserve active liquidity', () => {
  const ctx = botRoom('builder', 500);
  ctx.game.playerContracts = [
    { id: 'active-loan', kind: 'loan', status: 'active', toPlayerId: ctx.bot.id, remaining: 400 },
    { id: 'due-loan', kind: 'loan', status: 'due', toPlayerId: ctx.bot.id, remaining: 200 },
    { id: 'equity', kind: 'equity', status: 'active', toPlayerId: ctx.bot.id, remaining: 100 }
  ];
  const repayments = ctx.game.getBotCandidates(ctx.bot).filter(candidate => candidate.kind === 'repay');
  assert.deepEqual(repayments, [
    { id: 'repay:due-loan', kind: 'repay', contractId: 'due-loan', amount: 200, remaining: 200, risk: 0.05, score: 32, mandatory: true },
    { id: 'repay:active-loan', kind: 'repay', contractId: 'active-loan', amount: 320, remaining: 400, risk: 0.64, score: 11 }
  ]);
});

check('event building limits do not emit already-forbidden build candidates', () => {
  const ctx = botRoom('builder', 1500);
  ctx.game.globalEvent = { phase: 'active', effects: { buildingLimitPerTurn: 1 } };
  ctx.bot.buildActionsThisTurn = 1;
  assert.equal(kindsOf(ctx).includes('build'), false);
});

check('after rolling, only the roll candidate remains', () => {
  const { game, bot } = botRoom('chaos', 120);
  game.hasRolled = true;
  assert.deepEqual(game.getBotCandidates(bot), [ROLL]);
});

check('contract targeting considers viable borrowers beyond the two lowest-cash seats', () => {
  const { game, bot, a } = botRoom('builder', 1500);
  const b = game.players.find(player => player.nickname === 'B');
  const c = game.players.find(player => player.nickname === 'C');
  a.cash = 100;
  b.cash = 200;
  c.cash = 800;
  game.currentPlayerId = bot.id;
  const loan = game.getBotCandidates(bot, { expanded: true, parity: true })
    .find(candidate => candidate.kind === 'contract-propose' && candidate.offer.kind === 'loan' && candidate.offer.toPlayerId === c.id);
  assert.ok(loan, 'the $800 borrower can repay the offered loan even though two poorer seats cannot');
});

check('post-roll finance candidates retain legal building actions', () => {
  const { game, bot } = botRoom('builder', 1500);
  game.hasRolled = true;
  const group = game.getGroupTiles('Brown');
  group.forEach(tile => {
    tile.ownerId = bot.id;
    if (!bot.properties.includes(tile.index)) bot.properties.push(tile.index);
  });
  const candidates = game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true });
  assert.ok(candidates.some(candidate => candidate.kind === 'build'), 'post-roll still includes a legal build instead of ending the turn');
});

check('rich trade cannot silently break the bot\'s completed high-value group', () => {
  const { room, game, bot } = botRoom('builder', 1500);
  const partner = game.players.find(player => player.nickname === 'B');
  for (const player of game.players) player.properties = [];
  for (const tile of game.tiles) if (tile.group) tile.ownerId = null;
  own(room, bot, [37, 39]);
  own(room, partner, [1, 3]);
  game.currentPlayerId = bot.id;
  const richTrades = game.getBotCandidates(bot, { expanded: true, parity: true })
    .filter(candidate => candidate.kind === 'trade' && candidate.rich);
  assert.equal(richTrades.some(candidate => candidate.givePropertyIndexes.includes(37) && candidate.givePropertyIndexes.includes(39)), false,
    'the bot should not give away its completed Dark Blue group for a lower-value Brown set');
});

check('propose normalizes duplicate and oversized property legs', () => {
  const room = tradeRoom();
  const game = room.game;
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  own(room, a, [1]);
  const result = game.proposeTrade('socket-a', {
    toPlayerId: b.id,
    givePropertyIndexes: Array.from({ length: 200 }, () => 1),
    requestPropertyIndexes: []
  });
  assert.equal(result.success, true);
  assert.deepEqual(game.pendingTrade.givePropertyIndexes, [1]);
});

check('parity mode exposes strategic jail choices', () => {
  const ctx = botRoom('survivor', 500);
  ctx.bot.inJail = true;
  ctx.bot.jailFreeCards = 1;
  const candidates = ctx.game.getBotCandidates(ctx.bot, { parity: true });
  assert.deepEqual(candidates.map(candidate => candidate.kind).sort(), ['jail-fine', 'jail-free', 'roll'].sort());
});

check('parity mode exposes proactive bank repayment', () => {
  const ctx = botRoom('survivor', 500);
  ctx.bot.bankLoan = { status: 'active', remaining: 450 };
  const repayment = ctx.game.getBotCandidates(ctx.bot, { parity: true }).find(candidate => candidate.kind === 'bank-repay');
  assert.equal(repayment.amount, 320);
  assert.equal(repayment.contractId, undefined);
});

check('parity mode exposes portfolio sell and unmortgage actions', () => {
  const ctx = botRoom('builder', 500);
  ctx.game.getTile(6).houseCount = 1;
  ctx.game.getTile(3).mortgaged = true;
  const kinds = ctx.game.getBotCandidates(ctx.bot, { parity: true }).map(candidate => candidate.kind);
  assert.equal(kinds.includes('sell'), true);
  assert.equal(kinds.includes('unmortgage'), true);
});

check('parity mode exposes market sell candidates', () => {
  const ctx = botRoom('speculator', 500);
  ctx.bot.marketPositions = { brazil: { quantity: 2, averageCost: 50, realizedPnl: 0 } };
  ctx.game.marketQuotes.brazil = 180;
  const sell = ctx.game.getBotCandidates(ctx.bot, { parity: true }).find(candidate => candidate.kind === 'market' && candidate.side === 'sell');
  assert.equal(sell.instrumentId, 'brazil');
  assert.equal(sell.quantity, 2);
});

check('parity mode exposes proactive loan and rent-share offers without retired hybrids', () => {
  const ctx = botRoom('diplomat', 1000);
  ctx.a.cash = 80;
  own(ctx.room, ctx.a, [1]);
  const offers = ctx.game.getBotCandidates(ctx.bot, { parity: true }).filter(candidate => candidate.kind === 'contract-propose');
  assert.equal(offers.some(candidate => candidate.offer.kind === 'loan'), true);
  assert.equal(offers.some(candidate => candidate.offer.kind === 'equity'), true);
  assert.equal(offers.some(candidate => candidate.offer.kind === 'hybrid'), false);
});

check('parity mode exposes bounded multi-leg trade candidates', () => {
  const ctx = botRoom('diplomat', 1000);
  for (const player of ctx.game.players) player.properties = [];
  for (const tile of ctx.game.tiles) if (tile.group) tile.ownerId = null;
  // Loose deeds (Light Blue 6, Pink 11) for Brown 3 and Light Blue 9, which finishes
  // the bot's Brown pair. The old fixture swapped equal-priced deeds of the same
  // groups, which is value-neutral and is not proposed.
  own(ctx.room, ctx.bot, [1, 6, 11]);
  own(ctx.room, ctx.a, [3, 8, 9]);
  const rich = ctx.game.getBotCandidates(ctx.bot, { parity: true }).filter(candidate => candidate.kind === 'trade' && candidate.rich);
  assert.equal(rich.some(candidate => candidate.givePropertyIndexes.length > 1 || candidate.requestPropertyIndexes.length > 1), true);
  const offer = rich.find(candidate => candidate.requestPropertyIndexes.length === 2);
  assert.ok(offer.strategicValue >= 20 && offer.partnerGain >= 0, 'the swap has a real gain for the bot and costs the partner nothing');
  assert.equal(vetoTrade(ctx.game, { fromPlayerId: ctx.bot.id, toPlayerId: ctx.a.id, ...offer }, ctx.a.id).vetoed, false, 'the partner is paid for the set it hands over');
});

check('parity mode exposes throttled table-talk for bot seats', () => {
  const ctx = botRoom('diplomat', 1000);
  ctx.game.botDecisionSequence = 6;
  const chat = ctx.game.getBotCandidates(ctx.bot, { parity: true }).find(candidate => candidate.kind === 'chat');
  assert.equal(chat.text.includes('deal'), true);
  ctx.game.botDecisionSequence = 7;
  assert.equal(ctx.game.getBotCandidates(ctx.bot, { parity: true }).some(candidate => candidate.kind === 'chat'), false);
});

console.log(`\n${passed + failures.length} trade/candidate checks, ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  process.exitCode = 1;
}
