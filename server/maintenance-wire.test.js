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
      POORUP_RELEASE_ID: 'maintenance-test-release',
      POORUP_SHUTDOWN_DRAIN_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let socket;
  let serverOutput = '';
  child.stdout.on('data', chunk => { serverOutput += chunk; });
  child.stderr.on('data', chunk => { serverOutput += chunk; });
  try {
    await waitForServer(child);
    const health = await fetch(`${base}/healthz`);
    const healthText = await health.text();
    assert.equal(health.status, 200, `healthz returned ${health.status}: ${healthText}`);
    const healthBody = JSON.parse(healthText);
    assert.equal(healthBody.status, 'ok');

    const ready = await fetch(`${base}/readyz`);
    const readyText = await ready.text();
    assert.equal(ready.status, 200, `readyz returned ${ready.status}: ${readyText}`);
    const readyBody = JSON.parse(readyText);
    assert.equal(readyBody.acceptingNewRounds, false);

    const analytics = await fetch(`${base}/admin/analytics/summary`);
    assert.equal(analytics.status, 403);

    const missingAsset = await fetch(`${base}/assets/not-a-real-file.svg`);
    assert.equal(missingAsset.status, 404);
    assert.match(await missingAsset.text(), /Table not found/);

    const unknownRoute = await fetch(`${base}/not-a-real-route`);
    assert.equal(unknownRoute.status, 404);

    socket = io(base, { reconnection: false });
    const state = new Promise(resolve => socket.once('maintenance-state', resolve));
    await connect(socket);
    assert.equal((await state).mode, 'draining');

    const rejected = await ask(socket, 'create-room', { clientId: 'maintenance-client', nickname: 'Maintenance' });
    assert.equal(rejected.success, false);
    assert.equal(rejected.code, 'MAINTENANCE_DRAINING');

    const resumed = await fetch(`${base}/internal/maintenance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-poorup-maintenance-token': 'maintenance-test-token' },
      body: JSON.stringify({ mode: 'normal', releaseId: 'maintenance-test-release' }),
    });
    const resumedBody = await resumed.json();
    assert.equal(resumed.status, 200);
    assert.equal(resumedBody.maintenance.mode, 'normal');

    const created = await ask(socket, 'create-room', { clientId: 'maintenance-client', nickname: 'Maintenance' });
    assert.equal(created.success, true);
    console.log('maintenance wire checks: 11 passed, 0 failed');
  } finally {
    socket?.close();
    child.kill();
    if (serverOutput && serverOutput.includes('UNCAUGHT')) console.error(serverOutput);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error('maintenance wire checks failed:', error);
  process.exitCode = 1;
});
