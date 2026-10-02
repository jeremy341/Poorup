// Regression checks for the bot snapshot literals: every field that claims to
// describe live table state must actually be read from the live state. The
// planner resolves seats and market books by key, so a literal or a mismatched
// shape there lands as "unsupported" instead of an obviously wrong number.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { evaluateCandidate } from './botFuturePlanner.js';
import { COMPLEXITY_RANK, MARGIN_MAINTENANCE_RATE } from './marketExpansion.js';
import { MARKET_INSTRUMENTS } from './marketLogic.js';

const failures = [];
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

function marketRoom(complexity) {
  const manager = new RoomManager();
  const room = manager.createRoom({
    socketId: 'a', clientId: 'a', nickname: 'A',
    rulesetPreset: 'after-hours', marketComplexity: complexity
  });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', true);
  room.setRoomSetting('marketComplexity', complexity);
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

function botMarketRoom(complexity) {
  const room = marketRoom(complexity);
  const bot = room.game.players[0];
  bot.isBot = true;
  room.game.currentPlayerId = bot.id;
  return { room, game: room.game, bot };
}

function marketDigest(complexity) {
  const { game, bot } = botMarketRoom(complexity);
  return buildBotStrategicContext(game, bot, 'pre-roll', 1).rulesDigest.market;
}

// Two humans plus two lobby bots: the seated bots land at indexes 2 and 3, so
// players[2] is a bot that is NOT the last seat - the arrangement whose
// opponents[] labels used to disagree with its own board[] labels.
function fourSeatRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'h1', clientId: 'h1', nickname: 'Human One' });
  room.addOrReconnectPlayer({ socketId: 'h2', clientId: 'h2', nickname: 'Human Two' });
  room.setRoomSetting('bots', 2);
  assert.equal(room.startGame().success, true);
  return room;
}

function rollCandidate() {
  return { id: 'roll', kind: 'roll' };
}

check('the market digest reports the live short-inventory pool keyed by instrument (B-30a)', () => {
  const room = marketRoom('shorting');
  const game = room.game;
  const market = buildBotStrategicContext(game, game.players[0], 'pre-roll', 1).rulesDigest.market;
  assert.deepEqual(market.borrowableUnits, game.marketShortInventory,
    'the digest must carry the live room-global pool, not a per-seat scalar');
  assert.equal(Object.keys(market.borrowableUnits).length, MARKET_INSTRUMENTS.length);
  // Shorting consumes that shared pool; the snapshot has to follow it down or
  // the bot plans shorts the table can no longer fill.
  assert.equal(room.openShort('a', 'brazil', 2, 'b30a-open').success, true);
  assert.equal(game.marketShortInventory.brazil, 48, 'the live pool lost two units');
  const after = buildBotStrategicContext(game, game.players[0], 'pre-roll', 1).rulesDigest.market;
  assert.equal(after.borrowableUnits.brazil, 48);
  assert.equal(after.borrowableUnits.airports, 50);
  // The pool is room-global: every seat reads the same depletion.
  assert.deepEqual(
    buildBotStrategicContext(game, game.players[1], 'pre-roll', 1).rulesDigest.market.borrowableUnits,
    after.borrowableUnits
  );
});

check('marketExpansion.shorts ships the {reservedCash, positions} the planner reads (B-30b)', () => {
  const { room, game, bot } = botMarketRoom('shorting');
  assert.equal(room.openShort('a', 'brazil', 1, 'b30b-open').success, true);
  const live = bot.shortPositions.brazil;
  const shorts = buildBotStrategicContext(game, bot, 'pre-roll', 1).botState.marketExpansion.shorts;
  assert.deepEqual(Object.keys(shorts).sort(), ['positions', 'reservedCash']);
  assert.equal(shorts.positions.brazil.quantity, live.quantity);
  assert.equal(shorts.positions.brazil.entryQuote, live.entryQuote);
  assert.equal(shorts.positions.brazil.collateral, live.collateral);
  assert.equal(shorts.reservedCash, live.collateral,
    'the reserved bucket must equal the collateral actually held against the short book');
});

check('the short book reserves only the collateral its own positions hold (B-30b)', () => {
  const room = marketRoom('shorting');
  const game = room.game;
  const bot = game.players[0];
  assert.equal(room.openMargin('a', 'brazil', 2, 'b30b-margin').success, true);
  bot.marketActionsThisTurn = 0; // one market order per turn
  assert.equal(room.openShort('a', 'brazil', 1, 'b30b-open').success, true);
  const shorts = buildBotStrategicContext(game, bot, 'pre-roll', 1).botState.marketExpansion.shorts;
  assert.equal(bot.reservedCash, 100, 'margin and short collateral share one seat bucket');
  assert.equal(shorts.reservedCash, 50,
    'the shipped bucket is the short book, which is the book the planner mutates');
  assert.equal(shorts.reservedCash, shorts.positions.brazil.collateral);
});

