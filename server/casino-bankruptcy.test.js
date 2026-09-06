// Characterization suite for the casino / bankruptcy / room-settings hotspot
// cluster: GameState.placeCasinoBet, GameState.chargePlayer + the
// handleBankruptcy path reached through declareBankruptcy, and
// Room.setRoomSetting. Every expectation below was captured from the
// pre-refactor code (exact errors, coerced values, ledger fields, feed order,
// liquidation sequence, and RNG call sites), so the structural refactor must
// keep it green byte-for-byte.
import assert from 'node:assert/strict';
import nodeCrypto from 'crypto';
import { RoomManager } from './gameLogic.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS — ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL — ${name}: ${error && error.message}`);
  }
}

// The dice/pocket rolls run through crypto.randomInt(min, max + 1); the
// roulette pocket draw is the only call site asking for (0, 0..36) -> (0, 37).
// The queue is consumed in draw order; anything else falls through.
function withPocketRolls(pockets, fn) {
  const original = nodeCrypto.randomInt;
  const queue = [...pockets];
  nodeCrypto.randomInt = (min, max) => (min === 0 && max === 37 && queue.length ? queue.shift() : original(min, max));
  try {
    return fn();
  } finally {
    nodeCrypto.randomInt = original;
  }
}

function makeStartedRoom(casinoOn = true) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  if (casinoOn) room.setRoomSetting('casino', true);
  room.startGame();
  return room;
}

function trioRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  room.startGame();
  return room;
}

function feedTexts(room) {
  return room.game.feed.map(entry => entry.text);
}

// ---------------------------------------------------------------------------
// Casino: rejection matrix
// ---------------------------------------------------------------------------

check('casino — disabled room rejects before every other rule', () => {
  const room = makeStartedRoom(false);
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 10, 'c1'), { success: false, error: 'Casino access is off for this room.' });
  assert.deepEqual(room.placeCasinoBet('socket-a', 'blue', 0, 'c1'), { success: false, error: 'Casino access is off for this room.' });
});

check('casino — rejects when table obligation is pending (all five kinds)', () => {
  const obligations = [
    ['pendingPayment', { playerId: 'x', creditorId: null, amountRemaining: 1, reason: 'r' }],
    ['auction', { active: true }],
    ['pendingPurchaseOffer', { playerId: 'x', tileIndex: 1 }],
    ['pendingTrade', { from: 'x' }],
    ['pendingPlayerContract', { id: 'x' }]
  ];
  for (const [field, value] of obligations) {
    const room = makeStartedRoom();
    room.game[field] = value;
    assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 10, 'c1'), { success: false, error: 'Resolve the table obligation before betting.' }, field);
    room.game[field] = null;
  }
});

check('casino — rejects unknown socket and unstarted rooms as unavailable', () => {
  const room = makeStartedRoom();
  assert.deepEqual(room.placeCasinoBet('socket-zz', 'red', 10, 'c1'), { success: false, error: 'Casino access is unavailable right now.' });
  const manager = new RoomManager();
  const lobby = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  lobby.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  lobby.setRoomSetting('casino', true);
  assert.deepEqual(lobby.placeCasinoBet('socket-a', 'red', 10, 'c1'), { success: false, error: 'Casino access is unavailable right now.' });
});

check('casino — rejects bankrupt and disconnected players as unavailable', () => {
  const room = makeStartedRoom();
  room.game.getPlayerBySocket('socket-b').bankrupt = true;
  assert.deepEqual(room.placeCasinoBet('socket-b', 'red', 10, 'c1'), { success: false, error: 'Casino access is unavailable right now.' });
  const other = makeStartedRoom();
  other.game.getPlayerBySocket('socket-b').disconnected = true;
  assert.deepEqual(other.placeCasinoBet('socket-b', 'red', 10, 'c1'), { success: false, error: 'Casino access is unavailable right now.' });
});

check('casino — color validation matrix', () => {
  const room = makeStartedRoom();
  assert.deepEqual(room.placeCasinoBet('socket-a', 'blue', 10, 'c1'), { success: false, error: 'Choose red, black, or green.' });
  assert.deepEqual(room.placeCasinoBet('socket-a', '', 10, 'c1'), { success: false, error: 'Choose red, black, or green.' });
  assert.deepEqual(room.placeCasinoBet('socket-a', null, 10, 'c1'), { success: false, error: 'Choose red, black, or green.' });
  assert.deepEqual(room.placeCasinoBet('socket-a', undefined, 10, 'c1'), { success: false, error: 'Choose red, black, or green.' });
  // Uppercase and mixed-case colors are normalized, not rejected.
  const result = withPocketRolls([2], () => room.placeCasinoBet('socket-a', 'Red', 10, 'c-upper'));
  assert.equal(result.success, true);
  assert.equal(result.result.color, 'red');
});

check('casino — stake validation matrix against casinoLimits()', () => {
  const room = makeStartedRoom();
  const limits = room.game.casinoLimits();
  assert.deepEqual(limits, { maxBet: 500, entryFee: 0 });
  const rangeError = 'Stake must be between $1 and 500.';
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 0, 'c1'), { success: false, error: rangeError });
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', -5, 'c1'), { success: false, error: rangeError });
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 'abc', 'c1'), { success: false, error: rangeError });
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 'NaN', 'c1'), { success: false, error: rangeError });
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', null, 'c1'), { success: false, error: rangeError });
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', Infinity, 'c1'), { success: false, error: rangeError });
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 501, 'c1'), { success: false, error: rangeError });
  // Fractional and numeric-string stakes are floored, then validated.
  const result = withPocketRolls([1], () => room.placeCasinoBet('socket-a', 'red', '10.9', 'c-floor'));
  assert.equal(result.success, true);
  assert.equal(result.result.stake, 10);
  assert.equal(result.result.balanceAfter, 1510);
});

