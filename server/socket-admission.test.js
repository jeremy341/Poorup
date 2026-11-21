import assert from 'node:assert/strict';
import { assertProductionCors, parseAllowedOrigins, resolveClientAddress } from './serverConfig.js';
import * as serverConfig from './serverConfig.js';
import * as httpRateLimiter from './httpRateLimiter.js';
import { createSocketAdmission, createSocketRateLimiter } from './socketRateLimiter.js';

assert.equal(typeof serverConfig.isAllowedSocketOrigin, 'function');
assert.equal(serverConfig.isAllowedSocketOrigin('https://play.example', ['https://play.example']), true);
assert.equal(serverConfig.isAllowedSocketOrigin('https://evil.example', ['https://play.example']), false);
assert.equal(serverConfig.isAllowedSocketOrigin('ws://play.example', ['https://play.example']), false);
assert.equal(resolveClientAddress({ address: '127.0.0.1', headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' } }, 0), '127.0.0.1');
// One trusted hop: the rightmost entry is the address the proxy appended, the
// same entry Express picks for req.ip. The leftmost entry is client-supplied.
assert.equal(resolveClientAddress({ address: '127.0.0.1', headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' } }, 1), '10.0.0.1');
assert.equal(resolveClientAddress({ address: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.77, 203.0.113.9' } }, 1), '203.0.113.9');
assert.equal(resolveClientAddress({ address: '127.0.0.1', headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' } }, 2), '10.0.0.2');
assert.equal(resolveClientAddress({ address: '127.0.0.1', headers: { 'x-forwarded-for': '10.0.0.1' } }, 3), '10.0.0.1');
// Limiter identity: every address in an IPv6 /64 is one peer, a mapped IPv4 is its IPv4.
assert.equal(resolveClientAddress({ address: '2001:db8:aa:bb::1' }, 0), resolveClientAddress({ address: '2001:DB8:aa:bb:1234:5678:9abc:def0' }, 0));
assert.notEqual(resolveClientAddress({ address: '2001:db8:aa:bb::1' }, 0), resolveClientAddress({ address: '2001:db8:aa:bc::1' }, 0));
assert.equal(resolveClientAddress({ address: '::ffff:203.0.113.9' }, 0), '203.0.113.9');
assert.equal(resolveClientAddress({ address: '127.0.0.1', headers: { 'x-forwarded-for': '2001:db8:1:1::5' } }, 1), resolveClientAddress({ address: '2001:db8:1:1::6' }, 0));
assert.deepEqual(parseAllowedOrigins({ POORUP_ALLOWED_ORIGINS: 'https://play.example,https://play.example/' }), ['https://play.example', 'https://play.example']);
assert.throws(() => assertProductionCors({ NODE_ENV: 'production', POORUP_ALLOWED_ORIGINS: 'https://play.example,ws://evil' }), /valid origins/);
assert.equal(typeof httpRateLimiter.assertRateLimitConfig, 'function');
assert.throws(() => httpRateLimiter.assertRateLimitConfig({ NODE_ENV: 'production', POORUP_HTTP_RATE_LIMIT: '0', POORUP_SOCKET_RATE_LIMIT: '0' }), /positive number|rate limit/i);
assert.throws(() => httpRateLimiter.assertRateLimitConfig({ NODE_ENV: 'development', POORUP_SOCKET_RATE_LIMIT: '0' }), /positive number/, 'an explicit zero socket budget is refused at boot, not read as "disabled"');
assert.equal(httpRateLimiter.assertRateLimitConfig({ NODE_ENV: 'development', POORUP_HTTP_RATE_LIMIT: '0', POORUP_SOCKET_RATE_LIMIT: '' }).development, true);

const limiter = createSocketRateLimiter({ max: 0, windowMs: 1000 });
assert.equal(limiter.allow('socket-a'), false);

// A reconnect gets a new socket id. The peer budget must survive it, or every
// reconnect multiplies the per-socket allowance.
let eventNow = 0;
const peerLimiter = createSocketRateLimiter({ max: 2, peerMax: 3, windowMs: 1000, now: () => eventNow });
assert.equal(peerLimiter.allow('socket-1', '203.0.113.5'), true);
assert.equal(peerLimiter.allow('socket-1', '203.0.113.5'), true);
assert.equal(peerLimiter.allow('socket-2', '203.0.113.5'), true);
assert.equal(peerLimiter.allow('socket-3', '203.0.113.5'), false, 'a fresh socket cannot exceed the peer budget');
assert.equal(peerLimiter.allow('socket-4', '198.51.100.9'), true, 'other peers keep their own budget');
eventNow = 1001;
assert.equal(peerLimiter.allow('socket-5', '203.0.113.5'), true);

let now = 0;
const admission = createSocketAdmission({ maxConnections: 2, maxHandshakes: 2, windowMs: 1000, now: () => now });
assert.equal(admission.allow('peer-a', 0), true);
assert.equal(admission.allow('peer-a', 0), true);
assert.equal(admission.allow('peer-a', 0), false);
assert.equal(admission.allow('peer-b', 2), false);
now = 1001;
assert.equal(admission.allow('peer-a', 0), true);

// A per-peer concurrent cap is enforced beside the global cap: one address cannot occupy every slot, and another peer keeps its
// own admission. A little of the global cap stays reserved even when maxPerPeer is configured above it.
{
  const capped = createSocketAdmission({ maxConnections: 100, maxPerPeer: 1, maxHandshakes: 1000, windowMs: 1000, now: () => 0 });
  assert.equal(capped.allow('peer-a', 0, 0), true);
  assert.equal(capped.allow('peer-a', 1, 1), false, 'one peer cannot exceed its concurrent socket cap');
  assert.equal(capped.allow('peer-b', 1, 0), true, 'another peer is still admitted while the first is at its cap');
  assert.equal(capped.allow('peer-a', 0, 1), false, 'dropping the global count does not bypass the per-peer cap');

  const narrow = createSocketAdmission({ maxConnections: 10, maxPerPeer: 100, maxHandshakes: 1000, windowMs: 1000, now: () => 0 });
  assert.equal(narrow.allow('peer-a', 8, 8), true);
  assert.equal(narrow.allow('peer-a', 9, 9), false, 'the last global slots stay reserved for other peers');
  assert.equal(narrow.allow('peer-b', 9, 0), true);
  assert.equal(createSocketAdmission({ maxPerPeer: '' }).maxPerPeer, 5, 'a blank maxPerPeer keeps the default of 5');
  assert.equal(createSocketAdmission({ maxPerPeer: '0' }).maxPerPeer, 5, 'a zero maxPerPeer falls back instead of refusing everyone');
}

// Reconnect churn past the cap must not grow the peer map without bound.
const churn = createSocketAdmission({ maxConnections: 100_000, maxHandshakes: 5, windowMs: 1000, now: () => 0 });
for (let index = 0; index < 10_050; index += 1) churn.allow(`churn-peer-${index}`, 0);
assert.equal(churn.size() <= 10_000, true, 'handshake buckets are capped');

// A blank env var is "unset", not zero. Number('') is 0, which would
// deny every event (max) or collapse the window to its 100 ms floor.
{
  assert.equal(createSocketRateLimiter({ max: '', windowMs: 1000 }).allow('blank-max'), true, 'a blank max falls back to the default');
  assert.equal(createSocketRateLimiter({ max: '  ', windowMs: 1000 }).allow('blank-max'), true);
  let blankNow = 0;
  const blankWindow = createSocketRateLimiter({ max: 1, peerMax: '', windowMs: '', now: () => blankNow });
  assert.equal(blankWindow.allow('blank-window'), true);
  blankNow = 500;
  assert.equal(blankWindow.allow('blank-window'), false, 'a blank window falls back to 10 s, not the 100 ms floor');
  const blankPeer = createSocketRateLimiter({ max: 1, peerMax: '', windowMs: 1000 });
  assert.equal(blankPeer.allow('blank-peer', '203.0.113.5'), true, 'a blank peer budget falls back to a multiple of max');
  assert.equal(createSocketRateLimiter({ max: '0', windowMs: 1000 }).allow('zero-max'), false, 'an explicit 0 still denies everything (boot refuses that env value)');
}

// Peers key on the IPv6 /64, and an IPv4-mapped address keys
// as its IPv4, so a client cannot mint a fresh budget per address.
{
  const v6 = createSocketRateLimiter({ max: 100, peerMax: 2, windowMs: 1000, now: () => 0 });
  assert.equal(v6.allow('a', '2001:db8:1:2::1'), true);
  assert.equal(v6.allow('b', '2001:db8:1:2:aaaa:bbbb:cccc:dddd'), true);
  assert.equal(v6.allow('c', '2001:DB8:1:2::9999'), false, 'one /64 shares one peer budget');
  assert.equal(v6.allow('d', '2001:db8:1:3::1'), true, 'a different /64 has its own budget');
  const mapped = createSocketRateLimiter({ max: 100, peerMax: 1, windowMs: 1000, now: () => 0 });
  assert.equal(mapped.allow('a', '203.0.113.7'), true);
  assert.equal(mapped.allow('b', '::ffff:203.0.113.7'), false, 'an IPv4-mapped address is the same peer as its IPv4');
  const v6Admission = createSocketAdmission({ maxConnections: 100, maxHandshakes: 2, windowMs: 1000, now: () => 0 });
  assert.equal(v6Admission.allow('2001:db8:9:9::1', 0), true);
  assert.equal(v6Admission.allow('2001:db8:9:9::2', 0), true);
  assert.equal(v6Admission.allow('2001:db8:9:9::3', 0), false, 'handshakes from one /64 share a budget');
}

// A full map of live buckets must not drop the buckets that matter. A
// victim already at its limit stays limited after 10k foreign keys arrive.
{
  const victimLimiter = createSocketRateLimiter({ max: 100, peerMax: 1, windowMs: 60_000, now: () => 0 });
  assert.equal(victimLimiter.allow('victim-socket', '198.51.100.1'), true);
  assert.equal(victimLimiter.allow('victim-socket', '198.51.100.1'), false);
  for (let index = 0; index < 10_050; index += 1) victimLimiter.allow(`flood-${index}`, `203.0.${Math.floor(index / 250)}.${index % 250}`);
  assert.equal(victimLimiter.allow('victim-socket', '198.51.100.1'), false, 'live buckets are not evicted to make room');
  assert.equal(victimLimiter.size() <= 20_001, true, 'the maps stay bounded');
}

// A handshake session lookup that throws (failed sessions.json write) denies the socket as anonymous instead of escaping into an unhandledRejection.
assert.equal(typeof serverConfig.resolveHandshakeSession, 'function');
{
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    assert.equal(serverConfig.resolveHandshakeSession(() => { throw new Error('Atomic store write failed for sessions.json.'); }, 'cookie'), null);
  } finally { console.error = originalError; }
  assert.equal(errors.length, 1, 'the failure is logged once');
  assert.deepEqual(serverConfig.resolveHandshakeSession(value => ({ sessionId: value }), 's1'), { sessionId: 's1' });
  assert.equal(serverConfig.resolveHandshakeSession(() => undefined, 's1'), null);
}

// A token-bucket handshake budget cannot be spent twice by straddling a window boundary.
{
  let clock = 0;
  const admission = createSocketAdmission({ maxHandshakes: 2, windowMs: 1000, now: () => clock });
  assert.equal(admission.allow('boundary-peer'), true);
  clock = 999;
  assert.equal(admission.allow('boundary-peer'), true);
  clock = 1000;
  assert.equal(admission.allow('boundary-peer'), true, 'only the tokens refilled since the burst are available');
  assert.equal(admission.allow('boundary-peer'), false, 'no second full handshake allowance at the boundary');
}

console.log('socket admission: 40 passed, 0 failed');
