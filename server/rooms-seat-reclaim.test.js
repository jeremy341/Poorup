// Cleanup round: restore picks the seat the user last held, and
// an absent lobby seat does not hold capacity forever.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function dropSeat(manager, player, droppedAt, deadline) {
  manager.socketRoom.delete(player.socketId);
  player.disconnected = true;
  player.socketId = null;
  player.disconnectDeadline = deadline;
  player.disconnectedAt = droppedAt;
}

// One clientId holds a graced seat in started room A (left earlier) and
// a graced seat in lobby B (left later). Restore returns the later one.
{
  const manager = new RoomManager();
  const roomA = manager.createRoom({ socketId: 'a0', clientId: 'ca0', nickname: 'A0' });
  manager.socketRoom.set('a0', roomA);
  roomA.addOrReconnectPlayer({ socketId: 'pa', clientId: 'cp', nickname: 'Pat' });
  manager.socketRoom.set('pa', roomA);
  assert.equal(roomA.startGame().success, true);
  const roomB = manager.createRoom({ socketId: 'b0', clientId: 'cb0', nickname: 'B0' });
  manager.socketRoom.set('b0', roomB);
  roomB.addOrReconnectPlayer({ socketId: 'pb', clientId: 'cp', nickname: 'Pat' });
  manager.socketRoom.set('pb', roomB);
  const now = Date.now();
  dropSeat(manager, roomA.game.getPlayerByClient('cp'), now - 30_000, now + 90_000);
  dropSeat(manager, roomB.game.getPlayerByClient('cp'), now - 1_000, now + 119_000);
  assert.equal(manager.restoreConnection('cp', 'p-new'), roomB, 'restore returns the seat held last, not the oldest room');
  assert.equal(manager.getRoomBySocket('p-new'), roomB);
}

// A socket already mapped to a room holding the clientId restores into
// that room even when another room's seat has the later deadline.
{
  const manager = new RoomManager();
  const roomA = manager.createRoom({ socketId: 'a0', clientId: 'ca0', nickname: 'A0' });
  manager.socketRoom.set('a0', roomA);
  roomA.addOrReconnectPlayer({ socketId: 'pa', clientId: 'cp', nickname: 'Pat' });
  const roomB = manager.createRoom({ socketId: 'b0', clientId: 'cb0', nickname: 'B0' });
  roomB.addOrReconnectPlayer({ socketId: 'pb', clientId: 'cp', nickname: 'Pat' });
  const now = Date.now();
  dropSeat(manager, roomA.game.getPlayerByClient('cp'), now - 30_000, now + 90_000);
  dropSeat(manager, roomB.game.getPlayerByClient('cp'), now - 1_000, now + 119_000);
  manager.socketRoom.set('p-new', roomA);
  assert.equal(manager.restoreConnection('cp', 'p-new'), roomA, 'the room the socket maps to wins');
}

function lobbyWithGhost(droppedAgoMs) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'h', clientId: 'hc', nickname: 'Host' });
  manager.socketRoom.set('h', room);
  room.setRoomSetting('maxPlayers', 2);
  room.addOrReconnectPlayer({ socketId: 'g', clientId: 'gc', nickname: 'Guest' });
  const now = Date.now();
  // A lobby seat's deadline restarts for ever, so only disconnectedAt tells.
  dropSeat(manager, room.game.getPlayerByClient('gc'), now - droppedAgoMs, now + 60_000);
  return { manager, room };
}

// A lobby seat absent longer than the grace window is reclaimed.
{
  const { room } = lobbyWithGhost(121_000);
  const joined = room.addOrReconnectPlayer({ socketId: 'n', clientId: 'nc', nickname: 'Newcomer' });
  assert.equal(joined.success, true, 'an absent lobby seat does not hold capacity forever');
  assert.equal(room.game.getPlayerByClient('gc'), undefined, 'the ghost seat is released');
  assert.equal(room.game.getPlayerByClient('nc')?.nickname, 'Newcomer');
}

// control: inside the window the seat still holds capacity.
{
  const { room } = lobbyWithGhost(60_000);
  const joined = room.addOrReconnectPlayer({ socketId: 'n', clientId: 'nc', nickname: 'Newcomer' });
  assert.equal(joined.success, false);
  assert.equal(joined.error, 'Room is full.');
  assert.ok(room.game.getPlayerByClient('gc'), 'a seat inside the grace window is kept');
}

// control: a seat with no recorded drop time (disconnectedAt 0) is never reclaimed.
{
  const { room } = lobbyWithGhost(0);
  room.game.getPlayerByClient('gc').disconnectedAt = 0;
  assert.equal(room.addOrReconnectPlayer({ socketId: 'n', clientId: 'nc', nickname: 'Newcomer' }).success, false);
}

// The account-seat reclaim must not take the oldest disconnected seat. It returns to the seat the account dropped last, ordered by the
// actual first drop: a lobby seat's grace restarts forever, so its deadline cannot tell a fresh drop from a ghost.
{
  const manager = new RoomManager();
  const roomA = manager.createRoom({ socketId: 'qa0', clientId: 'qa0c', nickname: 'A0' });
  manager.socketRoom.set('qa0', roomA);
  const roomB = manager.createRoom({ socketId: 'qb0', clientId: 'qb0c', nickname: 'B0' });
  manager.socketRoom.set('qb0', roomB);
  roomA.addOrReconnectPlayer({ socketId: 'qa1', clientId: 'qa-old', nickname: 'Pat', accountId: 'acct-Q' });
  roomB.addOrReconnectPlayer({ socketId: 'qb1', clientId: 'qb-new', nickname: 'Pat', accountId: 'acct-Q' });
  const now = Date.now();
  dropSeat(manager, roomA.game.getPlayerByClient('qa-old'), now - 60_000, now + 60_000);
  dropSeat(manager, roomB.game.getPlayerByClient('qb-new'), now - 1_000, now + 119_000);
  const reclaimed = manager.restoreConnection('qa-fresh', 'qa-fresh-sock', 'acct-Q');
  assert.equal(reclaimed?.roomCode, roomB.roomCode, 'the account reclaim returns the seat it dropped last');
  assert.equal(roomB.game.getPlayerByClient('qa-fresh')?.accountId, 'acct-Q', 'the seat is reclaimed under the fresh client id');
}

console.log('rooms seat reclaim: 5 scenarios passed');