check('casino — loan-backed cash is rejected after stake validation', () => {
  for (const status of ['active', 'due']) {
    const room = makeStartedRoom();
    room.game.getPlayerBySocket('socket-a').bankLoan = { status };
    assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 10, 'c1'), { success: false, error: 'Loan-backed cash cannot enter the casino.' }, status);
  }
  const room = makeStartedRoom();
  room.game.getPlayerBySocket('socket-a').bankLoan = { status: 'paid' };
  assert.equal(withPocketRolls([1], () => room.placeCasinoBet('socket-a', 'red', 10, 'c2')).success, true);
});

check('casino — insufficient cash covers stake plus entry fee', () => {
  const room = makeStartedRoom();
  const player = room.game.getPlayerBySocket('socket-a');
  player.cash = 40;
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 50, 'c1'), {
    success: false,
    error: 'You do not have enough available cash for the stake and event fee.'
  });
  // Exactly enough cash is allowed (and marks the all-in fact).
  player.cash = 50;
  const result = withPocketRolls([2], () => room.placeCasinoBet('socket-a', 'red', 50, 'c2'));
  assert.equal(result.success, true);
  assert.equal(player.casinoAllIn, true);
});

check('casino — event effects lower maxBet and add an entry fee', () => {
  const room = makeStartedRoom();
  room.game.globalEvent = { id: 'custom', phase: 'active', effects: { casinoMaxBet: 100, casinoEntryFee: 25 } };
  assert.deepEqual(room.game.casinoLimits(), { maxBet: 100, entryFee: 25 });
  assert.deepEqual(room.placeCasinoBet('socket-a', 'red', 101, 'c0'), { success: false, error: 'Stake must be between $1 and 100.' });
  const loser = withPocketRolls([2], () => room.placeCasinoBet('socket-a', 'red', 100, 'c1'));
  assert.equal(loser.result.balanceAfter, 1375);
  assert.equal(loser.result.net, -125);
  assert.equal(feedTexts(room)[0], 'A bet $100 on RED and lost $125.');
  const winner = withPocketRolls([1], () => room.placeCasinoBet('socket-a', 'red', 50, 'c2'));
  assert.equal(winner.result.balanceAfter, 1400);
  assert.equal(winner.result.net, 25);
  assert.equal(winner.economy.casino.maxBet, 100);
  assert.equal(winner.economy.casino.entryFee, 25);
});

// ---------------------------------------------------------------------------
// Casino: settlement outcomes, ledger, feed, idempotency
// ---------------------------------------------------------------------------

check('casino — red win pays 1:1 with exact ledger, stats, and feed', () => {
  const room = makeStartedRoom();
  const player = room.game.getPlayerBySocket('socket-a');
  const other = room.game.getPlayerBySocket('socket-b');
  const result = withPocketRolls([1], () => room.placeCasinoBet('socket-a', 'red', 100, 'c1'));
  assert.equal(result.success, true);
  assert.equal(result.result.pocket, 1);
  assert.equal(result.result.color, 'red');
  assert.equal(result.result.resultColor, 'red');
  assert.equal(result.result.stake, 100);
  assert.equal(result.result.net, 100);
  assert.equal(result.result.balanceAfter, 1600);
  assert.equal(player.cash, 1600);
  assert.equal(player.casinoNet, 100);
  assert.equal(player.casinoMaxStake, 100);
  assert.equal(player.casinoTotalStaked, 100);
  assert.equal(player.casinoAllIn, false);
  assert.equal(player.casinoOneDollar, false);
  assert.equal(player.casinoBetsThisRound, 1);
  assert.equal(other.casinoBetsThisRound, 0);
  assert.equal(feedTexts(room)[0], 'A bet $100 on RED and won $100.');
  assert.equal(room.game.casinoLedger.length, 1);
  assert.equal(room.game.casinoLedger[0].playerId, player.id);
  assert.equal(room.game.casinoLedger[0].transactionId, `${player.id}:casino:c1`);
  assert.equal(room.game.casinoLedger[0].roundNumber, 1);
  assert.equal(typeof room.game.casinoLedger[0].createdAt, 'string');
  assert.equal(room.game.casinoLedger[0].createdAt, new Date(room.game.casinoLedger[0].createdAt).toISOString());
  assert.equal(player.casinoLedger.length, 1);
  assert.equal(player.casinoLedger[0].playerId, undefined);
  assert.deepEqual(room.game.casinoLastResult, {
    playerId: player.id, color: 'red', pocket: 1, resultColor: 'red', net: 100, roundNumber: 1
  });
  assert.equal(result.economy.casino.enabled, true);
  assert.equal(result.economy.casino.net, 100);
  assert.deepEqual(result.economy.casino.lastResult, room.game.casinoLastResult);
  assert.equal(result.economy.market.enabled, false);
});

check('casino — black win on a black pocket pays 1:1', () => {
  const room = makeStartedRoom();
  const result = withPocketRolls([2], () => room.placeCasinoBet('socket-b', 'black', 25, 'c2'));
  assert.equal(result.result.resultColor, 'black');
  assert.equal(result.result.net, 25);
  assert.equal(result.result.balanceAfter, 1525);
  assert.equal(feedTexts(room)[0], 'B bet $25 on BLACK and won $25.');
});

