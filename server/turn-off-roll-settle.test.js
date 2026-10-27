// A parked debt settles the roll only for the seat that landed on it. An
// off-turn debtor (a bank-loan default parked during round processing) or a
// seat that has not rolled yet must not mark the current player's roll as
// resolved: the current player could otherwise end a turn it never rolled.
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
  return room;
}

let passed = 0;

// 1. Off-turn bank default settles while A (current) has not rolled.
{
  const room = trioRoom();
  const game = room.game;
  const [a, , c] = game.players;
  assert.equal(game.currentPlayerId, a.id);
  assert.equal(game.hasRolled, false);
  c.cash = 0;
  game.openDebtSettlement({ player: c, creditor: null, amount: 100, message: 'The bank calls in a defaulted loan.', turnOptions: {}, hooks: {} });
  assert.equal(game.pendingPayment?.playerId, c.id);
  c.cash = 100;
  assert.equal(game.trySettlePendingPayment(), true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.awaitingEndTurn, false, 'an off-turn settlement must not resolve the current roll');
  assert.equal(game.rollTurnRejection(a), null, 'A can still roll');
  assert.deepEqual(room.endTurn('socket-a'), { success: false, error: 'Resolve your roll before ending the turn.' });
  assert.equal(game.currentPlayerId, a.id);
  passed += 1;
}

// 2. Control: the roll owner's own debt settles after landing, and the turn
//    resolves as before (awaiting an explicit end).
{
  const room = trioRoom();
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 0;
  a.position = 0;
  diceQueue.push(1, 3); // 0 + 4 = Earnings Tax
  assert.equal(room.rollDice('socket-a').success, true);
  assert.equal(game.pendingPayment?.playerId, a.id, 'the tax parks a debt for the roller');
  assert.equal(game.awaitingEndTurn, false);
  a.cash = game.pendingPayment.amountRemaining + 50;
  assert.equal(game.trySettlePendingPayment(), true);
  assert.equal(game.awaitingEndTurn, true, 'the roll owner settling its own debt resolves the roll');
  assert.equal(room.endTurn('socket-a').success, true);
  assert.equal(game.currentPlayerId, b.id);
  passed += 1;
}

// 3. The debtor is the current seat but has not rolled yet (a round-processing
//    debt that matured before its owner's turn began). Settling it must not
//    end the roll either.
{
  const room = trioRoom();
  const game = room.game;
  const [, b] = game.players;
  game.currentPlayerId = b.id;
  game.hasRolled = false;
  b.cash = 0;
  game.openDebtSettlement({ player: b, creditor: null, amount: 80, message: 'The bank calls in a defaulted loan.', turnOptions: {}, hooks: {} });
  b.cash = 80;
  assert.equal(game.trySettlePendingPayment(), true);
  assert.equal(game.awaitingEndTurn, false, 'a seat that has not rolled cannot end its turn after a debt settles');
  assert.equal(game.rollTurnRejection(b), null);
  assert.equal(room.endTurn('socket-b').success, false);
  assert.equal(game.currentPlayerId, b.id);
  passed += 1;
}

nodeCrypto.randomInt = original;
console.log(`turn off-roll settle: ${passed} passed, 0 failed`);
