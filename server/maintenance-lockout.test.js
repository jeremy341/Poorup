// The maintenance lockout at the socket seam: the real runtime, the real
// account/room and in-game handlers, the real drain controller and the real
// operator-cookie module. Only the transport (io, sockets) and the stores are
// stand-ins.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import { createDrainController } from './drainController.js';
import { createMaintenanceAccess } from './maintenanceAccess.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const ADMIN = { id: 'acct-admin', username: 'admin', displayName: 'Keeper', color: '#3a7bd5' };
const sockets = new Map();
const io = {
  emit() {},
  on() {},
  in() { return { emit() {} }; },
  to() { return { emit() {} }; },
  sockets: { sockets },
};
const roomManager = new RoomManager();
const maintenance = createDrainController({
  getActiveRounds: () => [...roomManager.rooms.values()].filter(room => room.game.started).length,
  onChange: () => runtime.broadcastMaintenanceState(),
});
const access = createMaintenanceAccess({ password: 'operator password for tests' });
const runtime = createRuntime({
  io,
  roomManager,
  accountStore: { sessionTokenHashFor: () => null, sessionAccount: () => null },
  socialStore: {},
  matchStore: {},
  achievementStore: {},
  telemetryStore: null,
  botAdvisor: {},
  social: {
    chatLastSent: new Map(),
    patrolRuns: new Map(),
    socketsForAccount: () => [],
    emitSocialUpdate() {},
    // Stand-in for the session lookup: a socket "is" the account the test gave it.
    accountForSocket: socket => socket.data.testAccount || null,
  },
  maintenance,
  maintenanceAccess: access,
  metrics: { setMetric() {}, incrementMetric() {} },
  authoritativeStore: {},
  pubsubAdapter: {},
  setTimeout: () => ({ unref() {} }),
  clearTimeout() {},
  setInterval: () => ({ unref() {} }),
  clearInterval() {},
});
runtime.adminIds = [ADMIN.id];

function connect(id, { account = null, cookie = '' } = {}) {
  const handlers = new Map();
  const socket = {
    id,
    data: { testAccount: account, maintenanceAccess: access.grantFromCookieHeader(cookie) },
    rooms: new Set([id]),
    emitted: [],
    join(room) { this.rooms.add(room); },
    leave(room) { this.rooms.delete(room); },
    emit(event, payload) { this.emitted.push({ event, payload }); },
  };
  const on = (event, handler) => handlers.set(event, handler);
  registerAccountSocketHandlers(on, socket, runtime);
  registerGameSocketHandlers(on, socket, runtime);
  sockets.set(id, socket);
  socket.ask = (event, payload = {}) => {
    let ack;
    handlers.get(event)(payload, value => { ack = value; });
    return ack;
  };
  socket.lastState = () => socket.emitted.filter(entry => entry.event === 'maintenance-state').at(-1)?.payload;
  return socket;
}

function disconnect(socket) {
  sockets.delete(socket.id);
  runtime.handleSocketDisconnect(socket);
}

const create = (socket, clientId, extra = {}) => socket.ask('create-room', { clientId, nickname: clientId.slice(0, 12), visibility: 'private', ...extra });

// Before the lockout: a running round (host + guest) and a waiting lobby.
const host = connect('host');
const guest = connect('guest');
const lobbyHost = connect('lobby-host');
const created = create(host, 'host-client', { roomCode: 'RUN001' });
assert.equal(created.success, true, JSON.stringify(created));
assert.equal(guest.ask('join-room', { roomCode: 'RUN001', clientId: 'guest-client', nickname: 'Guest' }).success, true);
assert.equal(host.ask('start-game').success, true);
assert.equal(create(lobbyHost, 'lobby-client', { roomCode: 'LOB001' }).success, true);
const running = roomManager.getRoom('RUN001');
assert.equal(running.game.started, true);

const { token } = access.issue();
const operator = connect('operator', { cookie: `poorup_operator=${token}` });
const admin = connect('admin', { account: ADMIN });
const visitor = connect('visitor');

maintenance.setLockout(true, { message: 'Back soon' });

check('every socket is told about the lockout with its own bypass flag', () => {
  assert.equal(visitor.lastState().lockout, true);
  assert.equal(visitor.lastState().bypass, false);
  assert.equal(host.lastState().bypass, false);
  assert.equal(operator.lastState().bypass, true, 'a valid operator cookie bypasses');
  assert.equal(admin.lastState().bypass, true, 'an admin account bypasses with no password');
  assert.equal(visitor.lastState().message, 'Back soon');
  const asked = visitor.ask('get-maintenance-state');
  assert.equal(asked.maintenance.lockout, true);
  assert.equal(asked.maintenance.bypass, false);
  assert.equal(operator.ask('get-maintenance-state').maintenance.bypass, true);
});

