import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';

const RATE_LIMITED = 'Too many account attempts. Try again shortly.';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-auth-abuse-'));
const store = new AccountStore(path.join(root, 'accounts.json'));
store.register({ username: 'victim01', password: 'victim-pass-1', displayName: 'Victim' });
store.register({ username: 'attacker1', password: 'attacker-pass-1', displayName: 'Attacker' });

const accountRights = {
  cancelDeletion: ({ accountId, currentPassword }) => (
    store.verifyPassword(store.getAccountById(accountId), currentPassword)
      ? { success: true, state: 'active' }
      : { success: false, code: 'ACCOUNT_CONFIRMATION_INVALID', error: 'Password confirmation failed.' }
  ),
  requestRecoveryEmail: ({ accountId, currentPassword }) => (
    store.verifyPassword(store.getAccountById(accountId), currentPassword)
      ? { success: true, expiresAt: '2026-10-12T12:30:00.000Z' }
      : { success: false, code: 'RECOVERY_REQUEST_INVALID' }
  ),
};
const runtime = {
  accountStore: store,
  accountRights,
  roomManager: { getRoomBySocket: () => null, rooms: new Map() },
  social: { accountForSocket: socket => (socket.data.accountId ? store.getAccountById(socket.data.accountId) : null) },
  getRoomForSocket: () => null,
  emitRoomState() {}, scheduleRoomsUpdated() {}, leaveAllGameRooms() {}, detachSocketFromOtherRoom() {},
  clearDisconnectTimer() {}, reassignHostIfNeeded() {}, emitPendingInteractions() {},
  io: { in() { return { emit() {} }; } },
};

function connectWithRuntime(activeRuntime, id, address) {
  const socket = { id, data: {}, rooms: new Set(), handshake: { address, headers: {} }, join() {}, leave() {}, emit() {} };
  const handlers = new Map();
  registerAccountSocketHandlers((event, handler) => handlers.set(event, handler), socket, activeRuntime);
  const call = (event, payload = {}) => new Promise(resolve => handlers.get(event)(payload, resolve));
  return { socket, call };
}

function connect(id, address) {
  return connectWithRuntime(runtime, id, address);
}

// F-042: a successful login to the attacker's own account must not reset the
// per-IP attempt budget that is being spent guessing the victim's password.
const attacker = connect('attacker-socket', '203.0.113.20');
let processed = 0;
let limited = 0;
for (let cycle = 0; cycle < 3; cycle += 1) {
  for (let guess = 0; guess < 7; guess += 1) {
    const result = await attacker.call('account-login', { username: 'victim01', password: `wrong-${cycle}-${guess}` });
    if (result.error === RATE_LIMITED) limited += 1;
    else processed += 1;
  }
  await attacker.call('account-login', { username: 'attacker1', password: 'attacker-pass-1' });
}
assert.ok(limited > 0, 'interleaved own-account logins must not reset the IP budget');
assert.ok(processed <= 8, `at most the window budget is processed (processed ${processed})`);

// F-042: per-account lockout applies across addresses, so rotating IPs cannot
// keep guessing one account.
for (let index = 0; index < 10; index += 1) {
  const guesser = connect(`guess-${index}`, `198.51.100.${index + 1}`);
  const result = await guesser.call('account-login', { username: 'victim01', password: `rotating-${index}` });
  assert.equal(result.success, false);
}
const owner = connect('owner-socket', '192.0.2.10');
const lockedOut = await owner.call('account-login', { username: 'victim01', password: 'victim-pass-1' });
assert.equal(lockedOut.success, false, 'a correct password is refused while the account is locked');
assert.equal(lockedOut.code, 'ACCOUNT_LOCKED');

// A successful password check clears only that account's failure count.
for (let index = 0; index < 9; index += 1) {
  const guesser = connect(`cleared-${index}`, `198.51.101.${index + 1}`);
  await guesser.call('account-login', { username: 'attacker1', password: `nope-${index}` });
}
const recovered = await connect('attacker-owner', '198.51.102.1').call('account-login', { username: 'attacker1', password: 'attacker-pass-1' });
assert.equal(recovered.success, true, 'nine failures do not lock the account');
for (let index = 0; index < 9; index += 1) {
  const guesser = connect(`after-${index}`, `198.51.103.${index + 1}`);
  await guesser.call('account-login', { username: 'attacker1', password: `again-${index}` });
}
const stillOpen = await connect('attacker-again', '198.51.104.1').call('account-login', { username: 'attacker1', password: 'attacker-pass-1' });
assert.equal(stillOpen.success, true, 'a successful login resets that account failure count');

