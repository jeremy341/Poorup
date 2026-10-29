// Wire-level seat identity checks against a real server process. Scenarios: the same clientId in two rooms, an account
// trying another room during reconnect grace, a predictable bot clientId, and a private code reclaimed while both humans are in grace.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const port = 9400 + (process.pid % 90);
const base = `http://127.0.0.1:${port}`;
const GRACE_MS = 1500;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RUN = Date.now().toString(36);

const SEAT_IN_USE = 'That seat is already in use.';
const CODE_HELD_ELSEWHERE = 'That seat is still held by another room. Restore it or wait for it to expire.';
const ACCOUNT_SEATED_ELSEWHERE = 'This account is already seated in another room.';
const NO_SESSION = 'No active session found.';
const CODE_IN_USE = 'That private room code is already in use. Choose another.';
const GAME_STARTED = 'Game is already in progress.';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(child) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/healthz`);
      const body = await response.text();
      if (response.ok && body.includes('"service":"poorup"')) return;
    } catch {
      // server is still starting
    }
    await wait(100);
  }
  throw new Error('seat identity wire server did not start');
}

function open() {
  const socket = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 6_000);
  });
}

function ask(socket, event, payload = {}) {
  return new Promise(resolve => socket.emit(event, payload, resolve));
}

function newCode() {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

function deepFind(value, key, depth = 6) {
  if (!value || typeof value !== 'object' || depth < 0) return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = deepFind(child, key, depth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Seats from the latest room snapshot a socket received.
function latestPlayers(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const players = deepFind(events[index], 'players');
    if (Array.isArray(players)) return players;
  }
  return null;
}

function trackEvents(socket) {
  const events = [];
  socket.on('update-state', payload => events.push(payload));
  return events;
}

// Forces a fresh room broadcast to a host without changing the table.
async function poke(host) {
  await ask(host, 'set-setting', { key: 'botBrain', value: 'no-ai' });
  await wait(200);
}

async function createPrivate(socket, clientId, nickname, roomCode) {
  const ack = await ask(socket, 'create-room', { clientId, nickname, visibility: 'private', roomName: 'SEAT', roomCode });
  assert.equal(ack.success, true, `create-room ${roomCode}: ${JSON.stringify(ack)}`);
  return roomCode;
}

// Tracks every socket a scenario opens so the run can close them, and counts passed checks.
function createSession() {
  const sockets = [];
  const session = { sockets, passed: 0 };
  session.track = async () => {
    const socket = await open();
    sockets.push(socket);
    return socket;
  };
  return session;
}

function startServer(dataDir) {
  return spawn(process.execPath, [path.join(process.cwd(), 'server/server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      POORUP_DATA_DIR: dataDir,
      POORUP_TEST_RECONNECT_GRACE_MS: String(GRACE_MS),
      POORUP_SHUTDOWN_DRAIN_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// The same clientId cannot seat itself in a second room while its
// first seat is live, and a graced seat in room A keeps its own timer.
async function sameClientIdAcrossRooms(session) {
  const hostB = await session.track();
  const roomB = await createPrivate(hostB, `w1-hb-${RUN}`, 'HostB', newCode());
  const hostA = await session.track();
  const roomA = await createPrivate(hostA, `w1-ha-${RUN}`, 'HostA', newCode());
  const eventsA = trackEvents(hostA);
  const G = `w1-G-${RUN}`;
  const s1 = await session.track();
  assert.equal((await ask(s1, 'join-room', { roomCode: roomA, clientId: G, nickname: 'GuestG' })).success, true);
  // Lobby seats never time out on a dropped connection, so start the game first.
  assert.equal((await ask(hostA, 'start-game', {})).success, true, 'room A starts so its graced seat can expire');
  s1.disconnect();
  await wait(150);
  const s2 = await session.track();
  const crossJoin = await ask(s2, 'join-room', { roomCode: roomB, clientId: G, nickname: 'GuestG' });
  assert.deepEqual(crossJoin, { success: false, error: CODE_HELD_ELSEWHERE }, 'a graced clientId cannot join another room');
  session.passed += 1;
  await wait(GRACE_MS + 800);
  await poke(hostA);
  const afterExpiryA = latestPlayers(eventsA);
  assert.ok(afterExpiryA, 'room A reported its seats');
  assert.equal(afterExpiryA.some(player => player.nickname === 'GuestG'), false, 'room A seat expires on its own timer');
  session.passed += 1;
  const retry = await ask(s2, 'join-room', { roomCode: roomB, clientId: G, nickname: 'GuestG' });
  assert.equal(retry.success, true, 'after room A releases the seat the clientId may join room B');
  session.passed += 1;
}

// A predictable bot clientId does not claim a bot seat in a started private game.
async function predictableBotClientIdRefused(session) {
  const hostC = await session.track();
  const roomC = await createPrivate(hostC, `w2-hc-${RUN}`, 'HostC', newCode());
  assert.equal((await ask(hostC, 'set-setting', { key: 'bots', value: 1 })).success, true);
  assert.equal((await ask(hostC, 'set-setting', { key: 'botBrain', value: 'no-ai' })).success, true);
  assert.equal((await ask(hostC, 'start-game', {})).success, true, 'the table starts with its bot');
  const attacker = await session.track();
  assert.deepEqual(
    await ask(attacker, 'join-room', { roomCode: roomC, clientId: `bot-${roomC}-1`, nickname: 'Attacker' }),
    { success: false, error: GAME_STARTED },
    'the legacy bot clientId is an ordinary new guest, refused by the started game',
  );
  session.passed += 1;
}

// A private code is not reclaimed while its humans are in grace.
async function privateCodeNotReclaimedInGrace(session) {
  const hostD = await session.track();
  const roomD = await createPrivate(hostD, `w3-hd-${RUN}`, 'HostD', newCode());
  const guestD = await session.track();
  const hostDClient = `w3-hd-${RUN}`;
  assert.equal((await ask(guestD, 'join-room', { roomCode: roomD, clientId: `w3-gd-${RUN}`, nickname: 'GuestD' })).success, true);
  hostD.disconnect();
  guestD.disconnect();
  await wait(150);
  const third = await session.track();
  assert.deepEqual(
    await ask(third, 'create-room', { clientId: `w3-third-${RUN}`, nickname: 'Third', visibility: 'private', roomName: 'X', roomCode: roomD }),
    { success: false, error: CODE_IN_USE },
    'a code whose humans are in grace is not reclaimed',
  );
  session.passed += 1;
  const restored = await session.track();
  assert.equal((await ask(restored, 'restore-session', { clientId: hostDClient })).success, true, 'the original host restores within grace');
  session.passed += 1;
}

// A graced account cannot join room F; a different account can
// join it, but cannot release the first account's graced room E seat.
async function accountSeatHeldInGrace(session) {
  const accountName = `w4u${RUN}`.slice(0, 16);
  const password = 'scratch-pass-1';
  const hostE = await session.track();
  const roomE = await createPrivate(hostE, `w4-he-${RUN}`, 'HostE', newCode());
  const eventsE = trackEvents(hostE);
  const hostF = await session.track();
  const roomF = await createPrivate(hostF, `w4-hf-${RUN}`, 'HostF', newCode());
  const s3 = await session.track();
  const reg = await ask(s3, 'account-register', { username: accountName, displayName: 'V3User', password });
  assert.equal(reg.success, true, `account-register: ${JSON.stringify(reg)}`);
  const cA = `w4-cA-${RUN}`;
  assert.equal((await ask(s3, 'join-room', { roomCode: roomE, clientId: cA, nickname: 'V3User' })).success, true);
  s3.disconnect();
  await wait(150);
  const s4 = await session.track();
  assert.equal((await ask(s4, 'account-login', { username: accountName, password })).success, true);
  const cB = `w4-cB-${RUN}`;
  assert.deepEqual(
    await ask(s4, 'join-room', { roomCode: roomF, clientId: cB, nickname: 'V3User' }),
    { success: false, error: ACCOUNT_SEATED_ELSEWHERE },
    'a disconnected account seat remains held during reconnect grace',
  );
  await poke(hostE);
  const seatA = latestPlayers(eventsE)?.find(player => player.nickname === 'V3User');
  assert.ok(seatA, 'room E keeps the account seat');
  assert.equal(seatA.disconnected, true, 'the original account seat remains in grace');

  // A different account can be live in room F while the first account's
  // room E seat stays graced; its socket cannot release the other seat.
  const otherAccountName = `w4v${RUN}`.slice(0, 16);
  const s5 = await session.track();
  assert.equal((await ask(s5, 'account-register', { username: otherAccountName, displayName: 'OtherUser', password })).success, true);
  assert.equal((await ask(s5, 'join-room', { roomCode: roomF, clientId: cB, nickname: 'OtherUser' })).success, true);
  const cBEvents = trackEvents(hostF);
  await poke(hostF);
  const seatB = latestPlayers(cBEvents)?.find(player => player.nickname === 'OtherUser');
  assert.ok(seatB, 'room F lists the other account seat');
  assert.equal(seatB.disconnected, false, 'the live seat in room F is not orphaned');
  assert.deepEqual(await ask(s5, 'leave-room', { clientId: cA }), { success: false, error: NO_SESSION });
  await poke(hostF);
  assert.equal(latestPlayers(cBEvents)?.find(player => player.nickname === 'OtherUser')?.disconnected, false);
  session.passed += 1;
  // The original account remains blocked by its graced room E seat, and
  // the clientId in room F remains bound to the other account.
  const s6 = await session.track();
  assert.equal((await ask(s6, 'account-login', { username: accountName, password })).success, true);
  assert.deepEqual(
    await ask(s6, 'join-room', { roomCode: roomF, clientId: `w4-cC-${RUN}`, nickname: 'V3User' }),
    { success: false, error: ACCOUNT_SEATED_ELSEWHERE },
  );
  assert.deepEqual(
    await ask(s6, 'join-room', { roomCode: roomF, clientId: cB, nickname: 'V3User' }),
    { success: false, error: SEAT_IN_USE },
  );
  session.passed += 1;
  // Create-room may not give the account a fresh seat while its first
  // room E seat is still in reconnect grace.
  const dupCode = newCode();
  assert.deepEqual(
    await ask(s6, 'create-room', { clientId: `w4-cD-${RUN}`, nickname: 'V3User', visibility: 'private', roomName: 'DUP', roomCode: dupCode }),
    { success: false, error: ACCOUNT_SEATED_ELSEWHERE },
    'create-room cannot duplicate an account seat',
  );
  session.passed += 1;
}

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-seat-identity-wire-'));
  const child = startServer(dataDir);
  const session = createSession();
  let serverOutput = '';
  child.stdout.on('data', chunk => { serverOutput += chunk; });
  child.stderr.on('data', chunk => { serverOutput += chunk; });
  try {
    await waitForServer(child);
    await sameClientIdAcrossRooms(session);
    await predictableBotClientIdRefused(session);
    await privateCodeNotReclaimedInGrace(session);
    await accountSeatHeldInGrace(session);
    console.log(`seat identity wire checks: ${session.passed} passed, 0 failed`);
  } finally {
    session.sockets.forEach(socket => socket.close());
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
    }
    if (serverOutput && serverOutput.includes('UNCAUGHT')) console.error(serverOutput);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error('seat identity wire checks failed:', error);
  process.exitCode = 1;
});