check('casino — green pays 35:1 only on pocket 0', () => {
  const room = makeStartedRoom();
  const winner = withPocketRolls([0], () => room.placeCasinoBet('socket-a', 'green', 10, 'g1'));
  assert.equal(winner.result.net, 350);
  assert.equal(winner.result.balanceAfter, 1850);
  assert.equal(feedTexts(room)[0], 'A bet $10 on GREEN and won $350.');
  const loser = withPocketRolls([1], () => room.placeCasinoBet('socket-a', 'green', 10, 'g2'));
  assert.equal(loser.result.net, -10);
  assert.equal(loser.result.balanceAfter, 1840);
  assert.equal(feedTexts(room)[0], 'A bet $10 on GREEN and lost $10.');
});

check('casino — red and black lose to a green pocket', () => {
  const room = makeStartedRoom();
  const loser = withPocketRolls([0], () => room.placeCasinoBet('socket-a', 'red', 20, 'g3'));
  assert.equal(loser.result.resultColor, 'green');
  assert.equal(loser.result.net, -20);
  assert.equal(feedTexts(room)[0], 'A bet $20 on RED and lost $20.');
});

check('casino — one-dollar bet sets the one-dollar fact', () => {
  const room = makeStartedRoom();
  const player = room.game.getPlayerBySocket('socket-a');
  withPocketRolls([2], () => room.placeCasinoBet('socket-a', 'black', 1, 'd1'));
  assert.equal(player.casinoOneDollar, true);
  assert.equal(player.casinoMaxStake, 1);
});

check('casino — requestId transactions are idempotent and keyed per player', () => {
  const room = makeStartedRoom();
  const first = withPocketRolls([1], () => room.placeCasinoBet('socket-a', 'red', 10, 'same'));
  const feedLength = room.game.feed.length;
  const replay = room.placeCasinoBet('socket-a', 'red', 10, 'same');
  assert.equal(replay, first);
  assert.equal(room.game.feed.length, feedLength);
  assert.equal(room.game.getPlayerBySocket('socket-a').cash, 1510);
  // Another player shares neither the cache nor the transaction id.
  const other = withPocketRolls([2], () => room.placeCasinoBet('socket-b', 'red', 10, 'same'));
  assert.notEqual(other, first);
  assert.equal(other.result.transactionId, `${room.game.getPlayerBySocket('socket-b').id}:casino:same`);
});

check('casino — missing requestId generates uuid ledger ids without caching', () => {
  const room = makeStartedRoom();
  const first = withPocketRolls([1, 2], () => {
    const a = room.placeCasinoBet('socket-a', 'red', 10);
    const b = room.placeCasinoBet('socket-a', 'red', 10);
    return [a, b];
  });
  assert.match(first[0].result.transactionId, /^[0-9a-f-]{36}$/);
  assert.notEqual(first[1], first[0]);
  assert.equal(room.game.getPlayerBySocket('socket-a').casinoBetsThisRound, 2);
});

check('casino — blank and oversized request ids degrade to no cache key', () => {
  const room = makeStartedRoom();
  const [first, replay] = withPocketRolls([1, 1], () => [
    room.placeCasinoBet('socket-a', 'red', 10, '   '),
    room.placeCasinoBet('socket-a', 'red', 10, '   ')
  ]);
  assert.notEqual(replay, first);
  const longId = `x${'y'.repeat(200)}`;
  const pinned = withPocketRolls([1], () => room.placeCasinoBet('socket-a', 'red', 10, longId));
  assert.equal(pinned.result.transactionId, `${room.game.getPlayerBySocket('socket-a').id}:casino:${`x${'y'.repeat(99)}`}`);
});

check('casino — player ledger caps at 50 entries', () => {
  const room = makeStartedRoom();
  const player = room.game.getPlayerBySocket('socket-a');
  player.cash = 500;
  const pockets = Array.from({ length: 60 }, (_, i) => (i % 37));
  withPocketRolls(pockets, () => {
    for (let i = 0; i < 60; i += 1) {
      room.placeCasinoBet('socket-a', 'red', 1, `flood-${i}`);
    }
  });
  assert.equal(player.casinoLedger.length, 50);
  assert.equal(room.game.casinoLedger.length, 60);
  assert.equal(room.game.feed.length, 40);
});

// ---------------------------------------------------------------------------
// chargePlayer: full payment, partial payment -> pendingPayment
// ---------------------------------------------------------------------------

check('chargePlayer — full payment credits the creditor with rent facts', () => {
  const room = makeStartedRoom(false);
  const a = room.game.getPlayerBySocket('socket-a');
  const b = room.game.getPlayerBySocket('socket-b');
  room.game.chargePlayer({ player: b, creditor: a, amount: 1500, message: 'B paid $1500 rent to A.', turnOptions: {} });
  assert.equal(b.cash, 0);
  assert.equal(b.zeroCashReached, true);
  assert.equal(a.cash, 3000);
  assert.equal(a.rentCollected, 1500);
  assert.equal(a.rentPayerIds.has(b.id), true);
  assert.equal(a.maxRentPayersInRound, 1);
  assert.equal(room.game.pendingPayment, null);
  assert.equal(feedTexts(room)[0], 'B paid $1500 rent to A.');
  assert.equal(room.game.awaitingEndTurn, true);
});