// F-046: every password-checking socket event draws from the same budget.
const cancelling = connect('cancel-socket', '192.0.2.77');
await cancelling.call('account-login', { username: 'attacker1', password: 'attacker-pass-1' });
let cancelProcessed = 0;
let cancelLimited = 0;
for (let index = 0; index < 12; index += 1) {
  const result = await cancelling.call('account-delete-cancel', { currentPassword: `bad-${index}`, requestId: 'r1' });
  if (result.error === RATE_LIMITED) cancelLimited += 1;
  else cancelProcessed += 1;
}
assert.ok(cancelLimited > 0, 'delete-cancel password checks are rate limited');
assert.ok(cancelProcessed <= 8, `delete-cancel checks stay inside the budget (processed ${cancelProcessed})`);

// E24-10: an unknown username pays the same scrypt as a known one, so response
// time does not reveal which usernames exist.
const realScrypt = crypto.scryptSync;
let scryptRuns = 0;
crypto.scryptSync = (...args) => { scryptRuns += 1; return realScrypt(...args); };
try {
  store.login({ username: 'no-such-person', password: 'some-password' });
  const unknownRuns = scryptRuns;
  scryptRuns = 0;
  store.login({ username: 'attacker1', password: 'wrong-password-1' });
  assert.equal(unknownRuns, 1, 'an unknown username runs one scrypt');
  assert.equal(scryptRuns, 1, 'a known username with a wrong password runs one scrypt');
} finally {
  crypto.scryptSync = realScrypt;
}

// E24-10: username availability is rate limited per address, so the endpoint
// cannot be walked to enumerate accounts at socket speed.
const probing = connect('probe-socket', '198.51.110.7');
let availabilityLimited = 0;
for (let index = 0; index < 40; index += 1) {
  const result = await probing.call('check-username', { username: `probe${index}` });
  if (result.success === false) availabilityLimited += 1;
}
assert.ok(availabilityLimited >= 10, `check-username is rate limited per address (limited ${availabilityLimited})`);
assert.equal((await connect('probe-other', '198.51.110.8').call('check-username', { username: 'free-name' })).success, true, 'another address keeps its own budget');

// E24-09: a pending-deletion account may still sign in to cancel the deletion,
// but login must not seat it at a lobby table.
store.register({ username: 'pending01', password: 'pending-pass-1', displayName: 'Pending' });
store.register({ username: 'active01', password: 'active-pass-1', displayName: 'Active' });
const pendingAccount = store.findAccountByUsername('pending01');
Object.assign(pendingAccount, { deletionRequestedAt: new Date().toISOString(), deletionDueAt: new Date(Date.now() + 86400000).toISOString(), accountDeactivated: true });
const lobbyPlayer = { id: 'lobby-seat', socketId: 'lobby-socket', accountId: null, disconnected: false, bankrupt: false };
const lobbyRoom = {
  visibility: 'public',
  game: { started: false, players: [lobbyPlayer], setPlayerAppearance() {} },
  getPlayerBySocket: socketId => (socketId === lobbyPlayer.socketId ? lobbyPlayer : null),
};
const lobbyRuntime = { ...runtime, roomManager: { getRoomBySocket: socketId => (socketId === lobbyPlayer.socketId ? lobbyRoom : null), rooms: new Map([['lobby', lobbyRoom]]) } };
const lobbySocket = connectWithRuntime(lobbyRuntime, 'lobby-socket', '203.0.113.120');
assert.equal((await lobbySocket.call('account-login', { username: 'pending01', password: 'pending-pass-1' })).success, true, 'a pending account can still sign in');
assert.equal(lobbyPlayer.accountId, null, 'a pending account is not bound to a lobby seat by login');
assert.equal((await lobbySocket.call('account-login', { username: 'active01', password: 'active-pass-1' })).success, true);
assert.equal(lobbyPlayer.accountId, store.findAccountByUsername('active01').id, 'an active account still binds to its lobby seat');

fs.rmSync(root, { recursive: true, force: true });
console.log('account auth abuse: 17 passed, 0 failed');
