import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionStore, parseCookieHeader } from './sessionStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-session-store-'));
let now = Date.parse('2026-09-17T12:00:00.000Z');
const store = createSessionStore({
  filePath: path.join(root, 'sessions.json'),
  now: () => now,
  idleTtlMs: 30 * 86400000,
  absoluteTtlMs: 90 * 86400000,
});

const first = store.issue('acct-1', { userAgentClass: 'desktop', ipClass: 'net-a' });
assert.equal(typeof first.cookieValue, 'string');
assert.equal(fs.readFileSync(path.join(root, 'sessions.json'), 'utf8').includes(first.cookieValue), false);
assert.equal(store.resolve(first.cookieValue).accountId, 'acct-1');
assert.match(store.cookie(first.cookieValue), /HttpOnly/);
assert.match(store.cookie(first.cookieValue), /Secure/);
assert.match(store.cookie(first.cookieValue), /SameSite=Lax/);
assert.equal(parseCookieHeader(`x=1; poorup_session=${first.cookieValue}; y=2`).poorup_session, first.cookieValue);

const second = store.issue('acct-1', { userAgentClass: 'mobile', ipClass: 'net-b' });
assert.equal(store.resolve(first.cookieValue).accountId, 'acct-1', 'independent devices remain signed in');
assert.equal(store.revokeOthers(second.sessionId), 1);
assert.equal(store.resolve(first.cookieValue), null);
assert.equal(store.resolve(second.cookieValue).accountId, 'acct-1');

now += 31 * 86400000;
assert.equal(store.resolve(second.cookieValue), null, 'idle expiry is enforced');
const third = store.issue('acct-1');
now += 90 * 86400000;
assert.equal(store.resolve(third.cookieValue), null, 'absolute expiry is enforced');

const victim = store.issue('acct-2');
const survivor = store.issue('acct-2');
assert.equal(store.revokeAllForAccount('acct-2'), 2);
assert.equal(store.resolve(victim.cookieValue), null);
assert.equal(store.resolve(survivor.cookieValue), null);
assert.equal(store.revokeAllForAccount('acct-2'), 0);
assert.equal(store.revokeAllForAccount(''), 0);

// A legacy exchange keeps a private token-hash lineage on disk. Logout can
// revoke sessions created by that token after a restart without touching an
// unrelated session for the same account.
{
  const lineageFile = path.join(root, 'legacy-lineage.json');
  const legacyToken = 'legacy-token-for-lineage-test';
  const writer = createSessionStore({ filePath: lineageFile, now: () => now });
  const exchanged = writer.exchangeLegacy(legacyToken, token => token === legacyToken ? 'acct-lineage' : null);
  const unrelated = writer.issue('acct-lineage');
  assert.ok(exchanged);
  const lineageDisk = fs.readFileSync(lineageFile, 'utf8');
  assert.equal(lineageDisk.includes(legacyToken), false, 'legacy bearer tokens are not persisted in plaintext');
  assert.equal(JSON.parse(lineageDisk).find(record => record.sessionId === exchanged.sessionId).legacyTokenHash.length, 64, 'only a SHA-256 lineage value is persisted');
  assert.equal(Object.hasOwn(writer.snapshot().find(record => record.sessionId === exchanged.sessionId), 'legacyTokenHash'), false, 'lineage hashes do not appear in session snapshots');
  writer.close();

  const reloaded = createSessionStore({ filePath: lineageFile, now: () => now });
  assert.equal(reloaded.revokeLegacyTokenSessions(legacyToken), 1, 'the legacy token revokes its exchanged session after restart');
  assert.equal(reloaded.resolve(exchanged.cookieValue), null);
  assert.equal(reloaded.resolve(unrelated.cookieValue).accountId, 'acct-lineage', 'ordinary logout does not revoke every account session');
  reloaded.close();
}

// Revoking "other" sessions must not depend on the caller having a cookie
// session: with none, every cookie session of the account goes.
const keeper = store.issue('acct-3');
const stray = store.issue('acct-3');
const bystander = store.issue('acct-4');
assert.equal(store.revokeAccountSessionsExcept('acct-3', null), 2, 'no caller cookie session: all of the account goes');
assert.equal(store.resolve(keeper.cookieValue), null);
assert.equal(store.resolve(stray.cookieValue), null);
assert.equal(store.resolve(bystander.cookieValue).accountId, 'acct-4', 'other accounts are untouched');
const caller = store.issue('acct-5');
const otherDevice = store.issue('acct-5');
assert.equal(store.revokeAccountSessionsExcept('acct-5', caller.sessionId), 1, 'the caller session is kept');
assert.equal(store.resolve(caller.cookieValue).accountId, 'acct-5');
assert.equal(store.resolve(otherDevice.cookieValue), null);

// E37-14: expired cookie sessions do not accumulate. They are swept when the
// store loads and by a timer, so they are not rewritten to disk indefinitely.
{
  const sweepFile = path.join(root, 'sweep-sessions.json');
  let clock = now;
  const writer = createSessionStore({ filePath: sweepFile, now: () => clock });
  const stale = writer.issue('acct-stale');
  clock += 31 * 86400000;
  const live = writer.issue('acct-live');
  const reloaded = createSessionStore({ filePath: sweepFile, now: () => clock });
  assert.equal(reloaded.size(), 1, 'a load drops sessions that expired');
  assert.equal(reloaded.resolve(stale.cookieValue), null);
  assert.equal(reloaded.resolve(live.cookieValue).accountId, 'acct-live');
  const onDisk = JSON.parse(fs.readFileSync(sweepFile, 'utf8'));
  assert.equal(onDisk.length, 1, 'the expired session is also gone from disk');
  reloaded.close();

  // The timer sweeps sessions that expire while the store is running.
  let timerClock = now;
  const running = createSessionStore({ filePath: path.join(root, 'timer-sessions.json'), now: () => timerClock, sweepIntervalMs: 1000 });
  running.issue('acct-soon');
  timerClock += 31 * 86400000;
  running.issue('acct-later');
  assert.equal(running.size(), 2, 'nothing is swept until the timer or a load runs');
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(running.size(), 1, 'the timer sweeps expired sessions');
  running.close();
}

