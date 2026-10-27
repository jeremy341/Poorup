// The consecutive-doubles streak belongs to the seated roller. A turn that
// ends on doubles without an extra roll (Go to Prison, Vacation, a jail card,
// a disconnect skip) must not hand its count to the next seat, which would
// jail that seat one roll early.
import assert from 'node:assert/strict';
import nodeCrypto from 'crypto';
import { RoomManager } from './gameLogic.js';

const original = nodeCrypto.randomInt;
const diceQueue = [];
nodeCrypto.randomInt = (min, max) => (min === 1 && max === 7 && diceQueue.length ? diceQueue.shift() : original(min, max));

function fixture(playerCount = 2) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  if (playerCount > 2) room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  return room;
}

// B's landings are kept plain: Accra (6) is B's own deed and tile 10 is a jail visit.
function primeSuccessorDoubles(room, successor) {
  room.game.getTile(6).ownerId = successor.id;
  successor.position = 2;
}

let passed = 0;

// 1. A doubles onto Go to Prison (tile 30) and ends the turn. B must start at
//    zero, so B's third doubles (not second) sends B to jail.
{
  const room = fixture();
  const game = room.game;
  const [a, b] = game.players;
  a.position = 24;
  diceQueue.push(3, 3); // 24 + 6 = 30 -> Go to Prison
  assert.equal(room.rollDice('socket-a').success, true);
  assert.equal(a.position, 10, 'Go to Prison parks the roller in jail');
  assert.equal(game.awaitingEndTurn, true);
  assert.equal(room.endTurn('socket-a').success, true);
  assert.equal(game.currentPlayerId, b.id);
  assert.equal(game.consecutiveDoubles, 0, 'the successor starts its own doubles streak');

  primeSuccessorDoubles(room, b);
  diceQueue.push(2, 2); // 2 + 4 = 6, B's own deed
  assert.equal(room.rollDice('socket-b').success, true);
  assert.equal(game.consecutiveDoubles, 1);
  assert.equal(game.extraRollPending, true);

  diceQueue.push(2, 2); // 6 + 4 = 10, jail visit with doubles pending
  assert.equal(room.rollDice('socket-b').success, true);
  assert.equal(b.inJail, false, 'second doubles of B must not jail B');
  assert.equal(game.consecutiveDoubles, 2);
  assert.equal(game.extraRollPending, true);

  diceQueue.push(3, 3); // third doubles of B
  assert.equal(room.rollDice('socket-b').success, true);
  assert.equal(b.inJail, true, 'third doubles of B jails B');
  assert.equal(game.consecutiveDoubles, 0);
  assert.equal(game.currentPlayerId, a.id);
  passed += 1;
}

// 2. Same carry-over when a go-to-jail card ends the doubles turn: the card
//    path resolves the turn without an extra roll.
{
  const room = fixture();
  const game = room.game;
  const [a, b] = game.players;
  a.position = 4;
  diceQueue.push(3, 3); // 4 + 6 = 10, jail visit with doubles pending
  assert.equal(room.rollDice('socket-a').success, true);
  assert.equal(game.consecutiveDoubles, 1, 'the roller keeps its own streak until the turn passes');
  game.applyCard(a, { action: 'goToJail', text: 'Go directly to Prison' }, {});
  assert.equal(a.inJail, true);
  assert.equal(room.endTurn('socket-a').success, true);
  assert.equal(game.currentPlayerId, b.id);
  assert.equal(game.consecutiveDoubles, 0);
  passed += 1;
}

// 3. Control: doubles that keep the turn (extra roll) and then a non-double
//    on a plain tile must leave the count at zero for the successor.
{
  const room = fixture();
  const game = room.game;
  const [a, b] = game.players;
  a.position = 4;
  diceQueue.push(3, 3); // 4 + 6 = 10, jail visit with doubles pending
  assert.equal(room.rollDice('socket-a').success, true);
  assert.equal(game.consecutiveDoubles, 1);
  assert.equal(game.extraRollPending, true);
  game.getTile(13).ownerId = a.id; // Chiang Mai, A's own deed -> plain landing
  diceQueue.push(1, 2); // 10 + 3 = 13
  assert.equal(room.rollDice('socket-a').success, true);
  assert.equal(game.consecutiveDoubles, 0);
  assert.equal(room.endTurn('socket-a').success, true);
  assert.equal(game.currentPlayerId, b.id);
  assert.equal(game.consecutiveDoubles, 0);
  passed += 1;
}

// 4. Disconnect skip: the roller disconnects with an extra roll pending; the
//    skip hands the turn on and the successor must start at zero.
{
  const room = fixture(3);
  const game = room.game;
  const [a, b] = game.players;
  a.position = 4;
  diceQueue.push(3, 3); // lands on Jail visit with doubles pending
  assert.equal(room.rollDice('socket-a').success, true);
  assert.equal(game.consecutiveDoubles, 1);
  a.disconnected = true;
  game.skipDisconnectedCurrentPlayer();
  assert.equal(game.currentPlayerId, b.id);
  assert.equal(game.consecutiveDoubles, 0, 'a disconnect skip does not carry the streak');

  primeSuccessorDoubles(room, b);
  diceQueue.push(2, 2);
  assert.equal(room.rollDice('socket-b').success, true);
  diceQueue.push(2, 2);
  assert.equal(room.rollDice('socket-b').success, true);
  assert.equal(b.inJail, false, 'B is not jailed on its second doubles after a skip');
  passed += 1;
}

nodeCrypto.randomInt = original;
console.log(`turn doubles carry: ${passed} passed, 0 failed`);
