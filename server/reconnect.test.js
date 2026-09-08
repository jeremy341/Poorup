// Tab-restart seat recovery: sessionStorage dies with the tab, so a
// reopened tab has a fresh clientId and clientId matching cannot find the
// seat. The account session (localStorage) survives, so a disconnected seat
// owned by the same account is reclaimed. Connected seats never match.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

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

function roomWithAccountSeat() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', accountId: 'acct-1' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  return { manager, room };
}

function disconnectSeat(room, clientId) {
  const player = room.game.getPlayerByClient(clientId);
  player.disconnected = true;
  player.socketId = null;
  return player;
}

check('tab restart reclaims a disconnected account seat under the new clientId', () => {
  const { manager, room } = roomWithAccountSeat();
  disconnectSeat(room, 'client-a');
  let reclaimedClientId = null;
  const restored = manager.restoreConnection('client-a-new', 'socket-a-new', 'acct-1', oldClientId => { reclaimedClientId = oldClientId; });
  assert.equal(restored, room);
  assert.equal(reclaimedClientId, 'client-a');
  const player = room.game.getPlayerByClient('client-a-new');
  assert.ok(player);
  assert.equal(player.disconnected, false);
  assert.equal(player.socketId, 'socket-a-new');
  assert.equal(player.nickname, 'A');
});

check('same-clientId fast reload still restores without account', () => {
  const { manager, room } = roomWithAccountSeat();
  const restored = manager.restoreConnection('client-a', 'socket-a-new');
  assert.equal(restored, room);
  assert.equal(room.game.getPlayerByClient('client-a').socketId, 'socket-a-new');
});

check('a different account cannot reclaim an account seat by clientId', () => {
  const { manager, room } = roomWithAccountSeat();
  const restored = manager.restoreConnection('client-a', 'socket-attacker', 'acct-evil');
  assert.equal(restored, null);
  const player = room.game.getPlayerByClient('client-a');
  assert.equal(player.socketId, 'socket-a');
  assert.equal(player.disconnected, false);
});

check('a disconnected account seat only accepts its owning account', () => {
  const { manager, room } = roomWithAccountSeat();
  disconnectSeat(room, 'client-a');
  assert.equal(manager.restoreConnection('client-a', 'socket-attacker', 'acct-evil'), null);
  assert.equal(room.game.getPlayerByClient('client-a').disconnected, true);
  assert.equal(manager.restoreConnection('client-a-new', 'socket-a-new', 'acct-1'), room);
});

check('a guest seat cannot be rebound to an account through reconnect', () => {
  const { manager, room } = roomWithAccountSeat();
  disconnectSeat(room, 'client-b');
  assert.equal(manager.restoreConnection('client-b', 'socket-guest', 'acct-evil'), null);
  assert.equal(room.game.getPlayerByClient('client-b').disconnected, true);
});

check('joining with a different account cannot rebind an existing client seat', () => {
  const { room } = roomWithAccountSeat();
  const result = room.addOrReconnectPlayer({ socketId: 'socket-attacker', clientId: 'client-a', nickname: 'Intruder', accountId: 'acct-evil' });
  assert.deepEqual(result, { success: false, error: 'That seat is already linked to another account.' });
  assert.equal(room.game.getPlayerByClient('client-a').socketId, 'socket-a');
});

check('an anonymous socket cannot rebind an account seat by clientId', () => {
  const { room } = roomWithAccountSeat();
  const result = room.addOrReconnectPlayer({ socketId: 'socket-anon', clientId: 'client-a', nickname: 'Intruder' });
  assert.deepEqual(result, { success: false, error: 'That seat is already linked to another account.' });
  assert.equal(room.game.getPlayerByClient('client-a').socketId, 'socket-a');
});

check('live seat in another tab is not hijacked via account', () => {
  const { manager } = roomWithAccountSeat();
  const restored = manager.restoreConnection('client-a-new', 'socket-a-new', 'acct-1');
  assert.equal(restored, null);
});

check('guest seats without accounts cannot be reclaimed by fresh ids', () => {
  const { manager, room } = roomWithAccountSeat();
  disconnectSeat(room, 'client-b');
  assert.equal(manager.restoreConnection('client-b-new', 'socket-b-new', null), null);
  assert.equal(manager.restoreConnection('client-b-new', 'socket-b-new'), null);
});

check('unknown account restores nothing', () => {
  const { manager, room } = roomWithAccountSeat();
  disconnectSeat(room, 'client-a');
  assert.equal(manager.restoreConnection('client-x', 'socket-x', 'acct-ghost'), null);
});

const failed = results.filter(r => !r).length;
console.log(`\nreconnect tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