check('chargePlayer — non-positive or missing payer just resolves the turn', () => {
  const room = makeStartedRoom(false);
  const a = room.game.getPlayerBySocket('socket-a');
  room.game.awaitingEndTurn = false;
  room.game.chargePlayer({ player: a, amount: 0, message: 'nothing', turnOptions: {} });
  assert.equal(a.cash, 1500);
  assert.equal(room.game.awaitingEndTurn, true);
  room.game.chargePlayer({ player: null, creditor: a, amount: 100, message: 'ghost', turnOptions: {} });
  assert.equal(a.cash, 1500);
});

check('chargePlayer — shortfall pays what it can and opens pendingPayment', () => {
  const room = makeStartedRoom(false);
  const a = room.game.getPlayerBySocket('socket-a');
  const b = room.game.getPlayerBySocket('socket-b');
  b.cash = 300;
  room.game.chargePlayer({ player: b, creditor: a, amount: 1000, message: 'B paid $1000 rent to A.', turnOptions: { turn: 'ctx' }, hooks: { equityTileIndex: 1, equityOwnerId: 'e' } });
  assert.equal(b.cash, 0);
  assert.equal(b.zeroCashReached, true);
  assert.equal(a.cash, 1800);
  assert.equal(a.rentCollected, 300);
  assert.deepEqual(room.game.pendingPayment, {
    playerId: b.id, creditorId: a.id, amountRemaining: 700, reason: 'B paid $1000 rent to A.', equityTileIndex: 1, equityOwnerId: 'e'
  });
  assert.deepEqual(room.game.pendingPaymentTurnOptions, { turn: 'ctx' });
  assert.deepEqual(feedTexts(room).slice(0, 2), [
    'B owes $700. Mortgage or sell buildings to raise funds, or declare bankruptcy.',
    'B paid $300 toward the debt.'
  ]);
  assert.equal(room.game.awaitingEndTurn, false);
});

check('chargePlayer — zero-cash debtor opens the debt without a partial feed', () => {
  const room = makeStartedRoom(false);
  const b = room.game.getPlayerBySocket('socket-b');
  const a = room.game.getPlayerBySocket('socket-a');
  b.cash = 0;
  room.game.chargePlayer({ player: b, creditor: a, amount: 500, message: 'debt message', turnOptions: {} });
  assert.equal(a.cash, 1500);
  assert.equal(room.game.pendingPayment.amountRemaining, 500);
  assert.equal(feedTexts(room)[0], 'B owes $500. Mortgage or sell buildings to raise funds, or declare bankruptcy.');
});

check('chargePlayer — bank debt keeps a null creditor and default equity hooks', () => {
  const room = makeStartedRoom(false);
  const b = room.game.getPlayerBySocket('socket-b');
  b.cash = 0;
  room.game.chargePlayer({ player: b, amount: 500, message: 'B owed the bank', turnOptions: {} });
  assert.deepEqual(room.game.pendingPayment, {
    playerId: b.id, creditorId: null, amountRemaining: 500, reason: 'B owed the bank', equityTileIndex: null, equityOwnerId: null
  });
});

// ---------------------------------------------------------------------------
// declareBankruptcy + handleBankruptcy
// ---------------------------------------------------------------------------

check('declareBankruptcy — guards, then voluntary retirement (behavior change)', () => {
  const room = makeStartedRoom(false);
  assert.deepEqual(room.declareBankruptcy('socket-zz'), { success: false, error: 'Player not found.' });
  const lobbyManager = new RoomManager();
  const lobby = lobbyManager.createRoom({ socketId: 'socket-l', clientId: 'client-l', nickname: 'L' });
  assert.deepEqual(lobby.declareBankruptcy('socket-l'), { success: false, error: 'The game has not started.' });
  // Debt is no longer required: a solvent player can walk away. This block
  // previously pinned "You have no outstanding debt to settle."; the
  // bankruptcy-ownership redesign replaced that rejection with retirement.
  const first = room.declareBankruptcy('socket-b');
  assert.equal(first.success, true);
  assert.equal(first.voluntary, true);
  assert.equal(room.game.getPlayerBySocket('socket-b').bankrupt, true);
  // Two-seat room: with B retired, A is the last seat standing and the game
  // concludes; a second declaration hits the not-started guard.
  assert.deepEqual(room.declareBankruptcy('socket-a'), { success: false, error: 'The game has not started.' });
});

check('voluntary retirement releases deeds neutral and cancels held obligations', () => {
  const room = trioRoom();
  const game = room.game;
  const a = game.getPlayerBySocket('socket-a');
  const deed = game.getTile(1);
  deed.ownerId = a.id;
  deed.houseCount = 2;
  deed.mortgaged = true;
  a.properties = [deed.index];
  game.pendingTrade = { fromPlayerId: a.id, toPlayerId: game.players[1].id };
  game.pendingPlayerContract = { fromPlayerId: a.id, toPlayerId: game.players[2].id };
  const result = room.declareBankruptcy('socket-a');
  assert.equal(result.success, true);
  assert.equal(deed.ownerId, null);
  assert.equal(deed.houseCount, 0);
  assert.equal(deed.mortgaged, false);
  assert.deepEqual(a.properties, []);
  assert.equal(game.pendingTrade, null);
  assert.equal(game.pendingPlayerContract, null);
  const feeds = feedTexts(room);
  assert.ok(feeds.includes('A left the table. A pending trade was cancelled.'));
  assert.ok(feeds.includes('A left the table. A pending contract was cancelled.'));
  assert.ok(feeds.includes('A is bankrupt and removed from the game.'));
  assert.deepEqual(room.declareBankruptcy('socket-a'), { success: false, error: 'That player is already out of the game.' });
});

