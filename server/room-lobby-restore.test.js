// Lobby persistence across restarts (roomStore.js + Room#toLobbySnapshot / RoomManager#restoreLobby). Only unstarted lobbies are persisted;
// started matches are not plain JSON and end with the process. Uses a throwaway data directory and a mocked clock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoomManager } from './gameLogic.js';
import { createJsonAuthoritativeStore } from './authoritativeStore.js';
import { LOBBY_HEARTBEAT_MS, LOBBY_SNAPSHOT_MAX_AGE_MS, createRoomPersistence } from './roomStore.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-room-restore-'));
const file = path.join(directory, 'rooms.json');
const silent = { error() {} };
let clock = 1_800_000_000_000;
const now = () => clock;

function boot() {
  const manager = new RoomManager();
  const store = createJsonAuthoritativeStore(file);
  const persistence = createRoomPersistence({ store, roomManager: manager, now, log: silent });
  return { manager, store, persistence, summary: persistence.restore() };
}

function seatedLobby(manager) {
  const room = manager.createRoom({ socketId: 'sock-host', clientId: 'c-host', nickname: 'Host', accountId: 'acct-host', roomName: 'RESTART TABLE', visibility: 'private' });
  assert.equal(room.addOrReconnectPlayer({ socketId: 'sock-guest', clientId: 'c-guest', nickname: 'Guest' }).success, true);
  assert.equal(room.addOrReconnectPlayer({ socketId: 'sock-acct', clientId: 'c-acct', nickname: 'Acct', accountId: 'acct-2' }).success, true);
  assert.equal(room.setRoomSetting('maxPlayers', 5).rejected, false);
  assert.equal(room.setRoomSetting('bots', 1).rejected, false);
  assert.equal(room.setRoomSetting('startingCash', 2500).rejected, false);
  manager.blockSeatRejoin(room, room.game.getPlayerByClient('c-guest'));
  room.game.removePlayerByClient('c-guest');
  return room;
}

// First run: no snapshot file boots clean and writes nothing for an empty registry.
{
  const first = boot();
  assert.deepEqual(first.summary, { restored: 0, pruned: 0, skipped: 0 });
  first.persistence.flush();
  assert.equal(fs.existsSync(file), false);
}

// Round trip: identity, settings, roster, host, kick lists survive; sockets and presence do not.
{
  const before = boot();
  const original = seatedLobby(before.manager);
  const originalSettings = JSON.parse(JSON.stringify(original.settings));
  before.persistence.flush();
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('socketId'), false, 'no socket id may be persisted');
  assert.equal(raw.includes('sock-host'), false);
  assert.equal(raw.includes('botSeatSecret'), false);

  clock += 5_000; // restart five seconds later
  const after = boot();
  assert.deepEqual(after.summary, { restored: 1, pruned: 0, skipped: 0 });
  const room = after.manager.getRoom(original.roomCode);
  assert.ok(room, 'room restored under its code');
  assert.equal(room.publicId, original.publicId);
  assert.equal(room.roomName, 'RESTART TABLE');
  assert.equal(room.visibility, 'private');
  assert.equal(room.game.started, false);
  assert.deepEqual(JSON.parse(JSON.stringify(room.settings)), originalSettings);
  assert.equal(room.game.settings.startingCash, 2500);
  assert.equal(room.hostId, original.hostId);
  const humans = room.game.players.filter(player => !player.isBot);
  const identity = player => [player.id, player.clientId, player.nickname, player.accountId, player.color];
  assert.deepEqual(humans.map(identity), original.game.players.filter(player => !player.isBot).map(identity));
  assert.equal(room.game.players.filter(player => player.isBot).length, 1, 'bots are re-derived from settings');
  humans.forEach(player => {
    assert.equal(player.socketId, null);
    assert.equal(player.disconnected, true);
    assert.ok(player.disconnectedAt > 0 && player.disconnectDeadline > player.disconnectedAt);
  });
  assert.deepEqual([...room.kickedClientIds], ['c-guest']);
  assert.equal(room.hasConnectedHumans(), false);
  assert.deepEqual(after.manager.listPublicRooms(), [], 'an unclaimed restored lobby is not advertised');

  // Reconnect through the normal restore path with fresh sockets.
  assert.equal(after.manager.restoreConnection('c-host', 'new-sock-1', 'acct-host'), room);
  assert.equal(room.game.getPlayerByClient('c-host').socketId, 'new-sock-1');
  assert.equal(room.game.getPlayerByClient('c-host').disconnected, false);
  assert.equal(room.hostId, original.hostId, 'the returning host keeps the host seat');
  assert.equal(after.manager.restoreConnection('c-acct', 'new-sock-2', 'acct-other'), null, 'another account cannot take an account seat');
  assert.equal(after.manager.restoreConnection('c-acct', 'new-sock-3', 'acct-2'), room);
  assert.equal(room.addOrReconnectPlayer({ socketId: 'new-sock-4', clientId: 'c-guest', nickname: 'Guest' }).success, false, 'a kick survives the restart');
}

// Started matches are never persisted, and starting a persisted lobby removes its row.
{
  fs.rmSync(file, { force: true });
  const { manager, store, persistence } = boot();
  const room = manager.createRoom({ socketId: 'a', clientId: 'ca', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'cb', nickname: 'Ben' });
  persistence.flush();
  assert.equal(store.listRooms().length, 1);
  assert.equal(room.startGame().success, true);
  persistence.flush();
  assert.equal(store.listRooms().length, 0, 'a started game is not a lobby');
  const restarted = boot();
  assert.deepEqual(restarted.summary, { restored: 0, pruned: 0, skipped: 0 });
  assert.equal(restarted.manager.rooms.size, 0);
}

