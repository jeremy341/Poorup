// Boots the real server.js against a throwaway data directory and checks the maintenance state after a restart. A plain SIGTERM
// must not leave the next boot refusing new rooms, while an operator drain must survive a restart (deploy-nest.sh depends on that).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { io } from 'socket.io-client';

const serverEntry = fileURLToPath(new URL('./server.js', import.meta.url));
const TOKEN = 'maintenance-persistence-token';
let nextPort = 9100 + (process.pid % 100);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function childEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const key of ['POORUP_MAINTENANCE_MODE', 'POORUP_RELEASE_ID', 'POORUP_BACKUP_DIR', 'NODE_ENV']) delete env[key];
  return env;
}

function spawnServer({ dataDir, extraEnv = {}, entry = [serverEntry] }) {
  const port = nextPort;
  nextPort += 1;
  const child = spawn(process.execPath, entry, {
    env: childEnv({
      PORT: String(port),
      POORUP_DATA_DIR: dataDir,
      POORUP_MAINTENANCE_TOKEN: TOKEN,
      POORUP_SHUTDOWN_DRAIN_MS: '1000',
      ...extraEnv,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code) => resolve(code)));
  return { child, base: `http://127.0.0.1:${port}`, output: () => output, exited };
}

async function waitForHealth(server) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error(`server exited early: ${server.output()}`);
    try {
      const response = await fetch(`${server.base}/healthz`);
      if (response.ok) return;
    } catch {
      // still booting
    }
    await wait(100);
  }
  throw new Error(`server did not answer /healthz: ${server.output()}`);
}

async function startServer(options) {
  const server = spawnServer(options);
  await waitForHealth(server);
  return server;
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  server.child.kill();
  const exitCode = await Promise.race([server.exited, wait(15_000).then(() => 'timeout')]);
  if (exitCode === 'timeout') {
    server.child.kill('SIGKILL');
    await server.exited;
  }
}

async function readyz(server) {
  const response = await fetch(`${server.base}/readyz`);
  return { status: response.status, body: await response.json() };
}

function persistedMaintenance(dataDir) {
  const file = path.join(dataDir, 'maintenance.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function tempDataDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `poorup-maintenance-${label}-`));
}

const scenarios = [];
function record(name, run) {
  scenarios.push({ name, run });
}

// Seam: the real SIGTERM listener, emitted in-process because Windows
// cannot deliver SIGTERM by signal. The wrapper exits by itself once drained.
const sigtermWrapper = `
import(${JSON.stringify(pathToFileURL(serverEntry).href)});
setTimeout(() => process.emit('SIGTERM'), 2000);
`;

record('plain SIGTERM leaves no draining record for the next boot', async () => {
  const dataDir = tempDataDir('sigterm');
  try {
    const wrapped = spawnServer({ dataDir, entry: ['--input-type=module', '-e', sigtermWrapper] });
    await waitForHealth(wrapped);
    const exitCode = await Promise.race([wrapped.exited, wait(20_000).then(() => 'timeout')]);
    assert.equal(exitCode, 0, `shutdown did not exit cleanly: ${wrapped.output()}`);
    assert.equal(persistedMaintenance(dataDir), null, 'a shutdown drain must not be written to maintenance.json');

    const next = await startServer({ dataDir });
    try {
      const ready = await readyz(next);
      assert.equal(ready.status, 200, `fresh boot after shutdown refused traffic: ${JSON.stringify(ready.body)}`);
      assert.equal(ready.body.acceptingNewRounds, true);
    } finally {
      await stopServer(next);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

record('operator drain is persisted and still applies after restart', async () => {
  const dataDir = tempDataDir('operator');
  try {
    const first = await startServer({ dataDir });
    try {
      const drain = await fetch(`${first.base}/internal/maintenance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-poorup-maintenance-token': TOKEN },
        body: JSON.stringify({ mode: 'draining', releaseId: 'deploy-sha-1', message: 'MAINTENANCE WINDOW · INCOMING RELEASE' }),
      });
      assert.equal(drain.status, 200);
    } finally {
      await stopServer(first);
    }
    const persisted = persistedMaintenance(dataDir);
    assert.equal(persisted?.mode, 'draining');
    assert.equal(persisted?.releaseId, 'deploy-sha-1');

    const second = await startServer({ dataDir });
    try {
      const ready = await readyz(second);
      assert.equal(ready.status, 503);
      assert.equal(ready.body.status, 'draining');
      assert.equal(ready.body.acceptingNewRounds, false);
    } finally {
      await stopServer(second);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

record('a persisted lockout comes back with its maintenance window after a restart', async () => {
  const dataDir = tempDataDir('lockout');
  try {
    fs.writeFileSync(path.join(dataDir, 'maintenance.json'), `${JSON.stringify({ mode: 'maintenance', lockout: true, message: 'MAINTENANCE IN PROGRESS', releaseId: 'rel-3', drainDeadline: null, activeRounds: 0 }, null, 2)}\n`);
    const server = await startServer({ dataDir });
    const socket = io(server.base, { reconnection: false, transports: ['websocket'] });
    try {
      const state = await new Promise((resolve, reject) => {
        socket.once('maintenance-state', resolve);
        socket.once('connect_error', reject);
        setTimeout(() => reject(new Error('no maintenance-state')), 6_000);
      });
      assert.equal(state.mode, 'maintenance');
      assert.equal(state.lockout, true);
      assert.equal(state.bypass, false);
      assert.equal((await readyz(server)).status, 503);
    } finally {
      socket.close();
      await stopServer(server);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

for (const [label, legacy] of [
  ['releaseId shutdown', { mode: 'draining', releaseId: 'shutdown', message: 'SIGTERM · SERVER RESTARTING', drainDeadline: null }],
  ['restart message with a release id', { mode: 'draining', releaseId: 'a1b2c3d', message: 'SIGTERM · SERVER RESTARTING', drainDeadline: null }],
]) {
  record(`a stale persisted shutdown drain (${label}) is ignored at boot`, async () => {
    const dataDir = tempDataDir('legacy');
    try {
      fs.writeFileSync(path.join(dataDir, 'maintenance.json'), `${JSON.stringify(legacy, null, 2)}\n`);
      const server = await startServer({ dataDir });
      try {
        const ready = await readyz(server);
        assert.equal(ready.status, 200, `stale shutdown record still closes the table: ${JSON.stringify(ready.body)}`);
        assert.equal(ready.body.acceptingNewRounds, true);
      } finally {
        await stopServer(server);
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
}

const outcomes = [];
for (const scenario of scenarios) {
  try {
    await scenario.run();
    outcomes.push({ name: scenario.name, ok: true });
  } catch (error) {
    outcomes.push({ name: scenario.name, ok: false, error });
  }
}
let failures = 0;
for (const outcome of outcomes) {
  if (outcome.ok) {
    console.log(`PASS - ${outcome.name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${outcome.name}:`, outcome.error?.message || outcome.error);
  }
}
console.log(`maintenance persistence checks: ${outcomes.length - failures} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