check('unsecured bank loan default files a bank claim instead of auto-eliminating', () => {
  const room = makeStartedRoom(false);
  const game = room.game;
  const b = game.getPlayerBySocket('socket-b');
  b.cash = 40;
  b.bankLoan = { status: 'due', remaining: 300, dueRound: game.roundNumber, cureRound: game.roundNumber };
  game.roundNumber += 1;
  game.processBankLoans();
  assert.equal(b.bankrupt, false);
  assert.equal(b.bankLoan.status, 'defaulted');
  assert.equal(b.cash, 0);
  assert.equal(game.pendingPayment.playerId, b.id);
  assert.equal(game.pendingPayment.creditorId, null);
  assert.equal(game.pendingPayment.amountRemaining, 260);
  const feeds = feedTexts(room);
  assert.ok(feeds.includes('B defaulted on an unsecured bank loan.'));
  assert.ok(feeds.includes('B paid $40 toward the debt.'));
  assert.ok(feeds.includes('B owes $260. Mortgage or sell buildings to raise funds, or declare bankruptcy.'));
  // The debt is now the player's choice: settling or retiring both work.
  assert.equal(room.declareBankruptcy('socket-b').success, true);
  assert.equal(b.bankrupt, true);
  assert.equal(game.pendingPayment, null);
});

check('a solvent player repays an unsecured default in full without a claim', () => {
  const room = makeStartedRoom(false);
  const game = room.game;
  const b = game.getPlayerBySocket('socket-b');
  b.cash = 500;
  b.bankLoan = { status: 'due', remaining: 300, dueRound: game.roundNumber, cureRound: game.roundNumber };
  game.roundNumber += 1;
  game.processBankLoans();
  assert.equal(b.bankrupt, false);
  assert.equal(b.cash, 200);
  assert.equal(game.pendingPayment, null);
  assert.ok(feedTexts(room).includes('B paid the bank $300 on default.'));
});

check('loan collateral is re-validated when the contract is accepted', () => {
  const room = makeStartedRoom(false);
  const game = room.game;
  const a = game.getPlayerBySocket('socket-a');
  const b = game.getPlayerBySocket('socket-b');
  const deed = game.getTile(1);
  deed.ownerId = b.id;
  a.cash = 1000;
  const proposed = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 200, collateralTileIndex: 1 });
  assert.equal(proposed.success, true);
  // The borrower mortgages the pledged deed while the offer is pending.
  deed.mortgaged = true;
  const accepted = game.respondPlayerContract('socket-b', true);
  assert.deepEqual(accepted, { success: false, error: 'The loan collateral is no longer available.' });
  assert.equal(a.cash, 1000); // lender never funds against vanished security
  assert.equal(game.pendingPlayerContract, null);
  assert.equal(game.playerContracts.length, 0);
});

check('a due player loan notifies the lender in the feed', () => {
  const room = makeStartedRoom(false);
  const game = room.game;
  const a = game.getPlayerBySocket('socket-a');
  const b = game.getPlayerBySocket('socket-b');
  a.cash = 1000;
  const proposed = game.proposePlayerContract('socket-a', { toPlayerId: b.id, kind: 'loan', amount: 100 });
  assert.equal(proposed.success, true);
  game.respondPlayerContract('socket-b', true);
  const contract = game.playerContracts[0];
  contract.dueRound = game.roundNumber;
  game.roundNumber += 1;
  game.processPlayerContracts();
  const feeds = feedTexts(room);
  assert.ok(feeds.includes('B owes $100 on a player loan.'));
  assert.ok(feeds.includes('A is owed $100 by B.'));
});

check('equity settlement ignores corrupt shares and bankrupt owners', () => {
  const room = makeStartedRoom(false);
  const game = room.game;
  const tile = game.getTile(1);
  const owner = game.getPlayerBySocket('socket-a');
  const holder = game.getPlayerBySocket('socket-b');
  const contract = { id: 'x1', status: 'active' };
  game.playerContracts = [contract];
  owner.cash = 500;
  tile.equityShares = [{ holderId: holder.id, share: 'nonsense', contractId: 'x1' }];
  game.settleEquityShares(tile, owner, 200);
  assert.equal(owner.cash, 500); // NaN share skipped, no corruption
  tile.equityShares = [{ holderId: holder.id, share: 50, contractId: 'x1' }];
  owner.bankrupt = true;
  game.settleEquityShares(tile, owner, 200);
  assert.equal(holder.cash, game.getPlayerBySocket('socket-b').cash);
});

check('forced market liquidation records realized P&L on the way out', () => {
  const room = makeStartedRoom(false);
  const game = room.game;
  const b = game.getPlayerBySocket('socket-b');
  b.cash = 0;
  b.marketPositions = { brazil: { quantity: 2, averageCost: 120, realizedPnl: 0 } };
  game.chargePlayer({ player: b, amount: 500, message: 'debt', turnOptions: {} });
  room.declareBankruptcy('socket-b');
  // 2 units at the fresh 100 quote: proceeds 200 - ceil(4) = 196; cost basis 240.
  const feeds = feedTexts(room);
  assert.ok(feeds.includes("B's market positions were liquidated for $196."));
  assert.equal(b.marketPositions.brazil.quantity, 0);
  assert.equal(b.marketPositions.brazil.realizedPnl, -44); // 196 net proceeds - 240 cost basis
});