// A finished match's room is not a lobby either, and a removed or destroyed room drops out of the file.
{
  fs.rmSync(file, { force: true });
  const { manager, store, persistence } = boot();
  const kept = manager.createRoom({ socketId: 'k', clientId: 'ck', nickname: 'Kate' });
  const gone = manager.createRoom({ socketId: 'g', clientId: 'cg', nickname: 'Gus' });
  const finished = manager.createRoom({ socketId: 'f', clientId: 'cf', nickname: 'Fay' });
  finished.matchFinished = true;
  persistence.flush();
  assert.deepEqual(store.listRooms().map(row => row.roomId).sort(), [kept.roomCode, gone.roomCode].sort());
  manager.rooms.delete(gone.roomCode);
  persistence.flush();
  assert.deepEqual(store.listRooms().map(row => row.roomId), [kept.roomCode]);
  // Seat changes rewrite the row (an erased account's seat leaves the file on the next sweep).
  kept.addOrReconnectPlayer({ socketId: 'x', clientId: 'cx', nickname: 'Xan', accountId: 'acct-erased' });
  persistence.flush();
  assert.ok(JSON.stringify(store.readRoom(kept.roomCode).snapshot).includes('acct-erased'));
  kept.game.removePlayerByClient('cx');
  persistence.flush();
  assert.equal(JSON.stringify(store.readRoom(kept.roomCode).snapshot).includes('acct-erased'), false);
  assert.equal(fs.readFileSync(file, 'utf8').includes('acct-erased'), false);
}

// Mocked clock: stale rows are pruned at boot; occupied lobbies are re-stamped, abandoned ones are not.
{
  fs.rmSync(file, { force: true });
  const before = boot();
  const occupied = before.manager.createRoom({ socketId: 'o', clientId: 'co', nickname: 'Oli' });
  const abandoned = before.manager.createRoom({ socketId: 'p', clientId: 'cp', nickname: 'Pia' });
  abandoned.game.getPlayerByClient('cp').disconnected = true;
  before.persistence.flush();
  const firstStamp = before.store.readRoom(occupied.roomCode).snapshot.updatedAt;
  clock += LOBBY_HEARTBEAT_MS - 1;
  before.persistence.flush();
  assert.equal(before.store.readRoom(occupied.roomCode).snapshot.updatedAt, firstStamp, 'no rewrite before the heartbeat');
  clock += 2;
  before.persistence.flush();
  assert.ok(before.store.readRoom(occupied.roomCode).snapshot.updatedAt > firstStamp, 'an occupied lobby is re-stamped');
  assert.equal(before.store.readRoom(abandoned.roomCode).snapshot.updatedAt, firstStamp, 'an abandoned lobby keeps its old stamp');
  clock += LOBBY_SNAPSHOT_MAX_AGE_MS - LOBBY_HEARTBEAT_MS + 10_000;
  const after = boot();
  assert.equal(after.summary.restored, 1);
  assert.equal(after.summary.pruned, 1);
  assert.ok(after.manager.getRoom(occupied.roomCode));
  assert.equal(after.manager.getRoom(abandoned.roomCode), null);
  assert.equal(after.store.listRooms().length, 1, 'the stale row was deleted from the file');
}

// A malformed row and a code collision are skipped; a live room is never overwritten.
{
  fs.rmSync(file, { force: true });
  const source = boot();
  const good = source.manager.createRoom({ socketId: 'a', clientId: 'ca', nickname: 'Ada' });
  const bad = source.manager.createRoom({ socketId: 'b', clientId: 'cb', nickname: 'Ben' });
  source.persistence.flush();
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  rows[bad.roomCode].snapshot.players = 'nope';
  rows.ZZZZZZ = { version: 1, snapshot: { schema: 1, kind: 'lobby', roomCode: 'ZZZZZZ', publicId: 'room_not-valid', settings: {}, players: [], updatedAt: clock } };
  fs.writeFileSync(file, JSON.stringify(rows));
  const manager = new RoomManager();
  manager.createRoom({ socketId: 'live', clientId: 'live-client', nickname: 'Live', roomCode: good.roomCode });
  const store = createJsonAuthoritativeStore(file);
  const summary = createRoomPersistence({ store, roomManager: manager, now, log: silent }).restore();
  assert.equal(summary.restored, 0);
  assert.equal(summary.skipped, 3, 'collision, malformed players and malformed row are all skipped');
  assert.equal(manager.getRoom(good.roomCode).game.players[0].clientId, 'live-client', 'a live room is never overwritten');
}

// A corrupt snapshot file is quarantined and boot continues with no rooms.
{
  fs.writeFileSync(file, '{ not json');
  const corrupt = boot();
  assert.deepEqual(corrupt.summary, { restored: 0, pruned: 0, skipped: 0 });
  assert.ok(fs.readdirSync(directory).some(name => name.startsWith('rooms.json.corrupt')), 'corrupt bytes were quarantined, not deleted');
  const room = corrupt.manager.createRoom({ socketId: 'a', clientId: 'ca', nickname: 'Ada' });
  corrupt.persistence.flush();
  assert.equal(corrupt.store.listRooms().length, 1);
  assert.ok(room);
}

fs.rmSync(directory, { recursive: true, force: true });
console.log('room lobby restore: all scenarios passed');