check('a real cover-short candidate projects instead of scoring unsupported (B-30b)', () => {
  const room = marketRoom('shorting');
  const game = room.game;
  const bot = game.players[0];
  bot.isBot = true;
  game.currentPlayerId = bot.id;
  assert.equal(room.openShort('a', 'brazil', 1, 'b30b-cover').success, true);
  bot.marketActionsThisTurn = 0; // the next turn re-advertises the manage book
  const snapshot = buildBotStrategicContext(game, bot, 'pre-roll', 1);
  const candidates = game.botMarketExpansionCandidates(bot);
  const project = (kind) => evaluateCandidate(
    snapshot,
    candidates.find(candidate => candidate.kind === kind),
    { difficulty: 'table', seed: 'b30b' }
  );
  const cover = project('cover-short');
  assert.equal(cover.projectionStatus, 'projected',
    'a held short must be projectable, otherwise the bot can never score a cover');
  assert.notEqual(cover.score, 0);
  assert.equal(project('open-short').projectionStatus, 'projected');
  assert.equal(project('open-margin').projectionStatus, 'projected');
});

check('every opponent seat resolves to one canonical label (B-32)', () => {
  const room = fourSeatRoom();
  const game = room.game;
  const [first, , bot, rival] = game.players;
  assert.equal(bot.isBot, true);
  assert.notEqual(bot, game.players[game.players.length - 1],
    'the fixture must seat the bot somewhere other than last');
  const tile = game.getTile(3);
  tile.ownerId = rival.id;
  rival.properties = [tile.index];
  game.pendingPayment = { playerId: rival.id, amountRemaining: 50, creditorId: first.id };
  const snapshot = buildBotStrategicContext(game, bot, 'pre-roll', 1);
  const seats = snapshot.opponents.map(opponent => opponent.seat);
  assert.deepEqual(seats, ['opponent-1', 'opponent-2', 'opponent-3']);
  assert.equal(new Set(seats).size, seats.length, 'seat labels stay unique');
  assert.equal(snapshot.board[3].ownerSeat, 'opponent-3',
    'the deed label and the opponents[] label must name the same seat');
  assert.equal(seats.includes(snapshot.board[3].ownerSeat), true);
  assert.equal(snapshot.obligations.payment.creditorSeat, 'opponent-1');
  // Any opponent-owned deed has to resolve to a listed seat, or the planner's
  // seat-keyed lookups (opponentIsJailed) can never match it.
  snapshot.board.filter(entry => entry.ownerSeat.startsWith('opponent')).forEach((entry) => {
    assert.equal(seats.includes(entry.ownerSeat), true, `tile ${entry.index} owner seat`);
  });
});

check('a jailed opponent owner is charged no rent risk from any seat (B-32)', () => {
  const room = fourSeatRoom();
  const game = room.game;
  const bot = game.players[2];
  const rival = game.players[3];
  game.currentPlayerId = bot.id;
  game.settings.noRentWhileInPrison = true;
  const tile = game.getTile(3);
  tile.ownerId = rival.id;
  rival.properties = [tile.index];
  rival.inJail = true;
  bot.position = 0;
  const projection = (sequence) => evaluateCandidate(
    buildBotStrategicContext(game, bot, 'pre-roll', sequence),
    rollCandidate(),
    { difficulty: 'table', seed: 'b32' }
  );
  assert.equal(projection(1).expectedRisk, 0,
    'a jailed owner collects nothing, so full rent risk is fiction');
  rival.inJail = false;
  assert.equal(projection(2).expectedRisk > 0, true, 'a free owner is still a live rent risk');
});

check('the market rate and complexity gates track the live expansion module', () => {
  const shorting = marketDigest('shorting');
  assert.equal(shorting.maintenanceRate, MARGIN_MAINTENANCE_RATE);
  assert.deepEqual([shorting.margin, shorting.shorting, shorting.derivatives], [true, true, false]);
  assert.deepEqual([marketDigest('derivatives').margin, marketDigest('derivatives').shorting, marketDigest('derivatives').derivatives], [true, true, true]);
  assert.deepEqual([marketDigest('margin').margin, marketDigest('margin').shorting, marketDigest('margin').derivatives], [true, false, false]);
  assert.deepEqual([marketDigest('basic').margin, marketDigest('basic').shorting, marketDigest('basic').derivatives], [false, false, false]);
  assert.equal(COMPLEXITY_RANK.shorting, 2);
});

check('the pass-Start base matches the live pass reward', () => {
  const room = fourSeatRoom();
  const game = room.game;
  const context = buildBotStrategicContext(game, game.players[2], 'pre-roll', 1);
  assert.equal(context.rulesDigest.passStartCash, game.startPassReward(false));
});

if (failures.length) {
  console.error(`\nbot context snapshot fixes: ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log('bot context snapshot fixes: all passed');
}