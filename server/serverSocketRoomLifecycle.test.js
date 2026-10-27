// Room-lifecycle socket handlers against the real runtime and RoomManager, with
// fake timers: create-room from a seated socket, moving a live seat between
// rooms, restore-session and set-player-appearance. Scenarios come from the
// o01 / s17 / s10 / s08 audit reports.
import assert from 'node:assert/strict';
import { createRuntime } from './socketRuntime.js';
import { RoomManager } from './gameLogic.js';
import { DeterministicAdvisor } from './botAdvisor.js';
import { registerAccountSocketHandlers, authAttemptKey } from './serverSocketAccount.js';

function makeSocket(id, address = '203.0.113.9') {
  return {
    id,
    rooms: new Set([id]),
    data: {},
    handshake: { address, headers: {} },
    emitted: [],
    join(room) { this.rooms.add(room); },
    leave(room) { this.rooms.delete(room); },
    emit(event, payload) { this.emitted.push([event, payload]); }
  };
}

function harness() {
  const manager = new RoomManager();
  const sockets = new Map();
  const timers = [];
  const runtime = createRuntime({
    io: {
      emit() {}, on() {},
      in() { return { emit() {} }; },
      to(id) { return { emit(event, payload) { sockets.get(id)?.emit(event, payload); } }; },
      sockets: { sockets }
    },
    roomManager: manager,
    accountStore: { sessionTokenHashFor(token) { return token ? `hash:${token}` : null; }, sessionAccount() { return null; }, accountForSessionHash() { return null; } },
    socialStore: {}, matchStore: {}, achievementStore: {}, telemetryStore: null,
    botAdvisor: new DeterministicAdvisor(),
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; }, accountForSocket() { return null; }, emitSocialUpdate() {} },
    maintenance: {}, metrics: { setMetric() {}, incrementMetric() {} }, authoritativeStore: {}, pubsubAdapter: {},
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; },
    clearInterval() {}
  });
  function wire(id, address) {
    const socket = makeSocket(id, address);
    sockets.set(id, socket);
    const handlers = new Map();
    registerAccountSocketHandlers((event, handler) => handlers.set(event, handler), socket, runtime);
    const ask = (event, payload = {}) => { let ack; handlers.get(event)(payload, value => { ack = value; }); return ack; };
    return { socket, ask };
  }
  return { manager, runtime, wire, sockets };
}

// S17-01: a live socket that creates another room with a fresh clientId must
// not leave its previous lobby behind as a live, unreclaimable room.
{
  const h = harness();
  const p = h.wire('life-p');
  for (let index = 0; index < 5; index += 1) {
    const ack = p.ask('create-room', { clientId: `fresh-client-${index}-aaaa`, nickname: `Spam${index}`, visibility: 'public', roomName: `Spam ${index}` });
    assert.equal(ack.success, true);
  }
  assert.equal(h.manager.rooms.size, 1, 'only the newest lobby survives a socket that keeps creating rooms');
  assert.equal(h.manager.listPublicRooms().length, 1);
  assert.equal(h.manager.liveSeatsOnSocket('life-p').length, 1, 'the socket holds exactly one live seat');
  console.log('PASS create-room releases the socket\'s previous lobby');
}

// o01 F3: a live seat in a started room moves to another lobby with the same
// clientId. leave-room and create-room must act on the seat the socket is in.
{
  const h = harness();
  const p = h.wire('move-p');
  const q = h.wire('move-q');
  assert.equal(p.ask('create-room', { clientId: 'client-move-P', nickname: 'Pat', visibility: 'private', roomName: 'A', roomCode: 'MOVA22' }).success, true);
  assert.equal(p.ask('set-setting', { key: 'bots', value: 1 }).success, true);
  assert.equal(p.ask('start-game').success, true);
  assert.equal(q.ask('create-room', { clientId: 'client-move-Q', nickname: 'Quin', visibility: 'private', roomName: 'B', roomCode: 'MOVB22' }).success, true);
  assert.equal(p.ask('join-room', { roomCode: 'MOVB22', clientId: 'client-move-P', nickname: 'Pat' }).success, true);
  const roomA = h.manager.getRoom('MOVA22');
  const roomB = h.manager.getRoom('MOVB22');
  assert.equal(roomA.game.getPlayerByClient('client-move-P').disconnected, true, 'the abandoned game seat is in grace');
  assert.equal(roomB.game.getPlayerByClient('client-move-P').disconnected, false);
  const left = p.ask('leave-room', { clientId: 'client-move-P' });
  assert.equal(left.success, true, 'leave-room acts on the lobby the socket is in');
  assert.equal(roomB.game.getPlayerByClient('client-move-P'), undefined, 'the lobby seat is released');
  assert.ok(roomA.game.getPlayerByClient('client-move-P'), 'the graced game seat is left to its own expiry');
  console.log('PASS leave-room prefers the room the socket is seated in');
}

