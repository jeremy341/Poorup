import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoomManager } from './gameLogic.js';
import { SocialStore } from './socialStore.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';
import { createRuntime } from './socketRuntime.js';

const failures = [];
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

check('restoreConnection rejects a second live socket without replacing the live seat', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'original-socket', clientId: 'guest-client', nickname: 'Guest' });
  const second = manager.restoreConnection('guest-client', 'replacement-socket', null);
  assert.equal(second, null);
  assert.equal(manager.getRoomBySocket('original-socket'), room);
  assert.equal(manager.getRoomBySocket('replacement-socket'), null);
  assert.equal(room.game.getPlayerByClient('guest-client').socketId, 'original-socket');
});

check('restoreConnection rejects an anonymous replay against an account-owned live seat', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'account-socket', clientId: 'account-client', nickname: 'Account', accountId: 'acct-1' });
  assert.equal(manager.restoreConnection('account-client', 'attacker-socket'), null);
  assert.equal(room.game.getPlayerByClient('account-client').socketId, 'account-socket');
});

check('canJoin counts retained bot seats against room capacity', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'host', clientId: 'host', nickname: 'Host' });
  assert.equal(room.setRoomSetting('maxPlayers', 2).rejected, false);
  assert.equal(room.setRoomSetting('bots', 1).rejected, false);
  room.ensureBots();
  assert.equal(room.game.players.filter(player => player.isBot).length, 1);
  assert.equal(room.game.canJoin(), false);
});

check('host reassignment candidates never include bots', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'host', clientId: 'host', nickname: 'Host' });
  room.addOrReconnectPlayer({ socketId: 'human', clientId: 'human', nickname: 'Human' });
  room.setRoomSetting('bots', 1);
  room.ensureBots();
  room.game.getPlayerByClient('human').disconnected = true;
  const runtime = createRuntime({
    io: { emit() {}, in() { return { emit() {} }; }, sockets: { sockets: new Map() } },
    roomManager: manager,
    accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {}, seasonStore: {}, cosmeticStore: {}, telemetryStore: {},
    botAdvisor: {}, social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {}, metrics: {}, authoritativeStore: {}, pubsubAdapter: {}
  });
  runtime.reassignHostIfNeeded(room, room.hostId);
  assert.equal(room.game.getPlayerById(room.hostId)?.isBot ?? false, false);
  assert.equal(room.hostId, null);
});

check('expired disconnected seats are pruned before a rematch', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'c', clientId: 'c', nickname: 'C' });
  const expired = room.game.getPlayerByClient('b');
  expired.socketId = null;
  expired.disconnected = true;
  expired.disconnectDeadline = Date.now() - 1;
  assert.equal(room.startGame().success, true);
  assert.equal(room.game.players.some(player => player.clientId === 'b'), false);
  assert.equal(room.game.players.every(player => !player.disconnected), true);
});

check('account registration binds the current lobby seat to the new account', () => {
  const manager = new RoomManager();
  const socket = { id: 'socket-a', data: {}, rooms: new Set(), join() {}, leave() {}, emit() {} };
  const room = manager.createRoom({ socketId: socket.id, clientId: 'client-a', nickname: 'Guest' });
  const handlers = new Map();
  const account = { id: 'acct-new', displayName: 'Registered', color: '#35a653', avatarGrid: null };
  const accountStore = {
    register() { return { success: true, account, sessionToken: 'token' }; },
    sessionTokenHashFor() { return 'hash'; }
  };
  registerAccountSocketHandlers((event, handler) => handlers.set(event, handler), socket, {
    accountStore,
    roomManager: manager,
    social: { accountForSocket() { return null; } },
    emitRoomState() {},
    scheduleRoomsUpdated() {},
    leaveAllGameRooms() {},
    detachSocketFromOtherRoom() {},
    clearDisconnectTimer() {},
    reassignHostIfNeeded() {},
    emitPendingInteractions() {},
    io: { in() { return { emit() {} }; } }
  });
  let response;
  handlers.get('account-register')({}, result => { response = result; });
  assert.equal(response.success, true);
  assert.equal(room.game.getPlayerBySocket(socket.id).accountId, account.id);
});

check('invites bind immutable room identity and prune expired rows on reads', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-social-')), 'social.json');
  const store = new SocialStore(filePath);
  const created = store.createInvite({ roomId: 'room-fixed', roomCode: 'ABC123', roomName: 'Table', visibility: 'private', senderId: 'acct-a', recipientId: 'acct-b' });
  assert.equal(created.success, true);
  assert.equal(created.invite.roomId, 'room-fixed');
  created.invite.expiresAt = new Date(Date.now() - 1).toISOString();
  assert.equal(store.getInvite('acct-b', created.invite.id), null);
  assert.equal(store.invites.some(invite => invite.id === created.invite.id), false);
});

if (failures.length) {
  console.log(`\nsession-room regressions: ${failures.length} failed`);
  process.exit(1);
}
console.log('\nsession-room regressions: all passed');
process.exit(0);
