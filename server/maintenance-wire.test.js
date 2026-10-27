import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const port = 8500 + (process.pid % 200);
const base = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(child, targetBase = base) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${targetBase}/healthz`);
      const body = await response.text();
      if (response.ok && body.includes('"service":"poorup"')) return;
    } catch {
      // server is still starting
    }
    await wait(100);
  }
  throw new Error('maintenance test server did not start');
}

function ask(socket, event, payload) {
  return new Promise(resolve => socket.emit(event, payload, resolve));
}

function connect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 6_000);
  });
}

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-maintenance-wire-'));
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server/server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      POORUP_DATA_DIR: dataDir,
      POORUP_MAINTENANCE_MODE: 'draining',
      POORUP_MAINTENANCE_TOKEN: 'maintenance-test-token',
      POORUP_MAINTENANCE_PASSWORD: 'wire-operator-password',
      POORUP_RELEASE_ID: 'maintenance-test-release',
      POORUP_SHUTDOWN_DRAIN_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let socket;
  let visitor;
  let operator;
  let joiner;
  let serverOutput = '';
  let passed = 0;
  child.stdout.on('data', chunk => { serverOutput += chunk; });
  child.stderr.on('data', chunk => { serverOutput += chunk; });
  try {
    await waitForServer(child);
    const health = await fetch(`${base}/healthz`);
    const healthText = await health.text();
    assert.equal(health.status, 200, `healthz returned ${health.status}: ${healthText}`);
    const healthBody = JSON.parse(healthText);
    assert.equal(healthBody.status, 'ok');
    passed += 1;

    const ready = await fetch(`${base}/readyz`);
    const readyText = await ready.text();
    assert.equal(ready.status, 503, `readyz returned ${ready.status}: ${readyText}`);
    const readyBody = JSON.parse(readyText);
    assert.equal(readyBody.status, 'draining');
    assert.equal(readyBody.acceptingNewRounds, false);
    passed += 1;

    const analytics = await fetch(`${base}/admin/analytics/summary`);
    assert.equal(analytics.status, 403);
    passed += 1;

    const missingAsset = await fetch(`${base}/assets/not-a-real-file.svg`);
    assert.equal(missingAsset.status, 404);
    assert.match(await missingAsset.text(), /Table not found/);
    passed += 1;

    const unknownRoute = await fetch(`${base}/not-a-real-route`);
    assert.equal(unknownRoute.status, 404);
    passed += 1;

    socket = io(base, { reconnection: false });
    const state = new Promise(resolve => socket.once('maintenance-state', resolve));
    await connect(socket);
    assert.equal((await state).mode, 'draining');
    passed += 1;

    const rejected = await ask(socket, 'create-room', { clientId: 'maintenance-client', nickname: 'Maintenance' });
    assert.equal(rejected.success, false);
    assert.equal(rejected.code, 'MAINTENANCE_DRAINING');
    passed += 1;

    const resumed = await fetch(`${base}/internal/maintenance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-poorup-maintenance-token': 'maintenance-test-token' },
      body: JSON.stringify({ mode: 'normal', releaseId: 'maintenance-test-release' }),
    });
    const resumedBody = await resumed.json();
    assert.equal(resumed.status, 200);
    assert.equal(resumedBody.maintenance.mode, 'normal');
    passed += 1;

    const idle = await (await fetch(`${base}/readyz`)).json();
    assert.equal(idle.waitingRooms, 0, 'no lobby is waiting before a room exists');
    passed += 1;

    const created = await ask(socket, 'create-room', { clientId: 'maintenance-client', nickname: 'Maintenance' });
    assert.equal(created.success, true);
    passed += 1;

    // A seated lobby is a waiting room: a reload would drop its players, so the
    // deploy gate waits for it as well as for started rounds (E37-04).
    const lobby = await (await fetch(`${base}/readyz`)).json();
    assert.equal(lobby.waitingRooms, 1, 'a lobby with a seated human is a waiting room');
    assert.equal(lobby.activeRounds, 0);
    passed += 1;

    // A drain is not a lockout: it pauses new rooms and rounds, and the
    // shutdown waits for the seats that are still in a lobby (the waiting-room
    // count above), so a seat taken during a drain is not dropped on the way
    // out. Only the lockout refuses a new seat.
    const directory = await ask(socket, 'list-rooms', undefined);
    const openRoom = directory?.rooms?.[0];
    assert.ok(openRoom?.roomId, 'the waiting lobby must be listed for a joiner');
    const drainState = new Promise(resolve => socket.on('maintenance-state', state => { if (state.mode === 'draining') resolve(state); }));
    const draining = await fetch(`${base}/internal/maintenance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-poorup-maintenance-token': 'maintenance-test-token' },
      body: JSON.stringify({ mode: 'draining', releaseId: 'maintenance-test-release' }),
    });
    assert.equal(draining.status, 200);
    await drainState;
    joiner = io(base, { reconnection: false });
    await connect(joiner);
    const seatDuringDrain = await ask(joiner, 'join-room', { roomId: openRoom.roomId, clientId: 'wire-joiner', nickname: 'Joiner' });
    assert.equal(seatDuringDrain.success, true, 'a drain leaves the seat open; the drain waits for the lobby');
    passed += 1;
    const resumedAfterDrain = await fetch(`${base}/internal/maintenance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-poorup-maintenance-token': 'maintenance-test-token' },
      body: JSON.stringify({ mode: 'normal' }),
    });
    assert.equal(resumedAfterDrain.status, 200);

    // Lockout: the deploy route turns the panel on; every socket hears it with
    // its own bypass flag, and a plain visitor is refused by the server.
    const lockedState = new Promise(resolve => socket.on('maintenance-state', state => { if (state.lockout) resolve(state); }));
    const locked = await fetch(`${base}/internal/maintenance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-poorup-maintenance-token': 'maintenance-test-token' },
      body: JSON.stringify({ mode: 'maintenance', lockout: true, message: 'Closed for the wire test' }),
    });
    assert.equal(locked.status, 200);
    assert.equal((await locked.json()).maintenance.lockout, true);
    const heard = await lockedState;
    assert.equal(heard.bypass, false);
    assert.equal(heard.message, 'Closed for the wire test');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'maintenance.json'), 'utf8')).lockout, true, 'the lockout is persisted');
    const lockedReady = await fetch(`${base}/readyz`);
    assert.equal(lockedReady.status, 503);
    assert.equal((await lockedReady.json()).status, 'unavailable');
    passed += 1;

    visitor = io(base, { reconnection: false });
    const visitorState = new Promise(resolve => visitor.once('maintenance-state', resolve));
    await connect(visitor);
    assert.equal((await visitorState).bypass, false);
    const refusedVisitor = await ask(visitor, 'create-room', { clientId: 'wire-visitor', nickname: 'Visitor' });
    assert.equal(refusedVisitor.code, 'MAINTENANCE_LOCKOUT');
    const refusedJoin = await ask(visitor, 'join-room', { roomCode: 'ZZZZ99', clientId: 'wire-visitor', nickname: 'Visitor' });
    assert.equal(refusedJoin.code, 'MAINTENANCE_LOCKOUT');
    passed += 1;

    // Operator sign-in: the wrong password is a generic 401, the right one a cookie.
    assert.equal((await fetch(`${base}/maintenance/unlock`)).status, 200);
    const unlockPost = password => fetch(`${base}/maintenance/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    const wrong = await unlockPost('not-the-password');
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { success: false, error: 'Sign-in failed.' });
    const right = await unlockPost('wire-operator-password');
    assert.equal(right.status, 200);
    const setCookie = right.headers.get('set-cookie') || '';
    assert.match(setCookie, /^poorup_operator=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200/);
    const operatorCookie = setCookie.split(';')[0];
    passed += 1;

    operator = io(base, { reconnection: false, extraHeaders: { cookie: operatorCookie } });
    const operatorState = new Promise(resolve => operator.once('maintenance-state', resolve));
    await connect(operator);
    assert.equal((await operatorState).bypass, true);
    const operatorRoom = await ask(operator, 'create-room', { clientId: 'wire-operator', nickname: 'Operator' });
    assert.equal(operatorRoom.success, true, JSON.stringify(operatorRoom));
    passed += 1;

    const logout = await fetch(`${base}/maintenance/logout`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: operatorCookie }, body: '{}' });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') || '', /^poorup_operator=; .*Max-Age=0/);
    const afterLogout = await ask(operator, 'get-maintenance-state', {});
    assert.equal(afterLogout.maintenance.bypass, false, 'logout revokes the token for the open socket too');
    const unlocked = await fetch(`${base}/internal/maintenance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-poorup-maintenance-token': 'maintenance-test-token' },
      body: JSON.stringify({ mode: 'normal' }),
    });
    assert.equal((await unlocked.json()).maintenance.lockout, false);
    passed += 1;
    if (serverOutput.includes('wire-operator-password')) throw new Error('the operator password reached the server log');

    // The internal route is an operator action, so it leaves an audit trail:
    // the same stable actor for every token-held change, with the outcome.
    const auditPath = path.join(dataDir, 'admin-audit.json');
    assert.ok(fs.existsSync(auditPath), 'the internal maintenance route must write an audit trail');
    const auditBody = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    const entries = Array.isArray(auditBody.entries) ? auditBody.entries : [];
    assert.ok(entries.length >= 4, `the internal route must be audited, got ${entries.length} entries`);
    for (const entry of entries) {
      assert.equal(entry.area, 'release', `unexpected audit area ${entry.area}`);
      assert.ok(['mode', 'lockout'].includes(entry.action), `unexpected audit action ${entry.action}`);
      assert.ok(['ok', 'failed'].includes(entry.outcome), `unexpected audit outcome ${entry.outcome}`);
      assert.match(entry.actor, /^admin-[0-9a-f]{8}$/, 'the internal route must use a stable internal actor');
    }
    assert.equal(new Set(entries.map(entry => entry.actor)).size, 1, 'the internal route must use one stable actor');
    assert.ok(entries.some(entry => entry.action === 'mode' && entry.target === 'draining' && entry.outcome === 'ok'), 'a drain must be audited');
    assert.ok(entries.some(entry => entry.action === 'lockout' && entry.target === 'on' && entry.outcome === 'ok'), 'a lockout change must be audited');
    passed += 1;

    console.log(`maintenance wire checks: ${passed} passed, 0 failed`);
  } finally {
    joiner?.close();
    visitor?.close();
    operator?.close();
    socket?.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
    if (serverOutput && serverOutput.includes('UNCAUGHT')) console.error(serverOutput);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// A maintenance file nobody can read must not open the table. The store loader
// quarantines the bytes and reports the file as corrupt, and the controller
// then boots closed instead of falling back to the environment default. The
// closed state must also survive the next restart: the quarantined bytes
// leave no valid record behind, so a durable closed marker takes their place.
async function runCorruptBootPhase() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-maintenance-corrupt-'));
  const corruptPort = 8980 + (process.pid % 20);
  fs.writeFileSync(path.join(dataDir, 'maintenance.json'), '{ "mode": "draining", "lockout": ');
  let passed = 0;
  const spawnServer = port => {
    const child = spawn(process.execPath, [path.join(process.cwd(), 'server/server.js')], {
      env: {
        ...process.env,
        PORT: String(port),
        POORUP_DATA_DIR: dataDir,
        POORUP_MAINTENANCE_MODE: 'normal',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    return { child, base: `http://127.0.0.1:${port}`, output: () => output };
  };
  const stopServer = async server => {
    if (server.child.exitCode === null) {
      server.child.kill();
      await Promise.race([
        new Promise(resolve => server.child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
  };
  let server = spawnServer(corruptPort);
  let corruptSocket;
  try {
    await waitForServer(server.child, server.base);
    corruptSocket = io(server.base, { reconnection: false });
    const state = new Promise(resolve => corruptSocket.once('maintenance-state', resolve));
    await connect(corruptSocket);
    const snapshot = await state;
    assert.equal(snapshot.mode, 'maintenance', `a corrupt maintenance file must boot closed, got ${snapshot.mode}`);
    const ready = await fetch(`${server.base}/readyz`);
    assert.equal(ready.status, 503, 'a corrupt maintenance file must not report the table ready');
    // The operator must be able to see that the state was recovered.
    assert.match(String(snapshot.message), /CORRUPT/i, `the recovered state must be visible to the operator, got ${snapshot.message}`);
    assert.match(server.output(), /stays closed/i, 'the recovery must be logged for the operator');
    // The quarantined bytes leave no valid record behind, so a durable
    // closed marker must stand in their place: without it the next restart
    // finds no file and boots at the env default with the site open.
    const raw = fs.readFileSync(path.join(dataDir, 'maintenance.json'), 'utf8');
    let marker = null;
    try { marker = JSON.parse(raw); } catch { marker = null; }
    assert.ok(marker, `a corrupt maintenance file must leave a valid closed marker, found: ${raw.slice(0, 80)}`);
    assert.equal(marker.mode, 'maintenance', 'the durable marker must boot closed');
    assert.equal(marker.lockout, false, 'the recovery must not change who may join');
    passed += 1;

    // The next restart reads that marker, so the table is still closed.
    corruptSocket.close();
    corruptSocket = null;
    await stopServer(server);
    server = spawnServer(9000 + (process.pid % 20));
    await waitForServer(server.child, server.base);
    const restarted = io(server.base, { reconnection: false });
    try {
      const restartedState = new Promise(resolve => restarted.once('maintenance-state', resolve));
      await connect(restarted);
      const restored = await restartedState;
      assert.equal(restored.mode, 'maintenance', `a corrupt maintenance file must stay closed after a restart, got ${restored.mode}`);
      assert.equal((await fetch(`${server.base}/readyz`)).status, 503, 'the recovered state must survive the restart');
      assert.match(String(restored.message), /CORRUPT/i, 'the operator must still see that the state was recovered');
    } finally {
      restarted.close();
    }
    passed += 1;
    console.log(`maintenance corrupt boot checks: ${passed} passed, 0 failed`);
  } finally {
    corruptSocket?.close();
    await stopServer(server);
    if (server.output().includes('UNCAUGHT')) console.error(server.output());
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run()
  .then(runCorruptBootPhase)
  .catch(error => {
    console.error('maintenance wire checks failed:', error);
    process.exitCode = 1;
  });