// A failed write while resolving must not throw: resolve() is a read, called
// from the socket handshake, where an escaped throw ends the process (o01 F1).
{
  let failing = false;
  let writes = 0;
  let clock = now;
  const flaky = createSessionStore({
    now: () => clock,
    persist: () => { writes += 1; if (failing) throw new Error('Atomic store write failed for sessions.json.'); },
  });
  const issued = flaky.issue('acct-flaky');
  failing = true;
  const quiet = console.error;
  console.error = () => {};
  try {
    clock += 6 * 60_000;
    assert.equal(flaky.resolve(issued.cookieValue).accountId, 'acct-flaky', 'a touch whose write fails still resolves');
    clock += 31 * 86400000;
    assert.equal(flaky.resolve(issued.cookieValue), null, 'an expired record is dropped even when the write fails');
  } finally {
    console.error = quiet;
  }
  assert.equal(flaky.size(), 0, 'memory stays authoritative');
  assert.ok(writes >= 2);
  flaky.close();
}

// F5: a revocation that cannot be written must not stay revoked in memory
// only. The record would still be on disk and would come back after a
// restart, so the two views of the session must agree.
{
  const revokeFile = path.join(root, 'revoke-fail.json');
  let failing = false;
  const flaky = createSessionStore({
    filePath: revokeFile,
    now: () => now,
    persist: value => { if (failing) throw new Error('disk busy'); fs.writeFileSync(revokeFile, JSON.stringify(value)); },
  });
  const doomed = flaky.issue('acct-revoked');
  failing = true;
  assert.throws(() => flaky.revokeAllForAccount('acct-revoked'), /disk busy/);
  assert.equal(flaky.resolve(doomed.cookieValue).accountId, 'acct-revoked', 'the session is still valid when the write failed');
  assert.equal(flaky.size(), 1, 'the record is not dropped from memory');
  const reloaded = createSessionStore({ filePath: revokeFile, now: () => now });
  assert.equal(reloaded.resolve(doomed.cookieValue).accountId, 'acct-revoked', 'the session survives a restart exactly as memory has it');
  reloaded.close();
  flaky.close();
}

// F6: a failed issue write must roll back both indexes and permit a later issue.
{
  let failing = true;
  const flaky = createSessionStore({ persist: () => { if (failing) throw new Error('disk busy'); } });
  assert.throws(() => flaky.issue('acct-issue-fail'), /disk busy/);
  assert.equal(flaky.size(), 0, 'failed issuance leaves no phantom record');
  failing = false;
  const valid = flaky.issue('acct-issue-fail');
  assert.equal(flaky.size(), 1);
  assert.equal(flaky.resolve(valid.cookieValue).accountId, 'acct-issue-fail', 'the next successful issue resolves');
  flaky.close();
}

// F5: the same holds for a single session and for the other sessions of an
// account.
{
  let failing = false;
  const flaky = createSessionStore({ now: () => now, persist: () => { if (failing) throw new Error('disk busy'); } });
  const one = flaky.issue('acct-mixed');
  const two = flaky.issue('acct-mixed');
  failing = true;
  assert.throws(() => flaky.revoke(one.sessionId), /disk busy/);
  assert.throws(() => flaky.revokeAccountSessionsExcept('acct-mixed', null), /disk busy/);
  assert.equal(flaky.resolve(one.cookieValue).accountId, 'acct-mixed');
  assert.equal(flaky.resolve(two.cookieValue).accountId, 'acct-mixed');
  assert.equal(flaky.size(), 2);
  flaky.close();
}

// A live socket asks whether its session is still valid without touching it.
{
  let clock = now;
  const store2 = createSessionStore({ now: () => clock });
  const mine = store2.issue('acct-live-check');
  assert.equal(store2.hasSession(mine.sessionId, 'acct-live-check'), true);
  assert.equal(store2.hasSession(mine.sessionId, 'acct-other'), false, 'the session must belong to the account');
  assert.equal(store2.hasSession('sess_unknown', 'acct-live-check'), false);
  const lastSeen = store2.snapshot()[0].lastSeenAt;
  clock += 6 * 60_000;
  store2.hasSession(mine.sessionId, 'acct-live-check');
  assert.equal(store2.snapshot()[0].lastSeenAt, lastSeen, 'the check does not touch the session');
  assert.equal(store2.revoke(mine.sessionId), true);
  assert.equal(store2.hasSession(mine.sessionId, 'acct-live-check'), false, 'a revoked session is gone');
  const aging = store2.issue('acct-aging');
  clock += 91 * 86400000;
  assert.equal(store2.hasSession(aging.sessionId, 'acct-aging'), false, 'an expired session is not valid');
  store2.close();
}

fs.rmSync(root, { recursive: true, force: true });
console.log('session store: expiry, persistence and lineage scenarios passed');