check('bankruptcy — partial, liquidation, sweep, and deed transfer reach the creditor in order', () => {
  const room = trioRoom();
  const game = room.game;
  const a = game.getPlayerBySocket('socket-a');
  const b = game.getPlayerBySocket('socket-b');
  b.cash = 300;
  game.chargePlayer({ player: b, creditor: a, amount: 1000, message: 'rent message', turnOptions: {} });
  // B holds deeds 1 and 3, deed 1 mortgaged with buildings, plus market bags.
  game.tiles[1].ownerId = b.id;
  game.tiles[1].mortgaged = true;
  game.tiles[1].houseCount = 2;
  game.tiles[3].ownerId = b.id;
  b.properties = [1, 3];
  b.marketPositions = { brazil: { quantity: 2 }, ghana: { quantity: 0 }, ghost: { quantity: 9 } };
  b.bubbleSurvivor = true;
  game.extraRollPending = true;
  game.turnAllowsExtraRoll = true;
  game.consecutiveDoubles = 2;
  assert.equal(room.declareBankruptcy('socket-b').success, true);
  // 2*100 gross minus ceil(2*100*0.02)=4 fee -> $196 liquidated into B's cash
  // first, then swept to the creditor. Positions flatten but stay recorded
  // so the match snapshot captures the realized P&L of the forced exit.
  assert.equal(a.cash, 1800 + 196);
  assert.equal(b.cash, 0);
  assert.equal(b.marketPositions.brazil.quantity, 0);
  assert.equal(b.marketPositions.brazil.realizedPnl, 196);
  assert.equal(b.marketPositions.ghost.realizedPnl, 0);
  assert.equal(b.bankrupt, true);
  assert.equal(b.bubbleSurvivor, false);
  assert.equal(game.extraRollPending, false);
  assert.equal(game.turnAllowsExtraRoll, false);
  assert.equal(game.consecutiveDoubles, 0);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.pendingPaymentTurnOptions, null);
  assert.deepEqual(a.properties, [1, 3]);
  assert.deepEqual(b.properties, []);
  assert.equal(game.tiles[1].ownerId, a.id);
  assert.equal(game.tiles[1].mortgaged, false);
  assert.equal(game.tiles[1].houseCount, 0);
  assert.deepEqual(feedTexts(room).slice(0, 2), [
    'B is bankrupt. Assets transferred to A.',
    "B's market positions were liquidated for $196."
  ]);
  // B was not the current player: the turn does not advance.
  assert.equal(game.currentPlayerId, a.id);
});

check('bankruptcy — liquidation floors the fee and ignores unquoted positions', () => {
  const room = trioRoom();
  const game = room.game;
  const b = game.getPlayerBySocket('socket-b');
  b.cash = 0;
  b.marketPositions = { brazil: { quantity: 1 } };
  game.chargePlayer({ player: b, amount: 500, message: 'debt', turnOptions: {} });
  room.declareBankruptcy('socket-b');
  // 100 - ceil(2) = 98 into a debtless-but-bankrupt... creditor-less player:
  // cash stays with the bankrupt player (no creditor to sweep).
  assert.equal(b.cash, 98);
  assert.equal(feedTexts(room)[0], "B is bankrupt and removed from the game.");
  assert.equal(feedTexts(room)[1], "B's market positions were liquidated for $98.");
});

check('bankruptcy — no creditor releases deeds (mortgage and houses cleared)', () => {
  const room = trioRoom();
  const game = room.game;
  const b = game.getPlayerBySocket('socket-b');
  b.cash = 0;
  game.tiles[5].ownerId = b.id;
  game.tiles[5].mortgaged = true;
  game.tiles[5].houseCount = 4;
  b.properties = [5];
  game.chargePlayer({ player: b, amount: 500, message: 'debt', turnOptions: {} });
  assert.deepEqual(room.declareBankruptcy('socket-b'), { success: true, voluntary: false });
  assert.equal(game.tiles[5].ownerId, null);
  assert.equal(game.tiles[5].mortgaged, false);
  assert.equal(game.tiles[5].houseCount, 0);
  assert.deepEqual(b.properties, []);
  assert.equal(game.currentPlayerId, game.getPlayerBySocket('socket-a').id);
});

check('bankruptcy — contracts settle before deeds move', () => {
  const room = trioRoom();
  const game = room.game;
  const a = game.getPlayerBySocket('socket-a');
  const b = game.getPlayerBySocket('socket-b');
  const cc = game.getPlayerBySocket('socket-c');
  b.cash = 0;
  // B already owes collateral deed 6 to lender A; deed 1 is a plain holding.
  game.tiles[6].ownerId = b.id;
  game.tiles[1].ownerId = b.id;
  b.properties = [6, 1];
  game.playerContracts.push(
    { id: 'L1', kind: 'loan', status: 'active', fromPlayerId: a.id, toPlayerId: b.id, collateralTileIndex: 6 },
    { id: 'L2', kind: 'loan', status: 'due', fromPlayerId: b.id, toPlayerId: cc.id, collateralTileIndex: null },
    { id: 'L3', kind: 'loan', status: 'paid', fromPlayerId: a.id, toPlayerId: b.id, collateralTileIndex: 1 },
    { id: 'E1', kind: 'equity', status: 'active', fromPlayerId: cc.id, toPlayerId: b.id, propertyIndex: 12 }
  );
  game.tiles[12].equityShares = [
    { contractId: 'E1', holderId: cc.id, share: 20 },
    { contractId: 'E9', holderId: a.id, share: 10 }
  ];
  game.chargePlayer({ player: b, amount: 400, message: 'debt', turnOptions: {} });
  room.declareBankruptcy('socket-b');
  const l1 = game.playerContracts.find(contract => contract.id === 'L1');
  const l2 = game.playerContracts.find(contract => contract.id === 'L2');
  const l3 = game.playerContracts.find(contract => contract.id === 'L3');
  const e1 = game.playerContracts.find(contract => contract.id === 'E1');
  assert.equal(l1.status, 'defaulted');
  assert.equal(l1.defaultedRound, 1);
  assert.equal(game.tiles[6].ownerId, a.id);
  assert.equal(b.collateralLost, true);
  assert.equal(l2.status, 'terminated');
  assert.equal(l2.terminatedRound, 1);
  assert.equal(l3.status, 'paid');
  assert.equal(e1.status, 'terminated');
  assert.deepEqual(game.tiles[12].equityShares.map(share => share.contractId), ['E9']);
  // Collateral deed 6 moved during contract settling; the bank-debt path has
  // no creditor, so the remaining deed 1 is released unowned.
  assert.deepEqual(a.properties, [6]);
  assert.equal(game.tiles[1].ownerId, null);
});

