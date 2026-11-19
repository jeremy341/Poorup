// Real-process restart: a lobby created over the wire survives a hard process kill and is reachable again through restore-session on the
// next boot (same data directory). A corrupt rooms.json is quarantined and the server still boots. Started games are out of scope.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const serverEntry = fileURLToPath(new URL('./server.js', import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-room-restart-'));
let nextPort = 9600 + (process.pid % 100);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function spawnServer() {
  const port = nextPort;
  nextPort += 1;
  const env = { ...process.env, PORT: String(port), POORUP_DATA_DIR: dataDir };
  for (const key of ['POORUP_MAINTENANCE_MODE', 'POORUP_RELEASE_ID', 'POORUP_BACKUP_DIR', 'NODE_ENV']) delete env[key];
  const child = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  return { child, base: `http://127.0.0.1:${port}`, output: () => output, exited: new Promise(resolve => child.once('exit', resolve)) };
}

async function startServer() {
  const server = spawnServer();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error(`server exited early: ${server.output()}`);
    try {
      if ((await fetch(`${server.base}/healthz`)).ok) return server;
    } catch {
      // still booting
    }
    await wait(100);
  }
  throw new Error(`server did not answer /healthz: ${server.output()}`);
}

async function killServer(server) {
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
  await server.exited;
}

function ask(socket, event, payload) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ __timeout: true }), 4000);
    socket.emit(event, payload, response => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function connect(server) {
  return new Promise((resolve, reject) => {
    const socket = io(server.base, { reconnection: false, transports: ['websocket'] });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const roomsFile = path.join(dataDir, 'rooms.json');
const clientId = 'restart-client-1';
let first = null;
let second = null;
let third = null;
try {
  // Boot one: create a private lobby, give it a name and a bot, and let the sweep write it.
  first = await startServer();
  const creator = await connect(first);
  const created = await ask(creator, 'create-room', { clientId, nickname: 'Restarter', visibility: 'private', roomCode: 'RSTRT1' });
  assert.equal(created?.success, true, JSON.stringify(created));
  const roomCode = created.roomCode;
  assert.match(roomCode || '', /^[A-Z0-9]{6}$/);
  const bots = await ask(creator, 'set-setting', { key: 'bots', value: 1 });
  assert.equal(bots?.success, true, JSON.stringify(bots));
  const deadline = Date.now() + 8_000;
  while (!fs.existsSync(roomsFile) && Date.now() < deadline) await wait(200);
  assert.ok(fs.existsSync(roomsFile), 'the lobby sweep wrote rooms.json');
  creator.close();
  await killServer(first); // hard kill: no shutdown flush, the sweep alone must have been enough
  first = null;

  // Boot two: the lobby is back and the old clientId re-enters it with a brand-new socket.
  second = await startServer();
  assert.match(second.output(), /Restored 1 lobby room\(s\)/);
  const returning = await connect(second);
  const update = new Promise(resolve => {
    returning.on('update-state', snapshot => resolve(snapshot));
    setTimeout(() => resolve(null), 4000);
  });
  const restored = await ask(returning, 'restore-session', { clientId });
  assert.equal(restored?.success, true, JSON.stringify(restored));
  assert.equal(restored.roomCode, roomCode);
  const snapshot = await update;
  assert.equal(snapshot?.room?.players?.some(player => player.nickname === 'Restarter'), true);
  assert.equal(snapshot?.game?.started, false);
  returning.close();
  await killServer(second);
  second = null;

  // Boot three: a corrupt snapshot file is quarantined and the server still comes up empty.
  fs.writeFileSync(roomsFile, '{ definitely not json');
  third = await startServer();
  assert.ok(fs.readdirSync(dataDir).some(name => name.startsWith('rooms.json.corrupt')), 'corrupt rooms.json was quarantined');
  const stranger = await connect(third);
  assert.equal((await ask(stranger, 'restore-session', { clientId }))?.success, false);
  stranger.close();
} finally {
  for (const server of [first, second, third]) if (server) await killServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log('room lobby restart: lobby survived a hard kill; corrupt snapshot quarantined');
