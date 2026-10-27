import assert from 'node:assert/strict';
import { createHttpRateLimiter } from './httpRateLimiter.js';
import { windowBucket } from './rateBuckets.js';

const limiter = createHttpRateLimiter({ max: 2, windowMs: 60_000 });
const make = () => ({ headers: {}, socket: { remoteAddress: '127.0.0.1' } });
const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, type() { return this; }, send(body) { this.body = body; } });
let nextCalls = 0;
limiter(make(), response(), () => { nextCalls += 1; });
limiter(make(), response(), () => { nextCalls += 1; });
const blocked = response();
limiter(make(), blocked, () => { nextCalls += 1; });
assert.equal(nextCalls, 2);
assert.equal(blocked.statusCode, 429);
assert.ok(blocked.headers['Retry-After']);
const trusted = createHttpRateLimiter({ max: 1, windowMs: 60_000, trustProxy: true });
const secondIp = { headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
assert.doesNotThrow(() => trusted(secondIp, response(), () => {}));
const trustedChain = createHttpRateLimiter({ max: 1, windowMs: 60_000, trustProxy: true });
const proxied = { ip: '10.0.0.2', headers: { 'x-forwarded-for': '198.51.100.9' }, socket: { remoteAddress: '127.0.0.1' } };
trustedChain(proxied, response(), () => {});
const spoofed = response();
trustedChain({ ...proxied, headers: { 'x-forwarded-for': '203.0.113.55' } }, spoofed, () => {});
assert.equal(spoofed.statusCode, 429);

// One IPv6 /64 is one client: rotating the host part must not mint fresh buckets.
const sixtyFour = createHttpRateLimiter({ max: 2, windowMs: 60_000 });
const fromAddress = address => ({ headers: {}, socket: { remoteAddress: address } });
let passed = 0;
for (let host = 1; host <= 20; host += 1) sixtyFour(fromAddress(`2001:db8:1:2::${host.toString(16)}`), response(), () => { passed += 1; });
assert.equal(passed, 2, 'twenty addresses in one /64 share a budget of two');
let otherNetwork = 0;
sixtyFour(fromAddress('2001:db8:1:3::1'), response(), () => { otherNetwork += 1; });
assert.equal(otherNetwork, 1, 'a different /64 has its own budget');
const mapped = createHttpRateLimiter({ max: 1, windowMs: 60_000 });
mapped(fromAddress('203.0.113.9'), response(), () => {});
const mappedBlocked = response();
mapped(fromAddress('::ffff:203.0.113.9'), mappedBlocked, () => {});
assert.equal(mappedBlocked.statusCode, 429, 'an IPv4-mapped address counts as its IPv4 address');

// Flooding the table with other keys must not reset a client that is already limited.
const crowded = createHttpRateLimiter({ max: 1, windowMs: 60_000 });
crowded(fromAddress('198.51.100.1'), response(), () => {});
const limitedVictim = response();
crowded(fromAddress('198.51.100.1'), limitedVictim, () => {});
assert.equal(limitedVictim.statusCode, 429);
for (let index = 0; index < 10_050; index += 1) crowded(fromAddress(`10.${index >> 16 & 255}.${index >> 8 & 255}.${index & 255}`), response(), () => {});
const stillLimited = response();
let leaked = false;
crowded(fromAddress('198.51.100.1'), stillLimited, () => { leaked = true; });
assert.equal(leaked, false, 'a limited client stays limited when the bucket table is full');
assert.equal(stillLimited.statusCode, 429);

// A blank or zero window is unset, not a 1 s floor: keep the 60 s default.
for (const windowMs of ['', '   ', 0, '0']) {
  const configured = createHttpRateLimiter({ max: 1, windowMs });
  configured(make(), response(), () => {});
  const retry = response();
  configured(make(), retry, () => {});
  assert.equal(retry.statusCode, 429, `${JSON.stringify(windowMs)} still limits`);
  assert.equal(retry.headers['Retry-After'], '60', `${JSON.stringify(windowMs)} keeps the 60 s default window`);
}

// A full table recycles the oldest live slot instead of hiding new keys behind
// a shadow overflow bucket, and the moved slot keeps the budget it already spent.
const table = new Map();
const start = 1_000_000;
const cap = 3;
const spent = [5, 6, 7];
for (let index = 0; index < cap; index += 1) windowBucket(table, `peer-${index}`, start, 60_000, cap).count = spent[index];
const newcomer = windowBucket(table, 'peer-new', start + 1, 60_000, cap);
assert.equal(table.get('peer-new'), newcomer, 'a full table still tracks the new key');
assert.equal(newcomer.count, spent[0], 'a recycled slot keeps its spent budget');
const displaced = windowBucket(table, 'peer-0', start + 2, 60_000, cap);
assert.equal(table.get('peer-0'), displaced, 'a displaced key is tracked again');
assert.equal(displaced.count, spent[1], 'coming back never restarts at zero while the table is full');
const expired = windowBucket(table, 'peer-fresh', start + 60_010, 60_000, cap);
assert.equal(table.get('peer-fresh'), expired);
assert.equal(expired.count, 0, 'an expired window still grants a fresh budget');

// A saturated map must still charge the key that asks: the join-failure lockout
// reads its map directly, so a key that fell off the table would escape the
// limit. The spend moves with the bucket instead of being reset to zero.
const locked = new Map();
for (let index = 0; index < cap; index += 1) windowBucket(locked, `peer-${index}`, start, 60_000, cap).count = 1;
const spentBefore = [...locked.values()].reduce((sum, bucket) => sum + bucket.count, 0);
const late = windowBucket(locked, 'peer-late', start + 1, 60_000, cap);
assert.equal(locked.get('peer-late'), late, 'a late key is tracked in the map itself');
assert.equal(late.count, 1, 'a late key starts from a spent budget, so the limit fails closed');
assert.equal([...locked.values()].reduce((sum, bucket) => sum + bucket.count, 0), spentBefore, 'no budget is lost when the table is full');
console.log('http rate limiter: 17 passed, 0 failed');