check('bankruptcy — collateral only transfers while the debtor still holds it', () => {
  const room = makeStartedRoom(false);
  const game = room.game;
  const a = game.getPlayerBySocket('socket-a');
  const b = game.getPlayerBySocket('socket-b');
  b.cash = 0;
  game.tiles[6].ownerId = a.id;
  game.playerContracts.push({ id: 'L1', kind: 'loan', status: 'active', fromPlayerId: a.id, toPlayerId: b.id, collateralTileIndex: 6 });
  game.chargePlayer({ player: b, amount: 400, message: 'debt', turnOptions: {} });
  room.declareBankruptcy('socket-b');
  assert.equal(game.tiles[6].ownerId, a.id);
  assert.equal(b.collateralLost, true);
  assert.equal(game.playerContracts[0].status, 'defaulted');
});

check('bankruptcy — bankrupt current player hands over the turn', () => {
  const room = trioRoom();
  const game = room.game;
  const a = game.getPlayerBySocket('socket-a');
  const b = game.getPlayerBySocket('socket-b');
  assert.equal(game.currentPlayerId, a.id);
  a.cash = 0;
  game.chargePlayer({ player: a, creditor: b, amount: 900, message: 'debt', turnOptions: {} });
  room.declareBankruptcy('socket-a');
  assert.equal(a.bankrupt, true);
  assert.equal(b.cash, 1500);
  assert.equal(game.currentPlayerId, b.id);
  assert.deepEqual(feedTexts(room).slice(0, 2), ["B's turn.", 'A is bankrupt. Assets transferred to B.']);
});

check('bankruptcy — last player standing ends the game', () => {
  const room = makeStartedRoom(false);
  const game = room.game;
  const a = game.getPlayerBySocket('socket-a');
  const b = game.getPlayerBySocket('socket-b');
  b.cash = 0;
  game.chargePlayer({ player: b, amount: 400, message: 'debt', turnOptions: {} });
  room.declareBankruptcy('socket-b');
  assert.deepEqual(feedTexts(room).slice(0, 2), [
    'A is the last player remaining and wins the game!',
    'B is bankrupt and removed from the game.'
  ]);
  assert.deepEqual(game.lastWinner, { id: a.id, nickname: 'A' });
  assert.equal(game.started, false);
  assert.equal(game.currentPlayerId, null);
});

// ---------------------------------------------------------------------------
// Room.setRoomSetting — per-key normalization table
// ---------------------------------------------------------------------------

function lobby() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  return room;
}

check('setRoomSetting — locked after start and for unknown/inherited keys', () => {
  const room = lobby();
  room.startGame();
  room.setRoomSetting('maxPlayers', 2);
  room.setRoomSetting('casino', true);
  assert.equal(room.settings.maxPlayers, 4);
  assert.equal(room.settings.casino, false);
  const fresh = lobby();
  fresh.setRoomSetting('totallyUnknown', 5);
  assert.equal('totallyUnknown' in fresh.settings, false);
  fresh.setRoomSetting('hasOwnProperty', 'x');
  assert.equal(typeof fresh.settings.hasOwnProperty, 'function');
  assert.equal(fresh.setRoomSetting('maxPlayers', 3), undefined);
});

check('setRoomSetting — legacy scaled keys are ignored', () => {
  const room = lobby();
  room.setRoomSetting('globalEventDuration', 10);
  room.setRoomSetting('globalEventMax', 2);
  assert.equal(room.settings.globalEventDuration, 5);
  assert.equal(room.settings.globalEventMax, 1);
  assert.equal(room.game.settings.globalEventDuration, 5);
});

check('setRoomSetting — maxPlayers clamps to 2..4 and drops non-numeric', () => {
  const cases = [[5, 4], ['2', 2], [3.9, 3], [null, 2], [true, 2], ['abc', 4], [undefined, 4], [NaN, 4]];
  for (const [value, expected] of cases) {
    const room = lobby();
    room.setRoomSetting('maxPlayers', value);
    assert.equal(room.settings.maxPlayers, expected, JSON.stringify(value));
    assert.equal(room.game.settings.maxPlayers, expected, JSON.stringify(value));
  }
});

check('setRoomSetting — bots clamps against the current maxPlayers', () => {
  const room = lobby();
  room.setRoomSetting('maxPlayers', 2);
  room.setRoomSetting('bots', 9);
  assert.equal(room.settings.bots, 1);
  room.setRoomSetting('bots', '2');
  assert.equal(room.settings.bots, 1);
  room.setRoomSetting('bots', -1);
  assert.equal(room.settings.bots, 0);
  room.setRoomSetting('bots', 'x');
  assert.equal(room.settings.bots, 0);
  room.setRoomSetting('maxPlayers', 4);
  room.setRoomSetting('bots', 3.7);
  assert.equal(room.settings.bots, 3);
});

