// Characterization suite for the room lifecycle handlers in server.js:
// create-room, join-room, respond-room-invite, and get-match-history.
// These tests pin the EXACT ack payloads (error strings included), the
// check ordering, and the public/private ack shape so the Code Health
// refactor can be proven behavior-preserving. Wire-level only: no store
// internals are imported.
import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8331 + (process.pid % 199);
const BASE = `http://localhost:${PORT}`;
const RUN_TAG = crypto.randomBytes(3).toString('hex');

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

function ackEquals(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function connect(socket) {
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    setTimeout(() => reject(new Error('socket connect timeout')), 8000);
  });
}

async function openSocket(clientSockets) {
  const socket = io(BASE, { reconnection: false });
  await connect(socket);
  clientSockets.push(socket);
  return socket;
}

// Harness: one server for the whole ordered scenario list; sockets created by
// a scenario stay open (server-side room membership carries across blocks).
async function withServer(runScenarios) {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  child.stdout.on('data', chunk => { serverLog += chunk; });
  child.stderr.on('data', chunk => { serverLog += chunk; });
  const ctx = { child, serverLog: () => serverLog, clientSockets: [], ask, check };
  ctx.open = () => openSocket(ctx.clientSockets);
  try {
    await waitForServer(child, 15000);
    await runScenarios(ctx);
  } finally {
    for (const socket of ctx.clientSockets) socket.close();
    child.kill();
  }
}

async function validationAcks(ctx) {
  ctx.anon = await ctx.open();
  ctx.check('create-room without nickname acks the exact nickname error',
    ackEquals(await ctx.ask(ctx.anon, 'create-room', { clientId: 'anon-1' }),
      { success: false, error: 'Nickname is required.' }));
  ctx.check('create-room private with short code acks the exact invite-code error',
    ackEquals(await ctx.ask(ctx.anon, 'create-room', { clientId: 'anon-1', nickname: 'Solo', visibility: 'private', roomCode: 'AB' }),
      { success: false, error: 'Private rooms need a unique 6-character invite code.' }));
  ctx.check('create-room with null payload acks the nickname error (scaffold normalizes)',
    ackEquals(await ctx.ask(ctx.anon, 'create-room', null),
      { success: false, error: 'Nickname is required.' }));
  ctx.check('join-room without room code acks the exact room-code error',
    ackEquals(await ctx.ask(ctx.anon, 'join-room', { clientId: 'anon-1', nickname: 'Solo' }),
      { success: false, error: 'Room code is required.' }));
  ctx.check('join-room without nickname acks the exact nickname error',
    ackEquals(await ctx.ask(ctx.anon, 'join-room', { clientId: 'anon-1', roomCode: 'ZZZZZZ' }),
      { success: false, error: 'Nickname is required.' }));
  ctx.check('join-room unknown code acks the exact not-found error',
    ackEquals(await ctx.ask(ctx.anon, 'join-room', { clientId: 'anon-1', roomCode: 'QQQQQQ', nickname: 'Solo' }),
      { success: false, error: 'Room not found.' }));
}

async function privateCodeReservation(ctx) {
  ctx.host = await ctx.open();
  ctx.check('create-room private normalizes the requested code and acks it',
    ackEquals(await ctx.ask(ctx.host, 'create-room', { clientId: 'c1', nickname: 'Host One', visibility: 'private', roomCode: 'ab 12cd!' }),
      { success: true, roomCode: 'AB12CD', visibility: 'private' }));
  const dupe = await ctx.open();
  ctx.check('create-room on a taken private code acks the exact conflict error',
    ackEquals(await ctx.ask(dupe, 'create-room', { clientId: 'c2', nickname: 'Dupe', visibility: 'private', roomCode: 'AB12CD' }),
      { success: false, error: 'That private room code is already in use. Choose another.' }));
  ctx.check('leave-room for an unknown client still acks success',
    ackEquals(await ctx.ask(dupe, 'leave-room', { clientId: 'c2' }), { success: true }));
}

