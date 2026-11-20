// New records store their scrypt cost. Records written before that still
// verify with the old cost and move to the current one at the next correct
// sign-in.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { CURRENT_SCRYPT, LEGACY_SCRYPT, hashPassword, scryptParamsFor } from './accountSecurity.js';

const file = path.join(os.tmpdir(), `poorup-kdf-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
try {
  const store = new AccountStore(file);
  const registered = store.register({ username: 'modern', displayName: 'Modern', password: 'a-long-password' });
  const modern = store.accounts.get('modern');
  assert.deepEqual(modern.passwordKdf, CURRENT_SCRYPT, 'a new record stores the current cost');
  assert.equal(modern.passwordHash, hashPassword('a-long-password', modern.passwordSalt, CURRENT_SCRYPT));
  assert.equal(store.login({ username: 'modern', password: 'a-long-password' }).success, true);
  assert.equal(store.login({ username: 'modern', password: 'a-wrong-password' }).success, false);
  console.log('PASS new records store and use the current cost');

  // A legacy record: no parameters, hash made with the old defaults.
  const legacy = store.accounts.get('modern');
  const salt = crypto.randomBytes(16).toString('hex');
  legacy.passwordSalt = salt;
  legacy.passwordHash = crypto.scryptSync('a-long-password', salt, 64).toString('hex');
  delete legacy.passwordKdf;
  assert.deepEqual(scryptParamsFor(legacy), LEGACY_SCRYPT);
  assert.equal(store.verifyPassword(legacy, 'a-long-password'), true, 'a legacy hash still verifies');
  assert.equal(store.verifyPassword(legacy, 'a-wrong-password'), false);
  assert.equal(legacy.passwordKdf, undefined, 'verifyPassword alone does not rewrite the record');
  const oldHash = legacy.passwordHash;

  assert.equal(store.login({ username: 'modern', password: 'a-wrong-password' }).success, false);
  assert.equal(legacy.passwordHash, oldHash, 'a wrong password never upgrades the record');
  assert.equal(store.login({ username: 'modern', password: 'a-long-password' }).success, true, 'a legacy record signs in');
  assert.deepEqual(legacy.passwordKdf, CURRENT_SCRYPT, 'the record moved to the current cost');
  assert.notEqual(legacy.passwordHash, oldHash);
  assert.notEqual(legacy.passwordSalt, salt, 'the upgrade uses a fresh salt');
  assert.equal(store.login({ username: 'modern', password: 'a-long-password' }).success, true, 'it still signs in after the upgrade');
  console.log('PASS legacy hashes verify and upgrade on a correct sign-in');

  // The upgraded record survives a reload.
  const reloaded = new AccountStore(file);
  assert.deepEqual(reloaded.accounts.get('modern').passwordKdf, CURRENT_SCRYPT);
  assert.equal(reloaded.login({ username: 'modern', password: 'a-long-password' }).success, true);
  console.log('PASS the stored cost persists across a reload');

  // Tampered parameters fall back to the legacy cost instead of exhausting memory.
  assert.deepEqual(scryptParamsFor({ passwordKdf: { N: 2 ** 30, r: 8, p: 1 } }), LEGACY_SCRYPT);
  assert.deepEqual(scryptParamsFor({ passwordKdf: { N: 1000, r: 8, p: 1 } }), LEGACY_SCRYPT, 'N must be a power of two');
  assert.deepEqual(scryptParamsFor({ passwordKdf: 'x' }), LEGACY_SCRYPT);
  console.log('PASS out-of-range stored parameters are ignored');
  void registered;
} finally {
  fs.rmSync(file, { force: true });
}
