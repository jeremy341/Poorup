// Round limit. Some tables never produced a winner: the catch-up bonus kept a poor seat solvent, so endGame never ran.
// A table running past ROUND_LIMIT ends through endGame, with the richest solvent seat as the winner.
// Warnings go to the feed at ROUND_LIMIT - 50 and ROUND_LIMIT - 10.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { ROUND_LIMIT } from './gameData.js';
import { netWorth } from './botTableBrain.js';

const MARINA_BAY = 39; // Dark Blue, price 400, house cost 200
const LIMIT_TEXT = 'Round limit reached - the richest player wins.';
const WARNING_TEXT = `The game ends after round ${ROUND_LIMIT}; richest player wins.`;

function startedTable(seats) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  for (let index = 1; index < seats; index += 1) {
    const letter = String.fromCharCode(97 + index);
    room.addOrReconnectPlayer({ socketId: `socket-${letter}`, clientId: `client-${letter}`, nickname: letter.toUpperCase() });
  }
  assert.equal(room.startGame().success, true);
  return room;
}

function own(game, player, index) {
  game.tiles[index].ownerId = player.id;
  player.properties.push(index);
}

function recordFeed(game) {
  const messages = [];
  const original = game.feedMessage.bind(game);
  game.feedMessage = text => {
    messages.push(text);
    original(text);
  };
  return messages;
}

// Passing the limit ends the table through endGame, not a bespoke path.
{
  const game = startedTable(2).game;
  game.roundNumber = ROUND_LIMIT - 1;
  game.advanceRound();
  assert.equal(game.roundNumber, ROUND_LIMIT);
  assert.equal(game.started, true, 'reaching the limit itself does not end the table');
  game.advanceRound();
  assert.equal(game.started, false, 'passing the limit ends the table');
  assert.equal(game.lastEndReason, 'round-limit');
  assert.ok(game.lastWinner, 'a solvent seat is crowned');
  assert.equal(game.feed[0].text, LIMIT_TEXT);
  assert.equal(game.getGameSummary().lastEndReason, 'round-limit', 'the summary carries the reason');
}

// Richest by net worth, with buildings counted. Cash alone favours A, so the
// win for B depends on the $300 of houses it owns on Marina Bay.
{
  const game = startedTable(3).game;
  const [a, b, c] = game.players;
  a.cash = 1500;
  b.cash = 1000;
  c.cash = 100;
  own(game, b, MARINA_BAY);
  game.tiles[MARINA_BAY].houseCount = 3;
  assert.ok(a.cash > b.cash, 'cash alone would crown A');
  assert.ok(netWorth(game, b) > netWorth(game, a), 'houses make B the richest');
  game.roundNumber = ROUND_LIMIT;
  game.advanceRound();
  assert.equal(game.started, false);
  assert.equal(game.lastWinner.id, b.id);
  assert.equal(game.lastEndReason, 'round-limit');
  const ended = JSON.parse(JSON.stringify(game.getGameSummary()));
  assert.equal(ended.finalPlacements[b.id], 1, 'the server placement remains authoritative');
  assert.ok(ended.players.find(player => player.id === b.id).finalNetWorth
    > ended.players.find(player => player.id === a.id).finalNetWorth,
  'the published result score uses the same net-worth basis that selected the winner');
  assert.equal(ended.players.every(player => Number.isFinite(player.finalNetWorth)), true);
}

// Equal net worth goes to the seat earlier in turn order.
{
  const game = startedTable(3).game;
  game.players.forEach(player => { player.cash = 1500; });
  game.roundNumber = ROUND_LIMIT;
  game.advanceRound();
  assert.equal(game.lastWinner.id, game.turnOrder[0], 'the earliest seat wins a tie');
}

// The limit needs at least two solvent seats; a lone solvent seat does not
// end the table through this rule.
{
  const game = startedTable(2).game;
  game.players[1].bankrupt = true;
  game.roundNumber = ROUND_LIMIT;
  game.advanceRound();
  assert.equal(game.started, true);
  assert.equal(game.lastEndReason, null);
}

// A negative-worth seat must not tie with a zero seat at the clamped display
// value: ranking uses the unclamped breakdown total.
{
  const game = startedTable(3).game;
  const [a, b, c] = game.players;
  game.turnOrder = [a.id, b.id, c.id];
  game.players.forEach(player => { player.cash = 0; });
  a.bankLoan = { status: 'active', remaining: 500 };
  game.roundNumber = ROUND_LIMIT;
  game.advanceRound();
  assert.equal(game.started, false);
  assert.equal(game.lastWinner.id, b.id, 'a negative seat must not win on the clamped zero worth');
}

// Warnings at ROUND_LIMIT - 50 and ROUND_LIMIT - 10, once each.
{
  const game = startedTable(2).game;
  const messages = recordFeed(game);
  const warnings = () => messages.filter(text => text === WARNING_TEXT).length;
  game.roundNumber = ROUND_LIMIT - 51;
  game.advanceRound();
  assert.equal(game.roundNumber, ROUND_LIMIT - 50);
  assert.equal(warnings(), 1, 'warns at the first threshold');
  while (game.roundNumber < ROUND_LIMIT - 10) game.advanceRound();
  assert.equal(game.roundNumber, ROUND_LIMIT - 10);
  assert.equal(warnings(), 2, 'warns again at the second threshold');
  game.advanceRound();
  assert.equal(warnings(), 2, 'no repeat warning on the following round');
}

// An ordinary finish carries no round-limit reason.
{
  const game = startedTable(2).game;
  game.endGame();
  assert.equal(game.lastEndReason, null);
  assert.equal(game.feed[0].text, `${game.lastWinner.nickname} is the last player remaining and wins the game!`);
  assert.ok(!game.feed.some(entry => entry.text === LIMIT_TEXT));
}

console.log('round limit: ROUND_LIMIT ends, richest-solvent winner, tiebreak, warnings pinned');
