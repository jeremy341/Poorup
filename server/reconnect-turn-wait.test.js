// A turn ending while the only other seat is inside its reconnect grace must not leave the clock on the seat that just finished:
// it had already rolled, the returning seat was "not on turn", and nothing re-advanced the clock, so the table wedged for good.
// With a bot at the table, the bot also re-decided every 300 ms (an AI provider call each) until the room was destroyed.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { selectBotTurnTarget } from './botLogic.js';

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

function twoHumans() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sA', clientId: 'cA', nickname: 'A', roomCode: 'WAITA' });
  room.addOrReconnectPlayer({ socketId: 'sB', clientId: 'cB', nickname: 'B' });
  manager.socketRoom.set('sB', room);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [A, B] = game.players;
  return { manager, room, game, A, B };
}

function finishTurn(game, player) {
  game.currentPlayerId = player.id;
  game.hasRolled = true;
  game.awaitingEndTurn = true;
  game.pendingPurchaseOffer = null;
  game.auction = null;
}

function dropInGrace(player) {
  player.disconnected = true;
  player.socketId = null;
  player.disconnectDeadline = Date.now() + 120_000;
}

check('the returning seat holds the clock with a fresh turn and can roll', () => {
  const { manager, game, A, B } = twoHumans();
  finishTurn(game, A);
  dropInGrace(B);
  assert.equal(game.endTurn('sA').success, true);
  assert.equal(game.currentPlayerId, B.id, 'the clock rests on the seat the table is waiting for');
  assert.equal(game.hasRolled, false);
  assert.equal(game.awaitingEndTurn, false);
  assert.match(game.feed[0].text, /Waiting for B to reconnect/);
  assert.ok(manager.restoreConnection('cB', 'sB2', null), 'B reconnects inside the grace window');
  assert.equal(game.rollDice('sB2').success, true, 'B can act immediately');
  assert.equal(game.endTurn('sA').success, false, 'and A is not on turn');
});

check('moving the clock past the end of the order still completes the round', () => {
  const { game, A, B } = twoHumans();
  finishTurn(game, B);
  dropInGrace(A);
  const roundBefore = game.roundNumber;
  assert.equal(game.endTurn('sB').success, true);
  assert.equal(game.currentPlayerId, A.id);
  assert.equal(game.roundNumber, roundBefore + 1, 'B was last in turn order, so waiting on A starts a new round');
});

check('waiting on a later seat does not advance the round', () => {
  const { game, A, B } = twoHumans();
  finishTurn(game, A);
  dropInGrace(B);
  const roundBefore = game.roundNumber;
  assert.equal(game.endTurn('sA').success, true);
  assert.equal(game.roundNumber, roundBefore);
});

check('a bot never spins on a finished turn while the human is away', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sH', clientId: 'cH', nickname: 'Human', roomCode: 'WAITB' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const human = game.players.find(player => !player.isBot);
  const bot = game.players.find(player => player.isBot);
  finishTurn(game, bot);
  dropInGrace(human);
  const result = room.runBotAction(bot.id, actor => room.endTurn(actor));
  assert.equal(result.success, true);
  assert.equal(game.currentPlayerId, human.id);
  assert.equal(selectBotTurnTarget(game)?.id, human.id, 'the bot timer has nothing to decide, so no provider call is made');
});

check('once the grace window has expired the turn passes on as before', () => {
  const { game, A, B } = twoHumans();
  finishTurn(game, A);
  B.disconnected = true;
  B.socketId = null;
  B.disconnectDeadline = Date.now() - 1;
  assert.equal(game.endTurn('sA').success, true);
  assert.equal(game.started, false, 'with nobody left to wait for, the lone connected seat wins');
  assert.equal(game.lastWinner?.id, A.id);
});

const failed = results.filter(ok => !ok).length;
console.log(`reconnect turn wait: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