check('a visitor without a bypass cannot create, join or take an invite seat', () => {
  const refusedCreate = create(visitor, 'visitor-client');
  assert.equal(refusedCreate.success, false);
  assert.equal(refusedCreate.code, 'MAINTENANCE_LOCKOUT');
  assert.equal(refusedCreate.maintenance.bypass, false);
  const refusedJoin = visitor.ask('join-room', { roomCode: 'LOB001', clientId: 'visitor-client', nickname: 'Visitor' });
  assert.equal(refusedJoin.code, 'MAINTENANCE_LOCKOUT');
  const unknown = visitor.ask('join-room', { roomCode: 'NOPE99', clientId: 'visitor-client', nickname: 'Visitor' });
  assert.deepEqual(unknown, refusedJoin, 'a missing room and a real one get the same answer');
  assert.equal(roomManager.getRoom('LOB001').game.players.length, 1);
  const invite = { id: 'invite-1', roomCode: 'LOB001', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const invited = runtime.acceptRoomInvite(visitor, { id: 'acct-visitor', displayName: 'Visitor' }, invite, { inviteId: 'invite-1', clientId: 'visitor-client' });
  assert.equal(invited.code, 'MAINTENANCE_LOCKOUT');
  assert.equal(roomManager.getRoom('LOB001').game.players.length, 1);
  assert.equal(lobbyHost.ask('start-game').code, 'MAINTENANCE_LOCKOUT', 'a waiting lobby cannot start a round');
});

check('seated players keep playing and can reconnect to their seat', () => {
  const current = running.game.getCurrentPlayer();
  const turnSocket = current.socketId === host.id ? host : guest;
  const rolled = turnSocket.ask('roll-dice');
  assert.notEqual(rolled.success, false, JSON.stringify(rolled));
  disconnect(guest);
  const back = connect('guest-again');
  const restored = back.ask('restore-session', { clientId: 'guest-client' });
  assert.equal(restored.success, true, JSON.stringify(restored));
  assert.equal(running.game.getPlayerByClient('guest-client').socketId, 'guest-again');
  disconnect(back);
  const rejoin = connect('guest-third');
  const rejoined = rejoin.ask('join-room', { roomCode: 'RUN001', clientId: 'guest-client', nickname: 'Guest' });
  assert.equal(rejoined.success, true, `join-room back into a held seat: ${JSON.stringify(rejoined)}`);
});

check('a bypassed operator or admin can create, join and start during the lockout', () => {
  assert.equal(create(operator, 'operator-client', { roomCode: 'OPS001' }).success, true);
  const joined = admin.ask('join-room', { roomCode: 'OPS001', clientId: 'admin-client', nickname: 'Keeper' });
  assert.equal(joined.success, true, JSON.stringify(joined));
  assert.equal(operator.ask('start-game').success, true);
  assert.equal(roomManager.getRoom('OPS001').game.started, true);
});

check('a signed-out (revoked) operator cookie stops bypassing on the open socket', () => {
  access.revoke(operator.data.maintenanceAccess);
  assert.equal(runtime.maintenanceBypass(operator), false);
  assert.equal(operator.ask('get-maintenance-state').maintenance.bypass, false);
  assert.equal(create(operator, 'operator-client-2').code, 'MAINTENANCE_LOCKOUT');
});

check('a forged grant object on socket data is not a bypass', () => {
  const forged = connect('forged');
  forged.data.maintenanceAccess = { jti: 'x'.repeat(22), expiresAt: Date.now() + 60_000 };
  assert.equal(runtime.maintenanceBypass(forged), false);
  assert.equal(create(forged, 'forged-client').code, 'MAINTENANCE_LOCKOUT');
});

check('lifting the lockout reopens seats but plain maintenance still pauses rooms for everyone', () => {
  maintenance.setLockout(false);
  assert.equal(visitor.lastState().lockout, false);
  assert.equal(visitor.ask('join-room', { roomCode: 'LOB001', clientId: 'visitor-client', nickname: 'Visitor' }).success, true);
  const adminCreate = create(admin, 'admin-client-2');
  assert.equal(adminCreate.code, 'MAINTENANCE_DRAINING', 'the bypass is a lockout bypass only');
});

check('draining is unchanged: nobody creates or starts, joins still work, no bypass applies', () => {
  maintenance.finishMaintenance();
  maintenance.beginDrain({ releaseId: 'rel-1' });
  const { token: fresh } = access.issue();
  const operatorTwo = connect('operator-two', { cookie: `poorup_operator=${fresh}` });
  for (const socket of [visitor, admin, operatorTwo]) {
    const refused = create(socket, `${socket.id}-drain`);
    assert.equal(refused.code, 'MAINTENANCE_DRAINING', socket.id);
    assert.equal(refused.error, 'New rooms are paused for maintenance.');
  }
  const late = connect('late');
  assert.equal(late.ask('join-room', { roomCode: 'LOB001', clientId: 'late-client', nickname: 'Late' }).success, true);
  assert.equal(lobbyHost.ask('start-game').code, 'MAINTENANCE_DRAINING');
  maintenance.finishMaintenance();
  maintenance.dispose();
});

check('normal mode never resolves an account for the gate', () => {
  let lookups = 0;
  const counting = connect('counting');
  counting.data = new Proxy(counting.data, { get(target, key) { if (key === 'testAccount') lookups += 1; return target[key]; } });
  assert.equal(runtime.canCreateRoom(counting), true);
  assert.equal(runtime.canJoinRoom(counting, undefined, {}), true);
  assert.equal(lookups, 0);
});
