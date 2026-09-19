import assert from 'node:assert/strict';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';

const account = { id: 'acct-1', username: 'owner', displayName: 'Owner', accountDeactivated: false };
const callbacks = new Map();
const socket = { id: 'rights-socket', data: { sessionId: 'sess-1' }, rooms: new Set(), join() {}, leave() {}, emit() {} };
const runtime = {
  accountStore: {
    sessionAccount: token => token === 'legacy' ? account : null,
    sessionTokenHashFor: () => 'hash',
    updateProfile: () => ({ success: true, account }),
    logout: () => ({ success: true })
  },
  roomManager: { getRoomBySocket: () => null },
  social: { accountForSocket: () => account },
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
registerAccountSocketHandlers((event, handler) => callbacks.set(event, handler), socket, runtime);
const call = (event, payload = {}) => new Promise(resolve => callbacks.get(event)(payload, resolve));
assert.equal((await call('account-export', { sessionToken: 'legacy' })).success, true);
assert.equal((await call('account-revoke-sessions', { sessionToken: 'legacy' })).revoked, 2);
assert.equal((await call('account-delete-request', { sessionToken: 'legacy', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT' })).state, 'pending');
assert.equal((await call('account-delete-cancel', { sessionToken: 'legacy', currentPassword: 'pw' })).state, 'active');
assert.equal((await call('account-recovery-email-request', { sessionToken: 'legacy', currentPassword: 'pw', email: 'owner@example.test' })).success, true);
assert.equal((await call('account-recovery-email-verify', { token: 'opaque' })).success, true);
console.log('account rights socket: 6 passed, 0 failed');
