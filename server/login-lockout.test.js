// Sign-in lockout is counted per (username, source). One address cannot lock
// the real owner out, unknown names get the same answers as known ones, and a
// cap across all sources still bounds guessing from many addresses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { ACCOUNT_FAILURE_LIMIT, LoginFailureTracker, SOURCE_FAILURE_LIMIT } from './loginFailures.js';

const GOOD = 'correct-horse-battery';
const WRONG = 'definitely-wrong-guess';

function freshStore() {
  const file = path.join(os.tmpdir(), `poorup-lockout-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const store = new AccountStore(file);
  store.register({ username: 'owner', displayName: 'Owner', password: GOOD });
  return { store, file };
}

const { store, file } = freshStore();
try {
  // One attacker address locks only itself.
  for (let i = 0; i < SOURCE_FAILURE_LIMIT; i += 1) {
    const result = store.login({ username: 'owner', password: WRONG }, { source: 'attacker' });
    assert.equal(result.success, false);
  }
  assert.equal(store.login({ username: 'owner', password: GOOD }, { source: 'attacker' }).code, 'ACCOUNT_LOCKED', 'the attacking source is locked');
  assert.equal(store.login({ username: 'owner', password: GOOD }, { source: 'owner-home' }).success, true, 'the owner still signs in from another source');
  console.log('PASS one source cannot lock the owner out of other sources');

  // A known name and an unknown name look the same once a source is locked.
  for (let i = 0; i < SOURCE_FAILURE_LIMIT; i += 1) store.login({ username: 'nobody-here', password: WRONG }, { source: 'attacker' });
  const known = store.login({ username: 'owner', password: WRONG }, { source: 'attacker' });
  const unknown = store.login({ username: 'nobody-here', password: WRONG }, { source: 'attacker' });
  assert.deepEqual({ ...known }, { ...unknown }, 'locked answers match for known and unknown names');
  console.log('PASS the lock response does not reveal whether a username exists');

  // Failures spread over many sources still hit the account-wide cap, and the
  // answer stays generic instead of announcing a lock.
  const spread = freshStore();
  for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i += 1) spread.store.login({ username: 'owner', password: WRONG }, { source: `bot-${i}` });
  const refused = spread.store.login({ username: 'owner', password: GOOD }, { source: 'fresh-source' });
  assert.equal(refused.success, false, 'the all-sources cap refuses even a correct password');
  assert.equal(refused.code, undefined);
  assert.equal(refused.error, 'Username or password is incorrect.');
  const reset = spread.store.getAccountById(spread.store.accounts.get('owner').id);
  assert.equal(spread.store.updatePassword(reset.id, 'brand-new-password'), true);
  assert.equal(spread.store.login({ username: 'owner', password: 'brand-new-password' }, { source: 'fresh-source' }).success, true, 'a password reset lifts the all-sources cap');
  fs.rmSync(spread.file, { force: true });
  console.log('PASS the all-sources cap bounds distributed guessing and a reset lifts it');

  // A correct password clears the source's failures.
  const clear = freshStore();
  for (let i = 0; i < SOURCE_FAILURE_LIMIT - 1; i += 1) clear.store.login({ username: 'owner', password: WRONG }, { source: 'home' });
  assert.equal(clear.store.login({ username: 'owner', password: GOOD }, { source: 'home' }).success, true);
  for (let i = 0; i < SOURCE_FAILURE_LIMIT - 1; i += 1) clear.store.login({ username: 'owner', password: WRONG }, { source: 'home' });
  assert.equal(clear.store.login({ username: 'owner', password: GOOD }, { source: 'home' }).success, true, 'success reset the count');
  fs.rmSync(clear.file, { force: true });
  console.log('PASS a correct password clears the failure count');

  // Without a source the old single-bucket behaviour still locks.
  const bare = freshStore();
  let locked = null;
  for (let i = 0; i < SOURCE_FAILURE_LIMIT + 2 && !locked; i += 1) {
    const result = bare.store.login({ username: 'owner', password: WRONG });
    if (result.code === 'ACCOUNT_LOCKED') locked = result;
  }
  assert.ok(locked, 'sourceless callers share one bucket');
  fs.rmSync(bare.file, { force: true });
  console.log('PASS callers without a source share one bucket');

  // The window expires.
  let clock = 1_000;
  const tracker = new LoginFailureTracker({ now: () => clock, sourceLimit: 3, accountLimit: 5, windowMs: 1_000 });
  for (let i = 0; i < 3; i += 1) tracker.recordFailure('a', 's');
  assert.equal(tracker.sourceLocked('a', 's'), true);
  clock += 1_001;
  assert.equal(tracker.sourceLocked('a', 's'), false, 'the lock lapses after the window');
  console.log('PASS the lock lapses after the window');

  // Memory is bounded for both usernames and sources.
  const small = new LoginFailureTracker({ maxNames: 3 });
  for (let i = 0; i < 20; i += 1) small.recordFailure(`name-${i}`, 's');
  assert.equal(small.size, 3, 'the username table stays bounded');
  const wide = new LoginFailureTracker();
  for (let i = 0; i < 500; i += 1) wide.recordFailure('one', `src-${i}`);
  assert.ok(wide.names.get('one').sources.size <= 50, 'the per-name source table stays bounded');
  console.log('PASS failure tables are bounded');
} finally {
  fs.rmSync(file, { force: true });
}
