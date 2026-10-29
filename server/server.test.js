// Wire-level smoke for the handler scaffold: a null payload on events that destructure it must not throw inside the socket.io listener
// or kill the process. These suites prove the scaffold answers with an error ack, keeps the process alive, and that the normal
// socket flow still works end to end.
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8131 + (process.pid % 199);
const BASE = `http://localhost:${PORT}`;
const serverEntry = path.join(__dirname, 'server.js');
// The phases below run their own server on their own port, in a range no
// other suite uses.
const phaseBasePort = 8960 + (process.pid % 20);
let phasePortCounter = 0;

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
function check(name, condition, details) {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}`);
  if (!condition && details !== undefined) {
    console.error(JSON.stringify(details, null, 2));
  }
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

function nextPhasePort() {
  phasePortCounter += 1;
  return phaseBasePort + phasePortCounter;
}

function spawnPhaseServer({ port, dataDir, env = {}, entry = [serverEntry] }) {
  const child = spawn(process.execPath, entry, {
    env: { ...process.env, PORT: String(port), POORUP_DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  return { child, base: `http://127.0.0.1:${port}`, output: () => output, exited };
}

async function waitForHealth(server, deadlineMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < deadlineMs) {
    if (server.child.exitCode !== null) throw new Error(`server exited early: ${server.output()}`);
    try {
      const response = await fetch(`${server.base}/healthz`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await wait(150);
  }
  throw new Error(`server did not come up in time: ${server.output()}`);
}

async function stopPhaseServer(server) {
  if (server.child.exitCode === null) {
    server.child.kill();
    await Promise.race([server.exited, wait(5000).then(() => 'timeout')]);
  }
}

async function checkNullPayloadStorm(socket, child) {
  // The crash class: every handler that destructures its payload received a
  // null and must not take the process down. Each must ack, and the
  // server must still be running afterwards.
  const hostileEvents = [
    'set-setting', 'set-player-appearance', 'purchase-property',
    'decline-property', 'auction-bid', 'manage-property', 'respond-trade', 'counter-trade', 'counter-player-contract', 'adjust-trade', 'cancel-trade', 'adjust-player-contract',
    'take-bank-loan', 'market-order', 'open-margin', 'reduce-margin', 'open-short', 'cover-short', 'open-option', 'exercise-option', 'close-position', 'place-casino-bet', 'send-chat',
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
  const retiredSeasonScope = await ask(socket, 'get-leaderboard-snapshot', { scope: 'season' });
  check('retired season scope resolves to all-time rankings', retiredSeasonScope?.success === true && retiredSeasonScope?.scope === 'all' && !Object.hasOwn(retiredSeasonScope, 'season'));
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
  await ask(socket, 'set-setting', { key: 'randomizePlayerOrder', value: false });
  await ask(socket, 'set-setting', { key: 'globalEvents', value: false });
  await ask(socket, 'set-setting', { key: 'market', value: false });
  await ask(socket, 'set-setting', { key: 'casino', value: false });
  const startedState = nextEvent(socket, 'update-state');
  const started = await ask(socket, 'start-game', {});
  const startedSnapshot = await startedState;
  check('bot probe round starts', started?.success === true && startedSnapshot?.game?.started === true);

  let rolled = null;
  let snapshot = null;
  let humanTurnResolved = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stateUpdate = nextEvent(socket, 'update-state');
    rolled = await ask(socket, 'roll-dice', {});
    snapshot = await stateUpdate;
    const readyAt = Number(snapshot?.game?.presentation?.readyAt) || 0;
    if (readyAt > Date.now()) {
      const earlyEnd = await ask(socket, 'end-turn', {});
      check('turn cannot advance before its presentation settles', earlyEnd?.success === false);
      await wait(Math.max(0, readyAt - Date.now()) + 25);
    }
    if (snapshot?.game?.pendingPurchaseOffer) {
      const afterDecline = nextEvent(socket, 'update-state');
      await ask(socket, 'decline-property', { tileIndex: snapshot.game.pendingPurchaseOffer.tileIndex });
      snapshot = await afterDecline;
    }
    const human = snapshot?.game?.players?.find(player => player.nickname === 'Bot Probe');
    const humanCanEndTurn = Boolean(human && snapshot.game.currentPlayerId === human.id && snapshot.game.awaitingEndTurn);
    const humanAutoAdvancedToJail = Boolean(human?.inJail && snapshot.game.currentPlayerId !== human.id);
    humanTurnResolved = humanCanEndTurn || humanAutoAdvancedToJail;
    if (humanTurnResolved || !snapshot?.game?.extraRollPending) break;
  }
  const human = snapshot?.game?.players?.find(player => player.nickname === 'Bot Probe');
  const humanCanEndTurn = Boolean(human && snapshot.game.currentPlayerId === human.id && snapshot.game.awaitingEndTurn);
  const humanAutoAdvancedToJail = Boolean(human?.inJail && snapshot.game.currentPlayerId !== human.id);
  check(
    'bot probe human roll resolves by end-turn or third-double jail',
    rolled?.success === true && humanTurnResolved && (humanCanEndTurn || humanAutoAdvancedToJail),
    {
      rollResponse: rolled,
      finalSnapshot: snapshot,
      humanPlayer: human
    }
  );
  const ended = humanCanEndTurn ? await ask(socket, 'end-turn', {}) : { success: humanAutoAdvancedToJail, autoAdvanced: humanAutoAdvancedToJail };
  await wait(1200);
  socket.off('bot-status', onStatus);
  const status = statuses.find(candidate => candidate?.state === 'thinking') || statuses.find(candidate => candidate?.state === 'chosen');
  check('bot turn advances through the normal turn seam', ended?.success === true);
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

// A drain waits for a lobby that has not started yet: a deploy that dropped it
// would take the seated players away with it.
async function checkDrainWaitsForWaitingLobby() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-drain-wait-'));
  const trigger = path.join(dataDir, 'emit-sigterm');
  // Windows cannot deliver SIGTERM by signal, so the wrapper emits it in
  // process once the test asks for it.
  const wrapper = `
import(${JSON.stringify(pathToFileURL(serverEntry).href)});
import fs from 'node:fs';
const trigger = process.env.POORUP_TEST_SIGTERM_TRIGGER;
let sent = false;
setInterval(() => {
  if (sent || !fs.existsSync(trigger)) return;
  sent = true;
  process.emit('SIGTERM');
}, 50);
`;
  const port = nextPhasePort();
  const server = spawnPhaseServer({
    port,
    dataDir,
    entry: ['--input-type=module', '-e', wrapper],
    env: { POORUP_TEST_SIGTERM_TRIGGER: trigger, POORUP_SHUTDOWN_DRAIN_MS: '15000' }
  });
  let socket = null;
  try {
    await waitForHealth(server);
    socket = io(server.base, { reconnection: false });
    await connect(socket);
    const created = await ask(socket, 'create-room', { clientId: 'drain-wait-client', nickname: 'Drain Wait' });
    check('the waiting lobby is created', created?.success === true, created);
    const ready = await (await fetch(`${server.base}/readyz`)).json();
    check('the seated lobby is a waiting room', ready?.waitingRooms === 1, ready);
    fs.writeFileSync(trigger, 'go');
    await wait(1500);
    check('the drain waits for the waiting lobby', server.child.exitCode === null, `the server left during the drain: ${server.output()}`);
    const left = await ask(socket, 'leave-room', { clientId: 'drain-wait-client' });
    check('a seated player can still leave during the drain', left?.success === true, left);
    const exitCode = await Promise.race([server.exited, wait(15000).then(() => 'timeout')]);
    check('the server leaves once the waiting lobby is gone', exitCode === 0, `exit code ${exitCode}: ${server.output()}`);
  } finally {
    if (socket) socket.close();
    await stopPhaseServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// Node's timers take a 32-bit delay: an interval beyond 2^31-1 ms is turned
// into 1 ms, so the job would run on every tick instead of once in a while.
async function checkOversizedIntervalsStayBounded() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-interval-bounds-'));
  const port = nextPhasePort();
  const server = spawnPhaseServer({
    port,
    dataDir,
    env: {
      POORUP_BACKUP_DIR: path.join(dataDir, 'backups'),
      POORUP_BACKUP_INTERVAL_MS: '1000000000000',
      POORUP_RETENTION_INTERVAL_MS: '1000000000000'
    }
  });
  try {
    await waitForHealth(server);
    await wait(500);
    check('an oversized interval is bounded before it is scheduled', !server.output().includes('TimeoutOverflowWarning'), server.output().slice(-600));
  } finally {
    await stopPhaseServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// A mail key that is only whitespace is no key: the adapter must not report
// itself configured with one, and nothing may be sent to the provider.
async function checkMailKeyMustBeUsable() {
  const mailRequests = [];
  const mailServer = http.createServer((req, res) => {
    mailRequests.push(String(req.headers.authorization || ''));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise(resolve => mailServer.listen(0, '127.0.0.1', resolve));
  const mailPort = mailServer.address().port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-mail-key-'));
  const port = nextPhasePort();
  const server = spawnPhaseServer({
    port,
    dataDir,
    env: {
      POORUP_MAIL_API_URL: `http://127.0.0.1:${mailPort}/send`,
      POORUP_MAIL_API_KEY: '   ',
      POORUP_MAIL_FROM: 'parlor@example.test',
      POORUP_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`
    }
  });
  let socket = null;
  try {
    await waitForHealth(server);
    socket = io(server.base, { reconnection: false });
    await connect(socket);
    const registered = await ask(socket, 'account-register', { username: 'mailprobe', password: 'mail-probe-password' });
    check('the probe account is registered', registered?.success === true, registered);
    const recovery = await ask(socket, 'account-recovery-email-request', { email: 'probe@example.test', currentPassword: 'mail-probe-password' });
    check('a whitespace mail key sends nothing to the provider', mailRequests.length === 0, mailRequests);
    check('a whitespace mail key is not a usable key', recovery?.code === 'RECOVERY_MAIL_UNAVAILABLE', recovery);
  } finally {
    if (socket) socket.close();
    await stopPhaseServer(server);
    await new Promise(resolve => mailServer.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// A cookie issued by a legacy-token exchange remains subject to logout even
// when its Set-Cookie response arrives after the logout request.
async function checkLegacyLogoutRevokesExchangedCookies() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-logout-lineage-'));
  const port = nextPhasePort();
  const server = spawnPhaseServer({ port, dataDir });
  let socket = null;
  const issuedCookie = async (username, password) => {
    const registered = await ask(socket, 'account-register', { username, password });
    if (!registered?.success || typeof registered.sessionToken !== 'string') return { registered, cookie: '' };
    const response = await fetch(`${server.base}/account/session`, { headers: { 'x-poorup-session-token': registered.sessionToken } });
    return { registered, response, cookie: String(response.headers.get('set-cookie') || '').split(';', 1)[0] };
  };
  try {
    await waitForHealth(server);
    socket = io(server.base, { reconnection: false });
    await connect(socket);

    const httpCase = await issuedCookie('logouthttp', 'logout-http-password');
    const httpLogout = await fetch(`${server.base}/account/logout`, { method: 'POST', headers: { 'x-poorup-session-token': httpCase.registered?.sessionToken || '' } });
    const delayedHttpCookie = await fetch(`${server.base}/account/session`, { headers: { Cookie: httpCase.cookie } });
    check('HTTP logout revokes the cookie exchanged from its legacy token',
      httpCase.response?.status === 200 && httpCase.cookie.startsWith('poorup_session=') && httpLogout.status === 200 && delayedHttpCookie.status === 401,
      { exchange: httpCase.response?.status, logout: httpLogout.status, lateCookie: delayedHttpCookie.status });

    const socketCase = await issuedCookie('logoutsocket', 'logout-socket-password');
    const socketLogout = await ask(socket, 'account-logout', { sessionToken: socketCase.registered?.sessionToken });
    const cookieLessHttpLogout = await fetch(`${server.base}/account/logout`, { method: 'POST', headers: { 'x-poorup-session-token': socketCase.registered?.sessionToken || '' } });
    const delayedSocketCookie = await fetch(`${server.base}/account/session`, { headers: { Cookie: socketCase.cookie } });
    check('socket and cookie-less HTTP logout keep a delayed exchanged cookie invalid',
      socketCase.response?.status === 200 && socketCase.cookie.startsWith('poorup_session=') && socketLogout?.success === true && cookieLessHttpLogout.status === 200 && delayedSocketCookie.status === 401,
      { exchange: socketCase.response?.status, socketLogout, httpLogout: cookieLessHttpLogout.status, lateCookie: delayedSocketCookie.status });
  } finally {
    if (socket) socket.close();
    await stopPhaseServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-server-wire-'));
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), POORUP_DATA_DIR: dataDir, POORUP_SHUTDOWN_DRAIN_MS: '1000' },
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

    await checkDrainWaitsForWaitingLobby();
    await checkOversizedIntervalsStayBounded();
    await checkMailKeyMustBeUsable();
    await checkLegacyLogoutRevokesExchangedCookies();
  } finally {
    if (socket) socket.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
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
}, 180000);

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
