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

async function run() {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  child.stdout.on('data', chunk => { serverLog += chunk; });
  child.stderr.on('data', chunk => { serverLog += chunk; });
  const clientSockets = [];

  try {
    await waitForServer(child, 15000);

    // --- create-room / join-room input validation, exact acks -------------
    const anon = await openSocket(clientSockets);
    check('create-room without nickname acks the exact nickname error',
      ackEquals(await ask(anon, 'create-room', { clientId: 'anon-1' }),
        { success: false, error: 'Nickname is required.' }));
    check('create-room private with short code acks the exact invite-code error',
      ackEquals(await ask(anon, 'create-room', { clientId: 'anon-1', nickname: 'Solo', visibility: 'private', roomCode: 'AB' }),
        { success: false, error: 'Private rooms need a unique 6-character invite code.' }));
    check('create-room with null payload acks the nickname error (scaffold normalizes)',
      ackEquals(await ask(anon, 'create-room', null),
        { success: false, error: 'Nickname is required.' }));
    check('join-room without room code acks the exact room-code error',
      ackEquals(await ask(anon, 'join-room', { clientId: 'anon-1', nickname: 'Solo' }),
        { success: false, error: 'Room code is required.' }));
    check('join-room without nickname acks the exact nickname error',
      ackEquals(await ask(anon, 'join-room', { clientId: 'anon-1', roomCode: 'ZZZZZZ' }),
        { success: false, error: 'Nickname is required.' }));
    check('join-room unknown code acks the exact not-found error',
      ackEquals(await ask(anon, 'join-room', { clientId: 'anon-1', roomCode: 'QQQQQQ', nickname: 'Solo' }),
        { success: false, error: 'Room not found.' }));

    // --- private code reservation ---------------------------------------
    const host = await openSocket(clientSockets);
    check('create-room private normalizes the requested code and acks it',
      ackEquals(await ask(host, 'create-room', { clientId: 'c1', nickname: 'Host One', visibility: 'private', roomCode: 'ab 12cd!' }),
        { success: true, roomCode: 'AB12CD', visibility: 'private' }));
    const dupe = await openSocket(clientSockets);
    check('create-room on a taken private code acks the exact conflict error',
      ackEquals(await ask(dupe, 'create-room', { clientId: 'c2', nickname: 'Dupe', visibility: 'private', roomCode: 'AB12CD' }),
        { success: false, error: 'That private room code is already in use. Choose another.' }));
    check('leave-room for an unknown client still acks success',
      ackEquals(await ask(dupe, 'leave-room', { clientId: 'c2' }), { success: true }));

    // --- public create, join, capacity, rejoin ----------------------------
    check('create-room public acks a null room code and public visibility',
      ackEquals(await ask(host, 'create-room', { clientId: 'c1', nickname: 'Host One', visibility: 'garbage' }),
        { success: true, roomCode: null, visibility: 'public' }));
    const joiner = await openSocket(clientSockets);
    check('host can change settings before the game starts',
      ackEquals(await ask(host, 'set-setting', { key: 'maxPlayers', value: 2 }), { success: true }));
    // The public room has no visible code; create a fresh private fixture.
    check('create-room private FULL01 succeeds for the capacity fixture',
      ackEquals(await ask(host, 'create-room', { clientId: 'c1', nickname: 'Host One', visibility: 'private', roomCode: 'FULL01' }),
        { success: true, roomCode: 'FULL01', visibility: 'private' }));
    check('set-setting maxPlayers succeeds again in the new room',
      ackEquals(await ask(host, 'set-setting', { key: 'maxPlayers', value: 2 }), { success: true }));
    check('first guest joins the private room and gets the code back',
      ackEquals(await ask(joiner, 'join-room', { clientId: 'c3', roomCode: 'FULL01', nickname: 'Guest Three' }),
        { success: true, roomCode: 'FULL01', visibility: 'private' }));
    const late = await openSocket(clientSockets);
    check('joining a full room acks the exact room-full error',
      ackEquals(await ask(late, 'join-room', { clientId: 'c4', roomCode: 'FULL01', nickname: 'Late Guest' }),
        { success: false, error: 'Room is full.' }));
    check('the same client can rejoin its existing seat',
      ackEquals(await ask(joiner, 'join-room', { clientId: 'c3', roomCode: 'FULL01', nickname: 'Guest Three' }),
        { success: true, roomCode: 'FULL01', visibility: 'private' }));
    check('host can queue one bot via settings',
      ackEquals(await ask(host, 'set-setting', { key: 'bots', value: 1 }), { success: true }));
    check('host can start the game', ackEquals(await ask(host, 'start-game', {}), { success: true }));
    check('joining a started room acks the exact in-progress error',
      ackEquals(await ask(late, 'join-room', { clientId: 'c5', roomCode: 'FULL01', nickname: 'Too Late' }),
        { success: false, error: 'Game is already in progress.' }));

    // --- accounts for the invite + history flows --------------------------
    const sockA = await openSocket(clientSockets);
    const regA = await ask(sockA, 'account-register', { username: `rm_a_${RUN_TAG}`, displayName: 'Room Alice', password: 'Password123!' });
    check('account A registers with a session token', regA?.success === true && Boolean(regA?.sessionToken) && Boolean(regA?.account?.id));
    const sockB = await openSocket(clientSockets);
    const regB = await ask(sockB, 'account-register', { username: `rm_b_${RUN_TAG}`, displayName: 'Room Berta', password: 'Password123!' });
    check('account B registers with a session token', regB?.success === true && Boolean(regB?.sessionToken));
    const sockC = await openSocket(clientSockets);
    const regC = await ask(sockC, 'account-register', { username: `rm_c_${RUN_TAG}`, displayName: 'Room Cara', password: 'Password123!' });
    check('account C registers with a session token', regC?.success === true && Boolean(regC?.sessionToken));

    const friendRequest = await ask(sockA, 'send-friend-request', { sessionToken: regA.sessionToken, targetAccountId: regB.account.id });
    check('A sends a friend request to B', friendRequest?.success === true && friendRequest?.friendship?.status === 'requested');
    const friendResp = await ask(sockB, 'respond-friend-request', { sessionToken: regB.sessionToken, friendshipId: friendRequest.friendship.id, accept: true });
    check('B accepts the friend request', friendResp?.success === true && friendResp?.friendship?.status === 'accepted');

    // --- respond-room-invite validation and lifecycle ----------------------
    check('respond-room-invite without an account acks the exact sign-in error',
      ackEquals(await ask(anon, 'respond-room-invite', { inviteId: 'invite_nope', accept: true }),
        { success: false, error: 'Sign in to manage room invites.' }));
    check('respond-room-invite with a null payload still acks the sign-in error',
      ackEquals(await ask(anon, 'respond-room-invite', null),
        { success: false, error: 'Sign in to manage room invites.' }));
    check('accepting an unknown invite acks the exact expired error',
      ackEquals(await ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: 'invite_nope', accept: true }),
        { success: false, error: 'That room invite has expired.' }));
    check('declining an unknown invite acks the exact expired error',
      ackEquals(await ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: 'invite_nope', accept: false }),
        { success: false, error: 'That room invite has expired.' }));

    check('A creates the invite fixture room INVT01',
      ackEquals(await ask(sockA, 'create-room', { sessionToken: regA.sessionToken, clientId: 'a-1', nickname: 'Ignored', visibility: 'private', roomCode: 'INVT01' }),
        { success: true, roomCode: 'INVT01', visibility: 'private' }));
    const inviteSent = await ask(sockA, 'send-room-invite', { sessionToken: regA.sessionToken, targetAccountId: regB.account.id });
    check('A invites friend B to the room', inviteSent?.success === true && inviteSent?.invite?.roomCode === 'INVT01');
    check('invite fixture host lowers capacity to two seats',
      ackEquals(await ask(sockA, 'set-setting', { key: 'maxPlayers', value: 2 }), { success: true }));
    check('B joins INVT01 by code first',
      ackEquals(await ask(sockB, 'join-room', { sessionToken: regB.sessionToken, clientId: 'b-1', roomCode: 'INVT01', nickname: 'Bee' }),
        { success: true, roomCode: 'INVT01', visibility: 'private' }));
    const bSocial = await ask(sockB, 'get-social-data', { sessionToken: regB.sessionToken });
    const pendingInviteId = bSocial?.social?.invites?.[0]?.id;
    check('B sees the pending invite in social data', Boolean(pendingInviteId));
    check('accepting an invite to a now-full room acks the exact full error',
      ackEquals(await ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: pendingInviteId, accept: true, clientId: 'b-1' }),
        { success: false, error: 'That room is full.' }));
    const declined = await ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: pendingInviteId, accept: false });
    check('B can decline the invite instead', declined?.success === true && declined?.invite?.status === 'declined');

    // --- started-round invite rejection ------------------------------------
    check('A creates a fresh private room STAR01 (auto-leaving INVT01)',
      ackEquals(await ask(sockA, 'create-room', { sessionToken: regA.sessionToken, clientId: 'a-1', nickname: 'Ignored', visibility: 'private', roomCode: 'STAR01' }),
        { success: true, roomCode: 'STAR01', visibility: 'private' }));
    check('A sizes STAR01 for a solo start with one bot',
      ackEquals(await ask(sockA, 'set-setting', { key: 'maxPlayers', value: 2 }), { success: true }));
    check('A queues one bot in STAR01',
      ackEquals(await ask(sockA, 'set-setting', { key: 'bots', value: 1 }), { success: true }));
    check('A starts the STAR01 game', ackEquals(await ask(sockA, 'start-game', {}), { success: true }));
    const invite2 = await ask(sockA, 'send-room-invite', { sessionToken: regA.sessionToken, targetAccountId: regB.account.id });
    check('A invites B again into the started round', invite2?.success === true && invite2?.invite?.roomCode === 'STAR01');
    const bSocial2 = await ask(sockB, 'get-social-data', { sessionToken: regB.sessionToken });
    const startedInviteId = bSocial2?.social?.invites?.[0]?.id;
    check('accepting an invite to a started round acks the exact started error',
      ackEquals(await ask(sockB, 'respond-room-invite', { sessionToken: regB.sessionToken, inviteId: startedInviteId, accept: true, clientId: 'b-2' }),
        { success: false, error: 'That round has already started.' }));
    check('accepting an invite without a clientId acks the exact client-session error',
      await (async () => {
        check('B hosts a fresh joinable room OPEN01',
          ackEquals(await ask(sockB, 'create-room', { sessionToken: regB.sessionToken, clientId: 'b-1', nickname: 'Bee', visibility: 'private', roomCode: 'OPEN01' }),
            { success: true, roomCode: 'OPEN01', visibility: 'private' }));
        const invite3 = await ask(sockB, 'send-room-invite', { sessionToken: regB.sessionToken, targetAccountId: regA.account.id });
        check('B invites A into OPEN01', invite3?.success === true && invite3?.invite?.roomCode === 'OPEN01');
        return ackEquals(await ask(sockA, 'respond-room-invite', { sessionToken: regA.sessionToken, inviteId: invite3.invite.id, accept: true }),
          { success: false, error: 'A client session is required to join.' });
      })());

    // --- get-match-history -------------------------------------------------
    check('get-match-history with a null payload acks the exact not-found error',
      ackEquals(await ask(anon, 'get-match-history', null), { success: false, error: 'Player not found.' }));
    check('get-match-history for an unknown account acks the exact not-found error',
      ackEquals(await ask(anon, 'get-match-history', { accountId: 'acct_does_not_exist' }), { success: false, error: 'Player not found.' }));
    check('A sees their own empty history as an empty array',
      ackEquals(await ask(sockA, 'get-match-history', { sessionToken: regA.sessionToken }), { success: true, history: [] }));
    check('a stranger cannot read A history under the friends default',
      ackEquals(await ask(sockC, 'get-match-history', { sessionToken: regC.sessionToken, accountId: regA.account.id }),
        { success: false, error: 'Match history is visible to the owner and accepted friends.' }));
    check('an accepted friend can read A history',
      ackEquals(await ask(sockB, 'get-match-history', { sessionToken: regB.sessionToken, accountId: regA.account.id }), { success: true, history: [] }));
    check('A flips history privacy to private', (await ask(sockA, 'account-update', { sessionToken: regA.sessionToken, privacy: { history: 'private' } }))?.success === true);
    check('even friends are blocked once history is private',
      ackEquals(await ask(sockB, 'get-match-history', { sessionToken: regB.sessionToken, accountId: regA.account.id }),
        { success: false, error: 'This player keeps match history private.' }));

    check('no uncaught exception was logged', !serverLog.includes('UNCAUGHT EXCEPTION'));
    check('server survived the whole rooms suite', child.exitCode === null);
  } finally {
    for (const socket of clientSockets) socket.close();
    child.kill();
  }
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