async function capacityAndRejoin(ctx) {
  ctx.check('create-room public acks a null room code and public visibility',
    ackEquals(await ctx.ask(ctx.host, 'create-room', { clientId: 'c1', nickname: 'Host One', visibility: 'garbage' }),
      { success: true, roomCode: null, visibility: 'public' }));
  ctx.check('host can change settings before the game starts',
    ackEquals(await ctx.ask(ctx.host, 'set-setting', { key: 'maxPlayers', value: 2 }), { success: true }));
  // The public room has no visible code; create a fresh private fixture.
  ctx.check('create-room private FULL01 succeeds for the capacity fixture',
    ackEquals(await ctx.ask(ctx.host, 'create-room', { clientId: 'c1', nickname: 'Host One', visibility: 'private', roomCode: 'FULL01' }),
      { success: true, roomCode: 'FULL01', visibility: 'private' }));
  ctx.check('set-setting maxPlayers succeeds again in the new room',
    ackEquals(await ctx.ask(ctx.host, 'set-setting', { key: 'maxPlayers', value: 2 }), { success: true }));
  ctx.joiner = await ctx.open();
  ctx.check('first guest joins the private room and gets the code back',
    ackEquals(await ctx.ask(ctx.joiner, 'join-room', { clientId: 'c3', roomCode: 'FULL01', nickname: 'Guest Three' }),
      { success: true, roomCode: 'FULL01', visibility: 'private' }));
  ctx.late = await ctx.open();
  ctx.check('joining a full room acks the exact room-full error',
    ackEquals(await ctx.ask(ctx.late, 'join-room', { clientId: 'c4', roomCode: 'FULL01', nickname: 'Late Guest' }),
      { success: false, error: 'Room is full.' }));
  ctx.check('the same client can rejoin its existing seat',
    ackEquals(await ctx.ask(ctx.joiner, 'join-room', { clientId: 'c3', roomCode: 'FULL01', nickname: 'Guest Three' }),
      { success: true, roomCode: 'FULL01', visibility: 'private' }));
  ctx.check('host can queue one bot via settings',
    ackEquals(await ctx.ask(ctx.host, 'set-setting', { key: 'bots', value: 1 }), { success: true }));
  ctx.check('host can start the game', ackEquals(await ctx.ask(ctx.host, 'start-game', {}), { success: true }));
  ctx.check('joining a started room acks the exact in-progress error',
    ackEquals(await ctx.ask(ctx.late, 'join-room', { clientId: 'c5', roomCode: 'FULL01', nickname: 'Too Late' }),
      { success: false, error: 'Game is already in progress.' }));
}

function hasSession(registration) {
  return registration?.success === true && Boolean(registration.sessionToken);
}

function requestOk(response, field, status) {
  return response?.success === true && response?.[field]?.status === status;
}

function inviteOk(invite, code) {
  return invite?.success === true && invite?.invite?.roomCode === code;
}

async function accountRegistrations(ctx) {
  ctx.sockA = await ctx.open();
  ctx.regA = await ctx.ask(ctx.sockA, 'account-register', { username: `rm_a_${RUN_TAG}`, displayName: 'Room Alice', password: 'Password123!' });
  ctx.check('account A registers with a session token', hasSession(ctx.regA) && Boolean(ctx.regA?.account?.id));
  ctx.sockB = await ctx.open();
  ctx.regB = await ctx.ask(ctx.sockB, 'account-register', { username: `rm_b_${RUN_TAG}`, displayName: 'Room Berta', password: 'Password123!' });
  ctx.check('account B registers with a session token', hasSession(ctx.regB));
  ctx.sockC = await ctx.open();
  ctx.regC = await ctx.ask(ctx.sockC, 'account-register', { username: `rm_c_${RUN_TAG}`, displayName: 'Room Cara', password: 'Password123!' });
  ctx.check('account C registers with a session token', hasSession(ctx.regC));
}

async function friendshipSetup(ctx) {
  const friendRequest = await ctx.ask(ctx.sockA, 'send-friend-request', { sessionToken: ctx.regA.sessionToken, targetAccountId: ctx.regB.account.id });
  ctx.check('A sends a friend request to B', requestOk(friendRequest, 'friendship', 'requested'));
  const friendResp = await ctx.ask(ctx.sockB, 'respond-friend-request', { sessionToken: ctx.regB.sessionToken, friendshipId: friendRequest.friendship.id, accept: true });
  ctx.check('B accepts the friend request', requestOk(friendResp, 'friendship', 'accepted'));
}

