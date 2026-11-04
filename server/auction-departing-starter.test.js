// An auction is opened by the seat whose roll landed on the deed. If that seat leaves, the auction
// is cancelled before the turn advances: nothing is reserved while bidding, so the deed stays unowned
// and the successor rolls normally. A closing auction resolves the turn only for the roll owner that started it.
import assert from 'node:assert/strict';
import nodeCrypto from 'crypto';
import { RoomManager } from './gameLogic.js';

const original = nodeCrypto.randomInt;
const diceQueue = [];
nodeCrypto.randomInt = (min, max) => (min === 1 && max === 7 && diceQueue.length ? diceQueue.shift() : original(min, max));

function trioRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  return { manager, room, game: room.game };
}

// A lands on Rio (tile 3, unowned) with a 2-roll and declines the deed,
// which opens the auction with A as the starting seat.
function openAuctionByRoller(room, game) {
  const a = game.players[0];
  a.position = 0;
  diceQueue.push(1, 2);
  assert.equal(room.rollDice('socket-a').success, true);
  assert.equal(game.declineProperty('socket-a', 3).success, true);
  assert.equal(game.auction?.active, true);
  assert.equal(game.auction.startingPlayerId, a.id);
}

function assertSuccessorCanRoll(room, game, successorSocket) {
  const successor = game.getPlayerBySocket(successorSocket);
  assert.equal(game.currentPlayerId, successor.id, 'the turn passes to the successor');
  assert.equal(game.auction?.active ?? false, false, 'no auction survives into the successor turn');
  assert.equal(game.tiles[3].ownerId, null, 'the cancelled deed stays unowned');
  assert.equal(game.rollTurnRejection(successor), null, 'the successor can roll');
  diceQueue.push(1, 2); // 0 + 3 = Rio, a plain landing for the successor
  assert.equal(room.rollDice(successorSocket).success, true);
}

let passed = 0;

// The roller declares bankruptcy while its auction is open.
{
  const { room, game } = trioRoom();
  openAuctionByRoller(room, game);
  assert.equal(room.declareBankruptcy('socket-a').success, true);
  assert.ok(game.feed.some(entry => entry.text.includes('Rio') && entry.text.includes('cancelled')), 'the cancellation is reported');
  assertSuccessorCanRoll(room, game, 'socket-b');
  passed += 1;
}

// The roller leaves the table (seat removal) while its auction is open.
{
  const { manager, room, game } = trioRoom();
  openAuctionByRoller(room, game);
  assert.equal(manager.removeRoomSeat({ clientId: 'client-a', socketId: 'socket-a', reason: 'leave' }).success, true);
  assertSuccessorCanRoll(room, game, 'socket-b');
  passed += 1;
}

// Control: the roller's own auction closes without bids and resolves the roll as before,
// and the turn then awaits an explicit end.
{
  const { room, game } = trioRoom();
  openAuctionByRoller(room, game);
  game.finishAuction();
  assert.equal(game.auction, null);
  assert.equal(game.awaitingEndTurn, true);
  assert.equal(room.endTurn('socket-a').success, true);
  passed += 1;
}

// A successor that has not rolled owns a passed-purchase auction that closes
// without bids. The close must not resolve a roll it never made.
{
  const { room, game } = trioRoom();
  const b = game.players[1];
  game.currentPlayerId = b.id;
  game.hasRolled = false;
  game.startAuction(game.getTile(3), b.id);
  game.finishAuction();
  assert.equal(game.awaitingEndTurn, false);
  assert.equal(game.rollTurnRejection(b), null);
  b.position = 0;
  diceQueue.push(1, 2);
  assert.equal(room.rollDice('socket-b').success, true);
  passed += 1;
}

// Same guard on a sale: the successor wins the passed-purchase auction and
// can still roll normally afterwards.
{
  const { room, game } = trioRoom();
  const b = game.players[1];
  game.currentPlayerId = b.id;
  game.hasRolled = false;
  game.startAuction(game.getTile(3), b.id);
  assert.equal(game.placeAuctionBid('socket-b', 100).success, true);
  game.finishAuction();
  assert.equal(game.getTile(3).ownerId, b.id);
  assert.equal(game.awaitingEndTurn, false);
  assert.equal(game.rollTurnRejection(b), null);
  b.position = 0;
  diceQueue.push(1, 2);
  assert.equal(room.rollDice('socket-b').success, true);
  passed += 1;
}

nodeCrypto.randomInt = original;
console.log(`auction departing starter: ${passed} passed, 0 failed`);
