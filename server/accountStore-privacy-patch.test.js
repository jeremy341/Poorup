// A partial privacy patch merges into the stored settings. It must not
// reset the keys it leaves out to their defaults (which can loosen privacy).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AccountStore } from './accountStore.js';

const filePath = path.join(os.tmpdir(), `poorup-account-privacy-${crypto.randomUUID()}.json`);
try {
  const store = new AccountStore(filePath);
  const { sessionToken, account } = store.register({ username: 'privacypatch', displayName: 'Privacy', password: 'long-enough-password' });
  const strict = { history: 'private', achievements: 'private', friendRequests: 'nobody', roomInvites: 'nobody' };
  assert.equal(store.updateProfile(sessionToken, { privacy: strict }).success, true);
  assert.deepEqual(store.getAccountById(account.id).privacy, strict);

  assert.equal(store.updateProfile(sessionToken, { privacy: { history: 'public' } }).success, true);
  assert.deepEqual(store.getAccountById(account.id).privacy, { ...strict, history: 'public' }, 'only the patched key changes');

  assert.equal(store.updateProfile(sessionToken, { privacy: { roomInvites: 'friends', friendRequests: 'bogus' } }).success, true);
  const after = store.getAccountById(account.id).privacy;
  assert.equal(after.roomInvites, 'friends');
  assert.equal(after.history, 'public', 'untouched keys survive a second partial patch');
  assert.equal(after.achievements, 'private');
  assert.equal(after.friendRequests, 'everyone', 'an invalid value still falls back to the default');
  console.log('account store privacy patch: passed');
} finally {
  fs.rmSync(filePath, { force: true });
}