async function inviteRejections(ctx) {
  const { sockB, regB } = ctx;
  ctx.check('respond-room-invite without an account acks the exact sign-in error',
    ackEquals(await ctx.ask(ctx.anon, 'respond-room-invite', { inviteId: 'invite_nope', accept: true }),
      { success: false, error: 'Sign in to manage room invites.' }));
  ctx.check('respond-room-invite with a null payload still acks the sign-in error',
    ackEquals(await ctx.ask(ctx.anon, 'respond-room-invite', null),
      { success: false, error: 'Sign in to manage room invites.' }));
  ctx.check('accepting an unknown invite acks the exact expired error',
    ackEquals(await ctx.ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: 'invite_nope', accept: true }),
      { success: false, error: 'That room invite has expired.' }));
  ctx.check('declining an unknown invite acks the exact expired error',
    ackEquals(await ctx.ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: 'invite_nope', accept: false }),
      { success: false, error: 'That room invite has expired.' }));
}

async function inviteFixtures(ctx) {
  const { sockA, sockB, regA, regB } = ctx;
  ctx.check('A creates the invite fixture room INVT01',
    ackEquals(await ctx.ask(sockA, 'create-room', { sessionToken: regA.sessionToken, clientId: 'a-1', nickname: 'Ignored', visibility: 'private', roomCode: 'INVT01' }),
      { success: true, roomCode: 'INVT01', visibility: 'private' }));
  const inviteSent = await ctx.ask(sockA, 'send-room-invite', { sessionToken: regA.sessionToken, targetAccountId: regB.account.id });
  ctx.check('A invites friend B to the room', inviteOk(inviteSent, 'INVT01'));
  ctx.check('invite fixture host lowers capacity to two seats',
    ackEquals(await ctx.ask(sockA, 'set-setting', { key: 'maxPlayers', value: 2 }), { success: true }));
  ctx.check('B joins INVT01 by code first',
    ackEquals(await ctx.ask(sockB, 'join-room', { sessionToken: regB.sessionToken, clientId: 'b-1', roomCode: 'INVT01', nickname: 'Bee' }),
      { success: true, roomCode: 'INVT01', visibility: 'private' }));
}

async function inviteFullRoom(ctx) {
  const { sockB, regB } = ctx;
  const bSocial = await ctx.ask(sockB, 'get-social-data', { sessionToken: regB.sessionToken });
  const pendingInviteId = bSocial?.social?.invites?.[0]?.id;
  ctx.check('B sees the pending invite in social data', Boolean(pendingInviteId));
  ctx.check('accepting an invite to a now-full room acks the exact full error',
    ackEquals(await ctx.ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: pendingInviteId, accept: true, clientId: 'b-1' }),
      { success: false, error: 'That room is full.' }));
  const declined = await ctx.ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: pendingInviteId, accept: false });
  ctx.check('B can decline the invite instead', requestOk(declined, 'invite', 'declined'));
}

async function startedRoundRoom(ctx) {
  const { sockA, regA } = ctx;
  ctx.check('A creates a fresh private room STAR01 (auto-leaving INVT01)',
    ackEquals(await ctx.ask(sockA, 'create-room', { sessionToken: regA.sessionToken, clientId: 'a-1', nickname: 'Ignored', visibility: 'private', roomCode: 'STAR01' }),
      { success: true, roomCode: 'STAR01', visibility: 'private' }));
  ctx.check('A sizes STAR01 for a solo start with one bot',
    ackEquals(await ctx.ask(sockA, 'set-setting', { key: 'maxPlayers', value: 2 }), { success: true }));
  ctx.check('A queues one bot in STAR01',
    ackEquals(await ctx.ask(sockA, 'set-setting', { key: 'bots', value: 1 }), { success: true }));
  ctx.check('A starts the STAR01 game', ackEquals(await ctx.ask(sockA, 'start-game', {}), { success: true }));
}

async function startedRoundInviteError(ctx) {
  const { sockA, sockB, regA, regB } = ctx;
  const invite2 = await ctx.ask(sockA, 'send-room-invite', { sessionToken: regA.sessionToken, targetAccountId: regB.account.id });
  ctx.check('A invites B again into the started round', inviteOk(invite2, 'STAR01'));
  const bSocial2 = await ctx.ask(sockB, 'get-social-data', { sessionToken: regB.sessionToken });
  const startedInviteId = bSocial2?.social?.invites?.[0]?.id;
  ctx.check('accepting an invite to a started round acks the exact started error',
    ackEquals(await ctx.ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: startedInviteId, accept: true, clientId: 'b-2' }),
      { success: false, error: 'That round has already started.' }));
}

