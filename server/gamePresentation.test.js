import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { RoomManager } from './gameLogic.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'presentation-a', clientId: 'presentation-a', nickname: 'A' });
room.addOrReconnectPlayer({ socketId: 'presentation-b', clientId: 'presentation-b', nickname: 'B' });
room.startGame();
const game = room.game;
const player = game.players[0];
game.currentPlayerId = player.id;
player.position = 38;
game.presentationClock = () => 10000;
game.players[1].cash = player.cash;
game.getTile(4).ownerId = player.id;
const originalRandom = crypto.randomInt;
try {
  const dice = [3, 3];
  crypto.randomInt = () => dice.shift();
  assert.equal(game.rollDice(player.socketId).success, true);
} finally { crypto.randomInt = originalRandom; }
const record = game.getGameSummary(player.id).presentation;
assert.ok(record, 'a roll must publish its explicit movement rather than only its final destination');
assert.equal(record.actorId, player.id);
assert.deepEqual(record.dice, [3, 3]);
assert.deepEqual(record.segments[0].path, [39, 0, 1, 2, 3, 4]);
assert.equal(record.readyAt, 13240, 'dice reveal, six human steps and landing delay form one server timeline');
assert.equal(record.cashEvents.find(event => event.cause === 'go').deltas[0].amount, 200);
assert.equal(player.cash, 1500, 'salary and the $200 tile-four tax settle authoritatively without waiting for animation');
assert.equal(record.cashEvents.find(event => event.cause === 'landing').deltas[0].amount, -200);
assert.equal(game.getGameSummary(player.id).presentation.id, record.id, 'another snapshot does not create another roll');
const handlers = new Map();
let serverTime = 10000;
registerGameSocketHandlers((event, handler) => handlers.set(event, handler), { id: player.socketId, emit() {} }, {
  getRoomForSocket: () => { game.presentationClock = () => serverTime; return room; }, now: () => serverTime, emitRoomState() {},
  io: { in: () => ({ emit() {} }), to: () => ({ emit() {} }) },
});
let reply;
handlers.get('roll-dice')({}, value => { reply = value; });
assert.equal(reply.success, false, 'rapid doubles rerolls cannot overtake the first movement on the server');
assert.equal(game.diceRollSequence, 1);
assert.equal(handlers.has('auction-pass'), false, 'legacy Pass requests have no mutating handler');
serverTime = record.readyAt;
try {
  const dice = [2, 3];
  crypto.randomInt = () => dice.shift();
  handlers.get('roll-dice')({}, value => { reply = value; });
} finally { crypto.randomInt = originalRandom; }
assert.equal(reply.success, true);
assert.equal(player.position, 9, 'a reroll starts at the previous authoritative landing, not GO');
game.pendingPurchaseOffer = null;
const successfulPresentation = game.presentation;
assert.equal(game.rollDice(player.socketId).success, false);
assert.equal(game.presentation, successfulPresentation, 'a rejected second roll must not create another presentation lock');

game._activePresentation = { actorId: player.id, segments: [], cashEvents: [], cashCheckpoint: new Map(game.players.map(p => [p.id, p.cash])) };
player.position = 7;
game.applyCard(player, { action: 'moveBack', steps: 3 }, {});
assert.deepEqual(game._activePresentation.segments[0].path, [6, 5, 4], 'backwards cards retain their route instead of becoming a forward teleport');
game._activePresentation = null;
console.log('authoritative roll presentation: passed');
