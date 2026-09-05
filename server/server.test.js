// Wire-level smoke for the handler scaffold: a null payload on the events
// that destructure it used to throw inside the socket.io listener and kill
// the whole server process. These suites prove the scaffold answers with an
// error ack instead, keeps the process alive, and that the normal socket
// flow still works end to end.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8131 + (process.pid % 199);
const BASE = `http://localhost:${PORT}`;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(child, deadlineMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < deadlineMs) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await wait(150);
  }
  throw new Error('server did not come up in time');
}

function ask(socket, event, payload) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ __timeout: true }), 4000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

const results = [];
function check(name, condition) {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${name}`);
}

function isBadAck(response) {
  if (!response) return true;
  if (response.__timeout) return true;
  return response.success !== false;
}

async function connect(socket) {
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    setTimeout(() => reject(new Error('socket connect timeout')), 8000);
  });
}

async function checkNullPayloadStorm(socket, child) {
  // The crash class: every handler that destructures its payload received a
  // null and used to take the process down. Each must now ack, and the
  // server must still be running afterwards.
  const hostileEvents = [
    'set-setting', 'set-player-appearance', 'purchase-property',
    'decline-property', 'auction-bid', 'manage-property', 'respond-trade',
    'take-bank-loan', 'market-order', 'place-casino-bet', 'send-chat'
  ];
  let allAnswered = true;
  for (const event of hostileEvents) {
    if (isBadAck(await ask(socket, event, null))) allAnswered = false;
  }
  check('null payloads are answered with error acks', allAnswered);
  check('server survived the null payload storm', child.exitCode === null);
}

async function checkHappyPath(socket) {
  // The scaffold must not change happy-path behavior: create a room, receive
  // the viewer-scoped snapshot, then leave cleanly. The snapshot listener is
  // attached before the create-room emit fires.
  const snapshotReceived = new Promise(resolve => {
    socket.once('update-state', resolve);
    setTimeout(() => resolve(null), 3000);
  });
  const created = await ask(socket, 'create-room', { clientId: 'probe-client', nickname: 'Probe' });
  check('create-room still succeeds over the wire', created?.success === true);
  const snapshot = await snapshotReceived;
  check('update-state snapshot arrives', snapshot?.room?.players?.[0]?.nickname === 'Probe');
  const left = await ask(socket, 'leave-room', { clientId: 'probe-client' });
  check('leave-room succeeds', left?.success === true);
  const rooms = await ask(socket, 'list-rooms', undefined);
  check('list-rooms succeeds with no payload', rooms?.success === true);
}

async function run() {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  child.stdout.on('data', chunk => { serverLog += chunk; });
  child.stderr.on('data', chunk => { serverLog += chunk; });
  let socket = null;

  try {
    await waitForServer(child, 15000);
    check('server boots and serves the shell', true);

    socket = io(BASE, { reconnection: false });
    await connect(socket);
    check('socket client connects', socket.connected);

    await checkNullPayloadStorm(socket, child);
    await checkHappyPath(socket);

    check('no uncaught exception was logged', !serverLog.includes('UNCAUGHT EXCEPTION'));
  } finally {
    if (socket) socket.close();
    child.kill();
  }
}

const watchdog = setTimeout(() => {
  console.error('server tests: watchdog timeout');
  process.exit(1);
}, 60000);

run()
  .catch(error => {
    console.error('server tests crashed:', error);
    results.push({ name: 'run completed without throwing', ok: false });
  })
  .finally(() => {
    clearTimeout(watchdog);
    const failed = results.filter(result => !result.ok);
    console.log(`server tests: ${results.length - failed.length} passed, ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  });