check('setRoomSetting — integer floors clamp at zero', () => {
  for (const key of ['houseLimit', 'hotelLimit', 'turnTimer']) {
    const room = lobby();
    room.setRoomSetting(key, '100.9');
    assert.equal(room.settings[key], 100, key);
    room.setRoomSetting(key, '-5');
    assert.equal(room.settings[key], 0, key);
    room.setRoomSetting(key, 'abc');
    assert.equal(room.settings[key], 0, key);
  }
});

check('setRoomSetting — startingCash floors and re-seats every player', () => {
  const room = lobby();
  room.setRoomSetting('startingCash', '2000.5');
  assert.equal(room.settings.startingCash, 2000);
  assert.equal(room.game.settings.startingCash, 2000);
  assert.deepEqual(room.game.players.map(player => player.cash), [2000, 2000]);
  room.setRoomSetting('startingCash', -20);
  assert.equal(room.game.players[0].cash, 0);
  room.setRoomSetting('startingCash', 'abc');
  assert.equal(room.settings.startingCash, 0);
  assert.deepEqual(room.game.players.map(player => player.cash), [0, 0]);
});

check('setRoomSetting — globalEvents accepts the extended truthy spellings', () => {
  const truths = [true, 'true', 'on', 'rare', 'hardcore', 1, '1'];
  const falses = [false, 'false', 'off', 0, '0', 'maybe', undefined];
  for (const value of truths) {
    const room = lobby();
    room.setRoomSetting('globalEvents', value);
    assert.equal(room.settings.globalEvents, true, JSON.stringify(value));
  }
  for (const value of falses) {
    const room = lobby();
    room.setRoomSetting('globalEvents', value);
    assert.equal(room.settings.globalEvents, false, JSON.stringify(value));
  }
});

check('setRoomSetting — botPersonality whitelists case-insensitively', () => {
  const room = lobby();
  room.setRoomSetting('botPersonality', 'Builder');
  assert.equal(room.settings.botPersonality, 'builder');
  room.setRoomSetting('botPersonality', 'SHARK');
  assert.equal(room.settings.botPersonality, 'shark');
  room.setRoomSetting('botPersonality', 'chaos');
  assert.equal(room.settings.botPersonality, 'chaos');
  room.setRoomSetting('botPersonality', 'wrong');
  assert.equal(room.settings.botPersonality, 'survivor');
  room.setRoomSetting('botPersonality', 7);
  assert.equal(room.settings.botPersonality, 'survivor');
});

check('setRoomSetting — boolean keys parse only true/"true"/1/"1"', () => {
  for (const key of ['casino', 'market', 'auction', 'doubleRent', 'bankLoans']) {
    const room = lobby();
    const defaultBefore = room.settings[key];
    room.setRoomSetting(key, 'on');
    assert.equal(room.settings[key], false, `${key} on`);
    room.setRoomSetting(key, 2);
    assert.equal(room.settings[key], false, `${key} two`);
    room.setRoomSetting(key, 'true');
    assert.equal(room.settings[key], true, `${key} str`);
    room.setRoomSetting(key, 1);
    assert.equal(room.settings[key], true, `${key} num`);
    room.setRoomSetting(key, '1');
    assert.equal(room.settings[key], true, `${key} str1`);
    room.setRoomSetting(key, defaultBefore);
    assert.equal(room.settings[key], defaultBefore, `${key} reset`);
    assert.equal(room.game.settings[key], room.settings[key]);
  }
});

check('setRoomSetting — string keys trim, non-strings pass through', () => {
  const room = lobby();
  room.setRoomSetting('bankruptMode', '  elim  ');
  assert.equal(room.settings.bankruptMode, 'elim');
  room.setRoomSetting('bankruptMode', 5);
  assert.equal(room.settings.bankruptMode, 5);
  room.setRoomSetting('bankLoanSeverity', ' aggressive ');
  assert.equal(room.settings.bankLoanSeverity, 'aggressive');
  room.setRoomSetting('bankLoanSeverity', 'anything');
  assert.equal(room.settings.bankLoanSeverity, 'anything');
  assert.equal(room.game.settings.bankruptMode, 5);
});

// ---------------------------------------------------------------------------
// bankruptMode=debt
// ---------------------------------------------------------------------------

function debtTransferOutcomeProblem(result, player) {
  if (!result.success) return 'should succeed';
  if (result.voluntary !== false) return 'should not be voluntary';
  if (player.bankrupt) return 'should NOT be bankrupt';
  if (!player.inDebt) return 'should be inDebt';
  if (player.cash !== 0) return 'cash should be 0';
  return null;
}

check('debt mode — bankruptMode=debt transfers assets without elimination', () => {
  const room = makeStartedRoom(false);
  room.game.settings.bankruptMode = 'debt';
  const player = room.game.getPlayerBySocket('socket-a');
  player.cash = 500;
  const pendingPayment = { playerId: player.id, creditorId: null, amountRemaining: 500, reason: 'test' };
  room.game.pendingPayment = pendingPayment;
  const result = room.game.declareBankruptcy('socket-a');
  const problem = debtTransferOutcomeProblem(result, player);
  if (problem) throw new Error(problem);
});

console.log(`casino-bankruptcy tests: ${passed + failures.length} checks — ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('FAILED:', failures.join(', '));
  process.exitCode = 1;
}