async function clientSessionRequired(ctx) {
  const { sockA, sockB, regA, regB } = ctx;
  ctx.check('B hosts a fresh joinable room OPEN01',
    ackEquals(await ctx.ask(sockB, 'create-room', { sessionToken: regB.sessionToken, clientId: 'b-1', nickname: 'Bee', visibility: 'private', roomCode: 'OPEN01' }),
      { success: true, roomCode: 'OPEN01', visibility: 'private' }));
  const invite3 = await ctx.ask(sockB, 'send-room-invite', { sessionToken: regB.sessionToken, targetAccountId: regA.account.id });
  ctx.check('B invites A into OPEN01', invite3?.success === true && invite3?.invite?.roomCode === 'OPEN01');
  ctx.check('accepting an invite without a clientId acks the exact client-session error',
    ackEquals(await ctx.ask(sockA, 'respond-room-invite', { sessionToken: regA.sessionToken, inviteId: invite3.invite.id, accept: true }),
      { success: false, error: 'A client session is required to join.' }));
}

async function matchHistoryPrivacy(ctx) {
  const { sockA, sockB, sockC, regA, regB, regC } = ctx;
  ctx.check('get-match-history with a null payload acks the exact not-found error',
    ackEquals(await ctx.ask(ctx.anon, 'get-match-history', null), { success: false, error: 'Player not found.' }));
  ctx.check('get-match-history for an unknown account acks the exact not-found error',
    ackEquals(await ctx.ask(ctx.anon, 'get-match-history', { accountId: 'acct_does_not_exist' }), { success: false, error: 'Player not found.' }));
  ctx.check('A sees their own empty history as an empty array',
    ackEquals(await ctx.ask(sockA, 'get-match-history', { sessionToken: regA.sessionToken }), { success: true, history: [] }));
  ctx.check('a stranger cannot read A history under the friends default',
    ackEquals(await ctx.ask(sockC, 'get-match-history', { sessionToken: regC.sessionToken, accountId: regA.account.id }),
      { success: false, error: 'Match history is visible to the owner and accepted friends.' }));
  ctx.check('an accepted friend can read A history',
    ackEquals(await ctx.ask(sockB, 'get-match-history', { sessionToken: regB.sessionToken, accountId: regA.account.id }), { success: true, history: [] }));
  ctx.check('A flips history privacy to private', (await ctx.ask(sockA, 'account-update', { sessionToken: regA.sessionToken, privacy: { history: 'private' } }))?.success === true);
  ctx.check('even friends are blocked once history is private',
    ackEquals(await ctx.ask(sockB, 'get-match-history', { sessionToken: regB.sessionToken, accountId: regA.account.id }),
      { success: false, error: 'This player keeps match history private.' }));
}

async function serverSurvival(ctx) {
  ctx.check('no uncaught exception was logged', !ctx.serverLog().includes('UNCAUGHT EXCEPTION'));
  ctx.check('server survived the whole rooms suite', ctx.child.exitCode === null);
}

const SCENARIOS = [
  validationAcks,
  privateCodeReservation,
  capacityAndRejoin,
  accountRegistrations,
  friendshipSetup,
  inviteRejections,
  inviteFixtures,
  inviteFullRoom,
  startedRoundRoom,
  startedRoundInviteError,
  clientSessionRequired,
  matchHistoryPrivacy,
  serverSurvival
];

async function run() {
  await withServer(async (ctx) => {
    for (const scenario of SCENARIOS) await scenario(ctx);
  });
}

const watchdog = setTimeout(() => {
  console.error('rooms tests: watchdog timeout');
  process.exit(1);
}, 90000);

run()
  .catch(error => {
    console.error('rooms tests crashed:', error);
    results.push({ name: 'run completed without throwing', ok: false });
  })
  .finally(() => {
    clearTimeout(watchdog);
    const failed = results.filter(result => !result.ok);
    console.log(`rooms tests: ${results.length - failed.length} passed, ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  });
