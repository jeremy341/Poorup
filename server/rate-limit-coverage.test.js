import assert from 'node:assert/strict';
import { createHttpRouteBudgets } from './abuseBudgets.js';
import { assertTrustedProxyConfig, expressTrustProxy, readAbuseLimits, readSocketEventLimits, readTrustedProxy, resolveClientAddress } from './serverConfig.js';
import { createSocketRateLimiter } from './socketRateLimiter.js';
import { createSafeEmitter } from './socketHandlerSupport.js';
import { createActionBudget, RATE_LIMITED_CODE } from './rateBuckets.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';

// Trusted proxies: forwarding headers count only through a configured hop count or a listed proxy peer.
{
  const headers = { 'x-forwarded-for': '203.0.113.55' };
  assert.equal(resolveClientAddress({ address: '198.51.100.9', headers }, 0), '198.51.100.9', 'no proxy config ignores forwarding headers');
  const listed = readTrustedProxy({ POORUP_TRUSTED_PROXY_ADDRESSES: '10.0.0.1, 10.0.0.2' });
  assert.equal(listed.enabled, true);
  assert.deepEqual(listed.addresses, ['10.0.0.1', '10.0.0.2']);
  assert.equal(resolveClientAddress({ address: '198.51.100.9', headers }, listed), '198.51.100.9', 'a direct client that is not a listed proxy cannot choose its bucket');
  assert.equal(resolveClientAddress({ address: '10.0.0.1', headers }, listed), '203.0.113.55', 'a listed proxy hands over the client it saw');
  const chained = { 'x-forwarded-for': '1.1.1.1, 203.0.113.55, 10.0.0.2' };
  assert.equal(resolveClientAddress({ address: '10.0.0.1', headers: chained }, listed), '203.0.113.55', 'a chain of listed proxies is walked back to the first unlisted hop');
  assert.equal(resolveClientAddress({ address: '10.0.0.1', headers: { 'x-forwarded-for': '2001:db8:7::9' } }, listed), resolveClientAddress({ address: '2001:db8:7::1' }, 0), 'an IPv6 client is keyed by its /64');
  assert.equal(resolveClientAddress({ address: '10.0.0.1' }, listed), '10.0.0.1', 'a listed proxy without forwarding headers is itself the client');
  const hopped = readTrustedProxy({ POORUP_TRUST_PROXY_HOPS: '1' });
  assert.equal(hopped.enabled, true);
  assert.equal(resolveClientAddress({ address: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.77, 203.0.113.9' } }, hopped), '203.0.113.9');
  assert.equal(readTrustedProxy({}).enabled, false, 'nothing configured means nothing trusted');
  assert.equal(readTrustedProxy({ POORUP_TRUST_PROXY_HOPS: '-3' }).hops, 0, 'a negative hop count is clamped to zero');
  const express = expressTrustProxy(listed);
  assert.equal(typeof express, 'function');
  assert.equal(express('10.0.0.2'), true);
  assert.equal(express('::ffff:10.0.0.2'), true, 'an IPv4-mapped proxy address matches its IPv4 entry');
  assert.equal(express('198.51.100.9'), false);
  assert.equal(expressTrustProxy(hopped), 1, 'hop mode hands Express the hop count unchanged');
  assert.equal(assertTrustedProxyConfig({ POORUP_TRUSTED_PROXY_ADDRESSES: '10.0.0.1,2001:db8::1' }), true);
  assert.throws(() => assertTrustedProxyConfig({ POORUP_TRUSTED_PROXY_ADDRESSES: '10.0.0.0/8' }), /plain IP addresses/, 'a CIDR is refused at boot, not silently ignored');
}

// Budgets are configurable: blank means the default, an explicit 0 disables one budget, and a window has a floor.
{
  const limits = readAbuseLimits({ POORUP_AUTH_ATTEMPT_LIMIT: '', POORUP_ACCOUNT_EXPORT_LIMIT: '0', POORUP_RECOVERY_REQUEST_WINDOW_MS: '5000', POORUP_ROOM_CREATE_WINDOW_MS: '10' });
  assert.equal(limits.authAttempt.limit, 8, 'blank keeps the default');
  assert.equal(limits.accountExport.limit, 0, 'an explicit zero disables the budget');
  assert.equal(limits.recoveryRequest.windowMs, 5000);
  assert.equal(limits.roomCreate.windowMs, 1000, 'a window below one second is raised to the floor');
  assert.equal(readAbuseLimits({}).joinFailure.limit, 30);
  assert.deepEqual(readSocketEventLimits({ POORUP_SOCKET_PEER_RATE_LIMIT: '500', POORUP_SOCKET_BLOCK_MS: '2000' }).peerMax, '500');
}

// HTTP route budgets: a route with a budget answers 429 with Retry-After, prefix matching is case-insensitive, and other routes pass.
{
  const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, type() { return this; }, send(body) { this.body = body; } });
  const limiter = createHttpRouteBudgets({ limits: readAbuseLimits({ POORUP_RECOVERY_REQUEST_LIMIT: '2', POORUP_ANALYTICS_LIMIT: '0' }) });
  const request = (path, address = '203.0.113.40') => ({ path, headers: {}, socket: { remoteAddress: address } });
  let passed = 0;
  for (let index = 0; index < 3; index += 1) limiter(request('/account/recovery/request'), response(), () => { passed += 1; });
  assert.equal(passed, 2, 'the third recovery request in the window is refused');
  const refused = response();
  limiter(request('/Account/Recovery/Request'), refused, () => assert.fail('a case variant of the route is still budgeted'));
  assert.equal(refused.statusCode, 429);
  assert.ok(Number(refused.headers['Retry-After']) >= 1, 'a 429 carries Retry-After');
  let otherRoute = 0;
  limiter(request('/account/session'), response(), () => { otherRoute += 1; });
  limiter(request('/account/recovery/requests'), response(), () => { otherRoute += 1; });
  assert.equal(otherRoute, 2, 'routes outside the budget, and near-miss prefixes, are not counted');
  let otherPeer = 0;
  limiter(request('/account/recovery/request', '198.51.100.41'), response(), () => { otherPeer += 1; });
  assert.equal(otherPeer, 1, 'another address keeps its own budget');
  let disabled = 0;
  for (let index = 0; index < 50; index += 1) limiter(request('/admin/analytics/summary'), response(), () => { disabled += 1; });
  assert.equal(disabled, 50, 'an explicit zero disables the analytics budget');
}

// Socket event limiter: a refused event gets a retry hint, repeated refusals escalate to a temporary peer block, and the block lapses.
{
  let clock = 0;
  const limiter = createSocketRateLimiter({ max: 2, peerMax: 1000, windowMs: 1000, blockThreshold: 3, blockMs: 5000, now: () => clock });
  const peer = '203.0.113.60';
  assert.equal(limiter.check('s1', peer), null);
  assert.equal(limiter.check('s1', peer), null);
  const first = limiter.check('s1', peer);
  assert.equal(first.code, RATE_LIMITED_CODE);
  assert.ok(first.retryAfterMs > 0 && first.retryAfterMs <= 1000, 'a socket refusal says when the window reopens');
  assert.equal(first.blocked, undefined, 'the first refusals are not a block');
  limiter.check('s1', peer);
  const escalated = limiter.check('s1', peer);
  assert.equal(escalated.blocked, true, 'the third refusal in one window blocks the peer');
  assert.equal(escalated.retryAfterMs, 5000);
  const otherSocket = limiter.check('s2', peer);
  assert.equal(otherSocket.blocked, true, 'a fresh socket from a blocked peer is still blocked (reconnecting does not reset it)');
  assert.equal(limiter.check('s3', '198.51.100.61'), null, 'another peer is not affected');
  assert.equal(limiter.allow('s4', '198.51.100.62'), true, 'the boolean API still works');
  clock = 5001;
  assert.equal(limiter.check('s5', peer), null, 'the block lapses after blockMs');
}

// A flood of distinct peers that are all being blocked cannot grow the block table past its cap.
{
  let clock = 0;
  const limiter = createSocketRateLimiter({ max: 5, peerMax: 1, windowMs: 1000, blockThreshold: 1, blockMs: 60_000, now: () => clock });
  // Each peer spends its one peer unit on the first socket, so the second socket is refused and the peer is blocked.
  for (let index = 0; index < 10_050; index += 1) {
    const peer = `203.0.${index >> 8 & 255}.${index & 255}`;
    limiter.check(`flood-a-${index}`, peer);
    limiter.check(`flood-b-${index}`, peer);
  }
  assert.equal(limiter.blockedPeers(), 10_000, 'the block table is capped and the oldest blocks give way');
  assert.equal(limiter.blockedPeers() <= 10_000, true, `blocked peers stay bounded (${limiter.blockedPeers()})`);
}

// The emitter answers a refused event with a stable RATE_LIMITED error and never runs the handler; an allowed one runs it.
{
  const listeners = new Map();
  const socket = { id: 'emit-socket', on: (event, listener) => listeners.set(event, listener) };
  let handlerRuns = 0;
  const refusal = { retryAfterMs: 1200, blocked: true };
  let next = refusal;
  const on = createSafeEmitter(socket, { check: () => next });
  on('send-chat', () => { handlerRuns += 1; });
  const acks = [];
  listeners.get('send-chat')({ text: 'hi' }, ack => acks.push(ack));
  assert.deepEqual(acks[0], { success: false, code: RATE_LIMITED_CODE, error: 'Too many requests. Try again shortly.', retryAfterMs: 1200, blocked: true });
  assert.equal(handlerRuns, 0);
  next = null;
  listeners.get('send-chat')({ text: 'hi' }, ack => acks.push(ack));
  assert.equal(handlerRuns, 1, 'an allowed event runs its handler');
  const plainBoolean = createSafeEmitter(socket, { allow: () => false });
  plainBoolean('send-chat', () => { handlerRuns += 1; });
  listeners.get('send-chat')({}, ack => acks.push(ack));
  assert.equal(acks[acks.length - 1].code, RATE_LIMITED_CODE, 'a boolean allow still produces the stable refusal');
  assert.equal(acks[acks.length - 1].retryAfterMs, 0);
}

// Action budgets: a limit refuses with a retry hint and resets when the window does; key rotation cannot grow the table past its cap.
{
  let clock = 1_000;
  const budget = createActionBudget({ limit: 2, windowMs: 1000, now: () => clock });
  assert.equal(budget.take('acct-a'), null);
  assert.equal(budget.take('acct-a'), null);
  assert.ok(budget.take('acct-a') > 0, 'the third action in the window is refused with a wait');
  assert.equal(budget.take('acct-b'), null, 'another identity has its own budget');
  clock = 2_001;
  assert.equal(budget.take('acct-a'), null, 'a new window restores the budget');
  assert.equal(createActionBudget({ limit: 0, windowMs: 1000 }).take('acct-z'), null, 'a zero limit disables the budget');
  const capped = createActionBudget({ limit: 1, windowMs: 60_000, cap: 100 });
  for (let index = 0; index < 1_000; index += 1) capped.take(`rotating-${index}`, 0);
  assert.equal(capped.size() <= 100, true, 'a rotating key population stays under the cap');
}

// Socket account handlers: exports and account writes share one budget per account across sockets, and a refused call never reaches the store.
{
  let exports = 0;
  let writes = 0;
  const runtime = {
    accountStore: { updateProfileForAccount: () => { writes += 1; return { success: true, account: { id: 'acct-1' } }; } },
    roomManager: { getRoomBySocket: () => null, rooms: new Map() },
    social: { accountForSocket: socket => (socket.data.accountId ? { id: socket.data.accountId, accountDeactivated: false } : null) },
    accountRights: { export: () => { exports += 1; return { success: true, filename: 'a.json', document: {} }; } },
    abuseLimits: {
      authAttempt: { limit: 8, windowMs: 60_000 },
      usernameCheck: { limit: 30, windowMs: 60_000 },
      joinFailure: { limit: 30, windowMs: 600_000 },
      roomCreate: { limit: 60, windowMs: 60_000 },
      accountWrite: { limit: 2, windowMs: 60_000 },
      accountExport: { limit: 1, windowMs: 600_000 },
    },
    emitRoomState() {}, scheduleRoomsUpdated() {}, leaveAllGameRooms() {}, detachSocketFromOtherRoom() {},
    clearDisconnectTimer() {}, reassignHostIfNeeded() {}, emitPendingInteractions() {},
    io: { in() { return { emit() {} }; } },
  };
  const connect = (id, address) => {
    const socket = { id, data: { accountId: 'acct-1' }, rooms: new Set(), handshake: { address, headers: {} }, join() {}, leave() {}, emit() {} };
    const table = new Map();
    registerAccountSocketHandlers((event, handler) => table.set(event, handler), socket, runtime);
    return (event, payload = {}) => new Promise(resolve => table.get(event)(payload, resolve));
  };
  const first = connect('export-1', '203.0.113.80');
  const second = connect('export-2', '203.0.113.81');
  assert.equal((await first('account-export')).success, true);
  const exportRefused = await second('account-export');
  assert.equal(exportRefused.code, RATE_LIMITED_CODE, 'a second socket of the same account shares the export budget');
  assert.ok(exportRefused.retryAfterMs > 0);
  assert.equal(exports, 1, 'the refused export never reaches the rights service');
  await first('account-update', { nickname: 'one' });
  await second('account-update', { nickname: 'two' });
  const writeRefused = await first('account-update', { nickname: 'three' });
  assert.equal(writeRefused.code, RATE_LIMITED_CODE);
  assert.equal(writes, 2, 'writes beyond the account budget never reach the store');
  // The same budget object is used by every socket of this runtime.
  assert.equal(typeof runtime.abuseBudgets?.accountWrite?.take, 'function');
}

// The fixed-window rewrite: a token budget refills continuously, so a client cannot spend a full allowance on each side of a rollover.
{
  let clock = 0;
  const budget = createActionBudget({ limit: 2, windowMs: 1000, now: () => clock });
  assert.equal(budget.take('boundary-account'), null, 'first action opens the window at t=0');
  clock = 999;
  assert.equal(budget.take('boundary-account'), null, 'the allowance is full just before the rollover');
  clock = 1000;
  assert.equal(budget.take('boundary-account'), null, 'only the tokens that refilled since the burst are available');
  assert.ok(budget.take('boundary-account') > 0, 'no second full allowance one millisecond after the rollover');
  clock = 2000;
  assert.equal(budget.take('boundary-account'), null, 'the budget recovers after a full refill window');
}

// Per-socket and per-peer event budgets both reject the second burst at a window rollover.
{
  let clock = 0;
  const perSocket = createSocketRateLimiter({ max: 2, peerMax: 1000, windowMs: 1000, now: () => clock });
  const peer = '203.0.113.90';
  assert.equal(perSocket.check('s1', peer), null);
  clock = 999;
  assert.equal(perSocket.check('s1', peer), null);
  clock = 1000;
  assert.equal(perSocket.check('s1', peer), null);
  assert.ok(perSocket.check('s1', peer), 'a socket cannot double its allowance at the boundary');

  clock = 0;
  const perPeer = createSocketRateLimiter({ max: 1000, peerMax: 2, windowMs: 1000, now: () => clock });
  assert.equal(perPeer.check('a', peer), null);
  clock = 999;
  assert.equal(perPeer.check('b', peer), null);
  clock = 1000;
  assert.equal(perPeer.check('c', peer), null, 'a fresh socket cannot double the peer allowance at the boundary');
  assert.ok(perPeer.check('d', peer), 'reconnecting across the boundary does not refill the peer budget');
}

console.log('rate limit coverage: all passed');
