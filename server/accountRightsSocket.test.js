import assert from 'node:assert/strict';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';

const account = { id: 'acct-1', username: 'owner', displayName: 'Owner', accountDeactivated: false };
const callbacks = new Map();
const profileMutations = [];
const socket = { id: 'rights-socket', data: { sessionId: 'sess-1' }, rooms: new Set(), join() {}, leave() {}, emit() {} };
const runtime = {
  accountStore: {
    sessionAccount: token => token === 'legacy' ? account : null,
    sessionTokenHashFor: token => token === 'legacy' ? 'hash' : null,
    updateProfile: (token, patch) => {
      if (token !== 'legacy') return { success: false, error: 'Account session expired. Sign in again.' };
      profileMutations.push({ mode: 'bearer', token });
      return { success: true, account: { ...account, displayName: patch.displayName || account.displayName } };
    },
    updateProfileForAccount: (accountOrId, patch) => {
      if (!accountOrId) return { success: false, error: 'Account session expired. Sign in again.' };
      profileMutations.push({ mode: 'cookie', accountId: typeof accountOrId === 'string' ? accountOrId : accountOrId?.id });
      return { success: true, account: { ...account, displayName: patch.displayName || account.displayName } };
    },
    logout: () => ({ success: true })
  },
  roomManager: { getRoomBySocket: () => null },
  social: {
    accountForSocket: candidate => candidate.handshake?.headers?.cookie === 'poorup_session=valid' ? account : null
  },
  accountRights: {
    export: () => ({ success: true, filename: 'export.json', contentType: 'application/json', document: { schemaVersion: 1 } }),
    revokeSessions: () => ({ success: true, revoked: 2 }),
    requestDeletion: () => ({ success: true, state: 'pending', dueAt: '2026-10-17T12:00:00.000Z' }),
    cancelDeletion: () => ({ success: true, state: 'active' }),
    requestRecoveryEmail: () => ({ success: true, expiresAt: '2026-09-17T12:30:00.000Z' }),
    verifyRecoveryEmail: () => true
  },
  getRoomForSocket: () => null,
  emitRoomState() {}, scheduleRoomsUpdated() {}, leaveAllGameRooms() {}, detachSocketFromOtherRoom() {},
  clearDisconnectTimer() {}, reassignHostIfNeeded() {}, emitPendingInteractions() {},
  io: { in() { return { emit() {} }; } }
};
socket.handshake = { headers: { cookie: 'poorup_session=valid' } };
registerAccountSocketHandlers((event, handler) => callbacks.set(event, handler), socket, runtime);
const call = (event, payload = {}) => new Promise(resolve => callbacks.get(event)(payload, resolve));
assert.equal((await call('account-export', { sessionToken: 'legacy' })).success, true);
assert.equal((await call('account-revoke-sessions', { sessionToken: 'legacy' })).revoked, 2);
assert.equal((await call('account-delete-request', { sessionToken: 'legacy', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT' })).state, 'pending');
assert.equal((await call('account-delete-cancel', { sessionToken: 'legacy', currentPassword: 'pw' })).state, 'active');
assert.equal((await call('account-recovery-email-request', { sessionToken: 'legacy', currentPassword: 'pw', email: 'owner@example.test' })).success, true);
assert.equal((await call('account-recovery-email-verify', { token: 'opaque' })).success, true);
const cookieProfile = await call('account-update', { displayName: 'Cookie Owner' });
assert.equal(cookieProfile.success, true);
assert.equal(cookieProfile.account.displayName, 'Cookie Owner');
assert.deepEqual(profileMutations.at(-1), { mode: 'cookie', accountId: account.id });
const unauthenticatedCallbacks = new Map();
const unauthenticatedSocket = {
  id: 'unauthenticated-rights-socket',
  data: {},
  rooms: new Set(),
  handshake: { headers: { cookie: 'poorup_session=invalid' } },
  join() {}, leave() {}, emit() {}
};
registerAccountSocketHandlers((event, handler) => unauthenticatedCallbacks.set(event, handler), unauthenticatedSocket, runtime);
const callUnauthenticated = (event, payload = {}) => new Promise(resolve => unauthenticatedCallbacks.get(event)(payload, resolve));
const mutationCountBeforeUnauthenticatedUpdate = profileMutations.length;
const unauthenticatedProfile = await callUnauthenticated('account-update', { displayName: 'Intruder' });
assert.equal(unauthenticatedProfile.success, false);
assert.equal(unauthenticatedProfile.error, 'Account session expired. Sign in again.');
assert.equal(profileMutations.length, mutationCountBeforeUnauthenticatedUpdate, 'an invalid cookie cannot mutate a profile');
const bearerProfile = await call('account-update', { sessionToken: 'legacy', displayName: 'Bearer Owner' });
assert.equal(bearerProfile.success, true);
assert.equal(bearerProfile.account.displayName, 'Bearer Owner');
assert.deepEqual(profileMutations.at(-1), { mode: 'bearer', token: 'legacy' });
console.log('account rights socket: 12 passed, 0 failed');