// s10 S10-14: a restore without a token must not sign the socket out.
{
  const h = harness();
  const first = h.wire('restore-1');
  assert.equal(first.ask('create-room', { clientId: 'client-restore', nickname: 'Rita', visibility: 'private', roomName: 'R', roomCode: 'RESTO1' }).success, true);
  h.runtime.handleSocketDisconnect(first.socket);
  const second = h.wire('restore-2');
  second.socket.data.sessionTokenHash = 'hash:bound-bearer';
  assert.equal(second.ask('restore-session', { clientId: 'client-restore' }).success, true);
  assert.equal(second.socket.data.sessionTokenHash, 'hash:bound-bearer', 'a token-less restore keeps the bearer binding');
  console.log('PASS restore-session without a token keeps the socket\'s bearer binding');
}

// restore-failures feeds the Status tab. A restore that finds a seat it cannot take is a failure;
// an empty fresh-tab restore is not.
{
  const h = harness();
  const counted = [];
  h.runtime.metrics = { setMetric() {}, incrementMetric(name, labels) { counted.push([name, labels]); } };
  const host = h.wire('restore-count-host');
  assert.equal(host.ask('create-room', { clientId: 'client-count', nickname: 'Cora', visibility: 'private', roomName: 'C', roomCode: 'COUNT1' }).success, true);
  const other = h.wire('restore-count-other');
  assert.equal(other.ask('restore-session', {}).success, false);
  assert.deepEqual(counted, [], 'an empty restore has no seat to take and is not a failure');
  assert.equal(other.ask('restore-session', { clientId: 'client-count' }).success, false, 'another live socket cannot take the seat');
  assert.deepEqual(counted, [['restore-failures', { source: 'room-session' }]], 'the refused restore is counted once');
  console.log('PASS restore-session failures are counted for Status');
}

// s08 S08-02: a malformed or omitted face must not wipe the seat's face.
{
  const h = harness();
  const p = h.wire('face-p');
  const face = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => (row === col ? '#112233' : null)));
  assert.equal(p.ask('create-room', { clientId: 'client-face', nickname: 'Faye', visibility: 'private', roomName: 'F', roomCode: 'FACE22' }).success, true);
  assert.equal(p.ask('set-player-appearance', { color: '#d74438', avatarGrid: face }).success, true);
  const seat = h.manager.getRoom('FACE22').game.getPlayerByClient('client-face');
  assert.deepEqual(seat.avatarGrid, face);
  assert.equal(p.ask('set-player-appearance', { color: '#286ea1' }).success, true);
  assert.deepEqual(seat.avatarGrid, face, 'a colour-only request keeps the current face');
  const malformed = p.ask('set-player-appearance', { color: '#286ea1', avatarGrid: face.slice(0, 7) });
  assert.equal(malformed.success, false, 'a malformed grid is rejected, not acknowledged');
  assert.deepEqual(seat.avatarGrid, face, 'a rejected grid leaves the face alone');
  assert.equal(p.ask('set-player-appearance', { avatarGrid: null }).success, true);
  assert.equal(seat.avatarGrid, null, 'an explicit null still clears the face');
  console.log('PASS set-player-appearance validates the face instead of wiping it');
}

// o02 M1 / s10 S10-02: the per-address key is the proxy-aware address, and an
// IPv6 client is bucketed by its /64.
{
  const a = makeSocket('key-a', '2001:db8:aa:bb:1:2:3:4');
  const b = makeSocket('key-b', '2001:db8:aa:bb:ffff::1');
  const c = makeSocket('key-c', '2001:db8:aa:cc::1');
  assert.equal(authAttemptKey(a), authAttemptKey(b), 'one /64 is one client');
  assert.notEqual(authAttemptKey(a), authAttemptKey(c));
  assert.equal(authAttemptKey(makeSocket('key-d', '::ffff:198.51.100.4')), '198.51.100.4');
  console.log('PASS authAttemptKey buckets IPv6 by /64');
}

// s10 S10-17: probing private codes through create-room spends the join-failure budget.
{
  const h = harness();
  const owner = h.wire('code-owner', '198.51.100.20');
  assert.equal(owner.ask('create-room', { clientId: 'client-code-owner', nickname: 'Owner', visibility: 'private', roomName: 'O', roomCode: 'TAKEN1' }).success, true);
  const prober = h.wire('code-prober', '198.51.100.21');
  let refused = 0;
  let throttled = false;
  for (let index = 0; index < 40; index += 1) {
    const ack = prober.ask('create-room', { clientId: `client-prober-${index}-aaaa`, nickname: `Prober${index}`, visibility: 'private', roomName: 'P', roomCode: 'TAKEN1' });
    if (ack.error === 'Too many join attempts. Try again shortly.') { throttled = true; break; }
    assert.equal(ack.success, false);
    refused += 1;
  }
  assert.equal(throttled, true, 'repeated probes of a live code are throttled');
  assert.equal(refused <= 31, true);
  console.log('PASS create-room code probes spend the join-failure budget');
}

console.log('server socket room lifecycle: 6 scenarios passed, 0 failed');
