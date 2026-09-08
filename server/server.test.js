// Wire-level smoke for the handler scaffold: a null payload on the events
// that destructure it used to throw inside the socket.io listener and kill
// the whole server process. These suites prove the scaffold answers with an
// error ack instead, keeps the process alive, and that the normal socket
// flow still works end to end.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
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
    'decline-property', 'auction-bid', 'manage-property', 'respond-trade', 'counter-trade', 'counter-player-contract', 'adjust-trade', 'cancel-trade', 'adjust-player-contract',
    'take-bank-loan', 'market-order', 'place-casino-bet', 'send-chat',
    'request-sponsored-purchase', 'contribute-sponsored-purchase',
    'withdraw-sponsored-purchase', 'accept-sponsored-purchase', 'decline-sponsored-purchase'
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
  const season = await ask(socket, 'get-leaderboard-snapshot', { scope: 'season' });
  check('season leaderboard snapshot is available', season?.success === true && season?.scope === 'season');
}

async function checkBotStatusAndReconnect(socket, child) {
  const clientId = 'bot-status-client';
  const statuses = [];
  const onStatus = status => statuses.push(status);
  socket.on('bot-status', onStatus);
  const created = await ask(socket, 'create-room', { clientId, nickname: 'Bot Probe' });
  check('bot probe room creates', created?.success === true);
  await ask(socket, 'set-setting', { key: 'bots', value: 1 });
  await ask(socket, 'set-setting', { key: 'auction', value: false });
  const started = await ask(socket, 'start-game', {});
  check('bot probe round starts', started?.success === true);

  const stateUpdate = nextEvent(socket, 'update-state');
  const rolled = await ask(socket, 'roll-dice', {});
  const snapshot = await stateUpdate;
  check('bot probe human roll succeeds', rolled?.success === true);
  if (snapshot?.game?.pendingPurchaseOffer) {
    await ask(socket, 'decline-property', { tileIndex: snapshot.game.pendingPurchaseOffer.tileIndex });
  }
  const ended = await ask(socket, 'end-turn', {});
  await wait(1200);
  socket.off('bot-status', onStatus);
  const status = statuses.find(candidate => candidate?.state === 'thinking') || statuses.find(candidate => candidate?.state === 'chosen');
  check('bot turn advances through the normal seam', ended?.success === true);
  check('bot status is announced with a safe public payload', status?.nickname && ['ai', 'deterministic'].includes(status.provider));
  check('server survives bot status flow', child.exitCode === null);

  socket.close();
  await wait(250);
  const replacement = io(BASE, { reconnection: false });
  try {
    await connect(replacement);
    const update = nextEvent(replacement, 'update-state');
    const restored = await ask(replacement, 'restore-session', { clientId });
    const restoredSnapshot = await update;
    check('reconnect restores the bot probe room', restored?.success === true && restoredSnapshot?.room?.players?.some(player => player.nickname === 'Bot Probe'));
    check('reconnect returns the live authoritative snapshot', restoredSnapshot?.game?.started === true && restoredSnapshot?.game?.currentPlayerId);
  } finally {
    replacement.close();
  }
}

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-server-wire-'));
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), POORUP_DATA_DIR: dataDir },
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
    await checkBotStatusAndReconnect(socket, child);

    check('no uncaught exception was logged', !serverLog.includes('UNCAUGHT EXCEPTION'));
  } finally {
    if (socket) socket.close();
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function nextEvent(socket, event, timeoutMs = 5000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, payload => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
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
