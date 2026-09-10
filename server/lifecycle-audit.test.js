import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function startedRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  return room;
}

// A disconnected seat inside its reconnect grace must not become a permanent
// ghost or immediately crown the remaining player.
const graceRoom = startedRoom();
const graceGame = graceRoom.game;
const graceCurrent = graceGame.players[0];
const graceDisconnected = graceGame.players[1];
graceGame.currentPlayerId = graceCurrent.id;
graceDisconnected.disconnected = true;
graceDisconnected.disconnectDeadline = Date.now() + 10_000;
graceGame.awaitingEndTurn = true;
graceGame.nextTurn();
assert.equal(graceGame.started, true);
assert.equal(graceGame.lastWinner, null);

// Once the grace has expired, the connected solvent seat is settled as the
// winner instead of looping forever on the disconnected turn-order entry.
graceDisconnected.disconnectDeadline = Date.now() - 1;
graceGame.nextTurn();
assert.equal(graceGame.started, false);
assert.equal(graceGame.lastWinner.id, graceCurrent.id);

// A voluntary non-current leave is final and must close/award a two-player
// game immediately.
const leaveRoom = startedRoom();
const leaveGame = leaveRoom.game;
const leaving = leaveGame.players[1];
const leaveManager = new RoomManager();
// The Room object is owned by the manager created in startedRoom; invoke the
// public manager seam rather than mutating the seat directly.
leaveManager.rooms.set(leaveRoom.roomCode, leaveRoom);
leaveManager.leaveRoomByClient(leaving.clientId, leaving.socketId);
assert.equal(leaveGame.started, false);
assert.equal(leaveGame.lastWinner.id, leaveGame.players[0].id);

console.log('lifecycle audit: 2 passed, 0 failed');
