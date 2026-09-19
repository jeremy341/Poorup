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

fs.rmSync(root, { recursive: true, force: true });
console.log('session store: 15 passed, 0 failed');
