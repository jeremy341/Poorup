// Regression pins for the October bot-engine audit (docs/BOT-ENGINE-AUDIT-2026-10.md):
// small engine-contract mismatches that made bots spin, wait on an auction that
// never comes, or lose an option to an id collision.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { unmortgageCostFor } from './propertyRules.js';
import { declineForCheapAuction } from './botCandidates.js';
import { selectBotTurnTarget } from './botLogic.js';
import { buildBotStrategicContext } from './botStrategicContext.js';

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

function botRoom(botCount = 2) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sH', clientId: 'cH', nickname: 'Human', roomCode: 'AUDIT' });
  room.setRoomSetting('bots', botCount);
  assert.equal(room.startGame().success, true);
  return { room, game: room.game };
}

check('a bot does not decline a deed for a cheap auction that will never run', () => {
  const { game } = botRoom(2);
  const bot = game.players.find(player => player.isBot);
  const tile = game.tiles.find(candidate => candidate.group && candidate.price > 0);
  game.players.filter(player => player.id !== bot.id).forEach(player => { player.cash = 1; });
  bot.cash = 1500;
  game.settings.auction = true;
  assert.equal(declineForCheapAuction(game, bot, tile), true, 'with an auction to follow and broke rivals, declining is the cheap line');
  game.settings.auction = false;
  assert.equal(declineForCheapAuction(game, bot, tile), false, 'with auctions off the deed would simply stay unowned');
});

check('a debtor bot is not starved by an unvoted bot while a payment is open', () => {
  const { game } = botRoom(2);
  const [voter, debtor] = game.players.filter(player => player.isBot);
  game.globalEvent = { phase: 'voting', votes: {} };
  assert.equal(selectBotTurnTarget(game)?.isBot, true, 'an unvoted bot is served while nothing blocks the vote');
  game.pendingPayment = { playerId: debtor.id, amount: 50, reason: 'test' };
  assert.notEqual(selectBotTurnTarget(game)?.id, voter.id, 'the engine refuses votes during a payment, so the voter must not be picked');
});

check('trade candidates name the partner seat the planner must project against', () => {
  const { game } = botRoom(3);
  const bot = game.players.find(player => player.isBot);
  const opponents = game.players.filter(player => player.id !== bot.id);
  const partner = opponents[2];
  // The bot holds two Orange deeds and the third opponent holds the last one: a
  // same-group 1-for-1 swap is no longer generated (it changed nothing), the set
  // completer is.
  const [mine, extra, theirs] = game.tiles.filter(tile => tile.group === 'Orange' && tile.price > 0).slice(0, 3);
  assert.ok(mine && extra && theirs, 'the board has an orange trio');
  for (const tile of [mine, extra, theirs]) { tile.ownerId = null; }
  mine.ownerId = bot.id;
  extra.ownerId = bot.id;
  theirs.ownerId = partner.id;
  game.players.forEach(player => { player.properties = []; });
  bot.properties = [mine.index, extra.index];
  partner.properties = [theirs.index];
  partner.cash = 1500;
  bot.cash = 1500;
  const trades = game.getBotCandidates(bot, { expanded: true, parity: true }).filter(candidate => candidate.kind === 'trade' && candidate.toPlayerId === partner.id);
  assert.ok(trades.length > 0, 'an offer for the third opponent\'s completing deed is made');
  for (const trade of trades) assert.equal(trade.toPlayerSeat, 'opponent-3');
  assert.equal(new Set(trades.map(trade => trade.id)).size, trades.length, 'candidate ids are unique');
});

check('tax tiles reach the planner with their bill', () => {
  const { game } = botRoom(1);
  const bot = game.players.find(player => player.isBot);
  const context = buildBotStrategicContext(game, bot, 'pre-roll', 1);
  const taxTile = context.board.find(tile => tile.type === 'tax');
  assert.ok(taxTile, 'the board has a tax tile');
  assert.ok(taxTile.amount > 0, 'the tax amount is visible to the planner');
});

check('the bot unmortgage candidate costs what the rules charge, with no float overshoot', () => {
  const { game } = botRoom(2);
  const bot = game.players.find(player => player.isBot);
  const tile = game.tiles.find(candidate => candidate.price > 0 && candidate.ownerId == null && Math.floor(candidate.price / 2) === 50)
    || game.tiles.find(candidate => candidate.price > 0 && candidate.ownerId == null);
  tile.price = 100;
  tile.ownerId = bot.id;
  tile.mortgaged = true;
  bot.properties = [tile.index];
  bot.cash = 5000;
  game.currentPlayerId = bot.id;
  const candidate = game.botUnmortgageCandidates(bot).find(entry => entry.tileIndex === tile.index);
  assert.ok(candidate, 'the bot can see the unmortgage');
  assert.equal(candidate.cost, unmortgageCostFor(tile.price, game.propertyValueMultiplier()));
  assert.equal(candidate.cost, 55, 'a $100 deed lifts for $55, not $56');
});

const failed = results.filter(ok => !ok).length;
console.log(`bot audit fixes: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
