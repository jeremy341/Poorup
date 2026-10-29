// Operator sign-in for the maintenance lockout: the password check, the signed
// bypass cookie, and the /maintenance/unlock and /maintenance/logout routes.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import {
  createMaintenanceAccess,
  DEFAULT_ACCESS_TTL_MS,
  MAINTENANCE_ACCESS_COOKIE,
  passwordMatches,
  registerMaintenanceAccessRoutes,
  resolveAccessTtlMs,
} from './maintenanceAccess.js';

async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const PASSWORD = 'correct horse battery staple';
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest();

function clock(start = Date.parse('2026-10-20T12:00:00.000Z')) {
  let current = start;
  return { now: () => current, advance: ms => { current += ms; } };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(resolve => server.close(resolve)) };
}

function harness({ password = PASSWORD, access: accessOptions = {}, routes = {}, trustProxy = false } = {}) {
  const time = clock();
  const sleeps = [];
  const access = createMaintenanceAccess({ password, now: time.now, sleep: async ms => { sleeps.push(ms); }, ...accessOptions });
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  registerMaintenanceAccessRoutes(app, { access, ...routes });
  // Anything that reaches the app's error handler would be logged by server.js.
  const reachedErrorHandler = [];
  app.use((error, _req, res, _next) => { reachedErrorHandler.push(error); res.status(500).end(); });
  return { app, access, time, sleeps, reachedErrorHandler };
}

const post = (base, pathname, body, headers = {}) => fetch(`${base}${pathname}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

function cookieParts(response) {
  const header = response.headers.get('set-cookie') || '';
  return header.split(';').map(part => part.trim());
}

function cookieValue(response) {
  const first = cookieParts(response)[0] || '';
  return first.startsWith(`${MAINTENANCE_ACCESS_COOKIE}=`) ? first.slice(MAINTENANCE_ACCESS_COOKIE.length + 1) : '';
}

await check('the password check always compares two fixed-length digests in constant time', () => {
  const calls = [];
  const compare = (left, right) => { calls.push([left.length, right.length]); return crypto.timingSafeEqual(left, right); };
  const expected = sha256(PASSWORD);
  assert.equal(passwordMatches(PASSWORD, expected, compare), true);
  for (const candidate of ['', 'x', 'correct horse', `${PASSWORD} `, 'y'.repeat(4000), 42, null, undefined, { toString: () => PASSWORD }]) {
    assert.equal(passwordMatches(candidate, expected, compare), false, String(candidate).slice(0, 20));
  }
  assert.equal(calls.length, 10, 'every candidate, of any length or type, reaches the comparison exactly once');
  calls.forEach(pair => assert.deepEqual(pair, [32, 32]));
});

await check('the token lifetime defaults to 12 hours and is clamped', () => {
  assert.equal(DEFAULT_ACCESS_TTL_MS, 12 * 60 * 60 * 1000);
  assert.equal(resolveAccessTtlMs(undefined), DEFAULT_ACCESS_TTL_MS);
  assert.equal(resolveAccessTtlMs('nonsense'), DEFAULT_ACCESS_TTL_MS);
  assert.equal(resolveAccessTtlMs('3600000'), 3_600_000);
  assert.equal(resolveAccessTtlMs('1'), 5 * 60 * 1000);
  assert.equal(resolveAccessTtlMs(String(365 * 24 * 60 * 60 * 1000)), 7 * 24 * 60 * 60 * 1000);
});

await check('an issued token verifies until it expires', () => {
  const time = clock();
  const access = createMaintenanceAccess({ password: PASSWORD, now: time.now, ttlMs: 60 * 60 * 1000 });
  const issued = access.issue();
  assert.equal(issued.expiresAt, time.now() + 60 * 60 * 1000);
  const grant = access.verify(issued.token);
  assert.equal(grant?.expiresAt, issued.expiresAt);
  assert.equal(access.isGrantActive(grant), true);
  time.advance(60 * 60 * 1000);
  assert.equal(access.verify(issued.token), null, 'an expired token is refused');
  assert.equal(access.isGrantActive(grant), false, 'a grant held by a live socket expires too');
});

await check('forged, tampered and foreign tokens are refused', () => {
  const time = clock();
  const access = createMaintenanceAccess({ password: PASSWORD, now: time.now, cookieSecret: 'shared-secret-for-test' });
  const { token } = access.issue();
  const [expiry, id, signature] = token.split('.');
  const flip = value => value.slice(0, -2) + (value.at(-2) === 'A' ? 'B' : 'A') + value.at(-1);
  const longer = (Number.parseInt(expiry, 36) + 7 * 24 * 60 * 60 * 1000).toString(36);
  for (const candidate of [
    `${longer}.${id}.${signature}`,
    `${expiry}.${flip(id)}.${signature}`,
    `${expiry}.${id}.${flip(signature)}`,
    `${expiry}.${id}.${signature.slice(0, -4)}`,
    `${expiry}.${id}`,
    `${expiry}.${id}.${signature}.extra`,
    '',
    'not a token',
    'x'.repeat(5000),
    null,
    42,
  ]) {
    assert.equal(access.verify(candidate), null, String(candidate).slice(0, 30));
  }
  const forger = crypto.createHmac('sha256', 'guessed-key').update(`v1|${expiry}|${id}`).digest('base64url');
  assert.equal(access.verify(`${expiry}.${id}.${forger}`), null, 'a signature under another key is refused');
  // Same cookie secret but a rotated password: every old token stops working.
  const rotated = createMaintenanceAccess({ password: 'a different password', now: time.now, cookieSecret: 'shared-secret-for-test' });
  assert.equal(rotated.verify(token), null);
  // Without a configured secret each process signs with its own random key.
  const otherProcess = createMaintenanceAccess({ password: PASSWORD, now: time.now });
  assert.equal(otherProcess.verify(createMaintenanceAccess({ password: PASSWORD, now: time.now }).issue().token), null);
  assert.ok(access.verify(token), 'the original token still verifies');
});

await check('a revoked token and the sockets holding it lose the bypass', () => {
  const access = createMaintenanceAccess({ password: PASSWORD });
  const { token } = access.issue();
  const grant = access.grantFromCookieHeader(`other=1; ${MAINTENANCE_ACCESS_COOKIE}=${token}`);
  assert.equal(access.isGrantActive(grant), true);
  access.revoke(grant);
  assert.equal(access.isGrantActive(grant), false);
  assert.equal(access.verify(token), null);
  assert.equal(access.grantFromCookieHeader(''), null);
  assert.equal(access.isGrantActive(null), false);
  assert.equal(access.isGrantActive({ jti: 'made-up', expiresAt: Date.now() + 1000 }), false, 'a grant object the module did not create is refused');
});

await check('with no password configured nothing verifies and both unlock routes answer 404', async () => {
  const off = harness({ password: '' });
  assert.equal(off.access.enabled, false);
  const { base, close } = await listen(off.app);
  try {
    assert.equal((await fetch(`${base}/maintenance/unlock`)).status, 404);
    const response = await post(base, '/maintenance/unlock', { password: PASSWORD });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal((await post(base, '/maintenance/unlock', { password: '' })).status, 404);
    // Logout is harmless either way and always clears the cookie.
    assert.equal((await post(base, '/maintenance/logout', {})).status, 200);
  } finally {
    await close();
  }
});

await check('the right password sets an HttpOnly SameSite=Strict cookie with the token lifetime', async () => {
  const on = harness();
  const { base, close } = await listen(on.app);
  try {
    const available = await fetch(`${base}/maintenance/unlock`);
    assert.equal(available.status, 200);
    assert.deepEqual(await available.json(), { success: true, available: true, bypass: false });
    const response = await post(base, '/maintenance/unlock', { password: PASSWORD });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.expiresAt, new Date(on.time.now() + DEFAULT_ACCESS_TTL_MS).toISOString());
    assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'success'], 'the token never appears in the body');
    const parts = cookieParts(response);
    assert.ok(parts.includes('HttpOnly'));
    assert.ok(parts.includes('SameSite=Strict'));
    assert.ok(parts.includes('Path=/'));
    assert.ok(parts.includes(`Max-Age=${DEFAULT_ACCESS_TTL_MS / 1000}`));
    assert.equal(parts.includes('Secure'), false, 'plain http without a trusted proxy is not marked Secure');
    const token = cookieValue(response);
    assert.ok(on.access.verify(token));
    const status = await (await fetch(`${base}/maintenance/unlock`, { headers: { cookie: `${MAINTENANCE_ACCESS_COOKIE}=${token}` } })).json();
    assert.equal(status.bypass, true);
    const logout = await post(base, '/maintenance/logout', {}, { cookie: `${MAINTENANCE_ACCESS_COOKIE}=${token}` });
    assert.equal(logout.status, 200);
    const cleared = cookieParts(logout);
    assert.equal(cleared[0], `${MAINTENANCE_ACCESS_COOKIE}=`);
    assert.ok(cleared.includes('Max-Age=0'));
    assert.ok(cleared.includes('HttpOnly'));
    assert.equal(on.access.verify(token), null, 'logging out revokes the token, not only the cookie');
  } finally {
    await close();
  }
});

await check('the cookie is Secure behind a trusted HTTPS proxy and when forced', async () => {
  const proxied = harness({ trustProxy: true });
  const forced = harness({ routes: { forceSecure: true } });
  const first = await listen(proxied.app);
  const second = await listen(forced.app);
  try {
    assert.ok(cookieParts(await post(first.base, '/maintenance/unlock', { password: PASSWORD }, { 'x-forwarded-proto': 'https' })).includes('Secure'));
    assert.equal(cookieParts(await post(first.base, '/maintenance/unlock', { password: PASSWORD })).includes('Secure'), false);
    assert.ok(cookieParts(await post(second.base, '/maintenance/unlock', { password: PASSWORD })).includes('Secure'));
    assert.ok(cookieParts(await post(second.base, '/maintenance/logout', {})).includes('Secure'));
  } finally {
    await first.close();
    await second.close();
  }
});

await check('a wrong password gets one generic answer, a growing delay, then a lockout that hides the right password', async () => {
  const limited = harness();
  const { base, close } = await listen(limited.app);
  try {
    const bodies = new Set();
    for (const candidate of ['wrong', '', 'correct horse', 'x'.repeat(900)]) {
      const response = await post(base, '/maintenance/unlock', { password: candidate });
      assert.equal(response.status, 401, candidate.slice(0, 10));
      assert.equal(response.headers.get('set-cookie'), null);
      bodies.add(await response.text());
    }
    const nonString = await post(base, '/maintenance/unlock', { password: 42 });
    assert.equal(nonString.status, 401);
    bodies.add(await nonString.text());
    assert.equal(bodies.size, 1, 'every wrong answer is byte-identical');
    assert.deepEqual(JSON.parse([...bodies][0]), { success: false, error: 'Sign-in failed.' });
    assert.deepEqual(limited.sleeps, [250, 500, 1000, 2000, 4000]);
    const locked = await post(base, '/maintenance/unlock', { password: PASSWORD });
    assert.equal(locked.status, 429, 'after five failures even the right password is refused');
    assert.equal(locked.headers.get('set-cookie'), null);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    limited.time.advance(15 * 60 * 1000);
    const later = await post(base, '/maintenance/unlock', { password: PASSWORD });
    assert.equal(later.status, 200, 'the lockout ends with its window');
  } finally {
    await close();
  }
});

await check('the per-IP request limiter caps unlock attempts before any comparison', async () => {
  const limited = harness({ routes: { unlockRateLimit: { max: 3, windowMs: 60_000 } }, access: { failureLimit: 100 } });
  const { base, close } = await listen(limited.app);
  try {
    const statuses = [];
    for (let index = 0; index < 4; index += 1) statuses.push((await post(base, '/maintenance/unlock', { password: 'nope' })).status);
    assert.deepEqual(statuses, [401, 401, 401, 429]);
    assert.equal(limited.sleeps.length, 3, 'the limited request never reached the password check');
  } finally {
    await close();
  }
});

await check('the failure budget is shared by every address in one IPv6 /64', async () => {
  const limited = harness({ trustProxy: true, access: { failureLimit: 2 } });
  const { base, close } = await listen(limited.app);
  try {
    const from = address => post(base, '/maintenance/unlock', { password: 'wrong' }, { 'x-forwarded-for': address });
    assert.equal((await from('2001:db8:1:2::1')).status, 401);
    assert.equal((await from('2001:db8:1:2::2')).status, 401, 'the second address of the same /64 is the same client');
    assert.equal((await from('2001:db8:1:2::3')).status, 429, 'one /64 shares one failure budget');
    assert.equal((await from('2001:db8:1:3::1')).status, 401, 'a different /64 has its own budget');
    assert.equal((await from('::ffff:203.0.113.9')).status, 401, 'an IPv4-mapped address counts as its IPv4 address');
  } finally {
    await close();
  }
});

await check('a cross-site form or foreign origin cannot sign in or out', async () => {
  const guarded = harness();
  const { base, close } = await listen(guarded.app);
  try {
    assert.equal((await post(base, '/maintenance/unlock', { password: PASSWORD }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(base, '/maintenance/logout', {}, { origin: 'https://evil.example' })).status, 403);
    const form = await fetch(`${base}/maintenance/unlock`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(PASSWORD)}` });
    assert.equal(form.status, 401, 'only a JSON body is read');
    assert.equal(form.headers.get('set-cookie'), null);
    assert.equal((await post(base, '/maintenance/unlock', { password: PASSWORD }, { origin: base })).status, 200);
  } finally {
    await close();
  }
});

await check('the password never reaches a response, the error handler or the console', async () => {
  const quiet = harness();
  const logged = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  for (const level of Object.keys(originals)) console[level] = (...args) => logged.push(args.map(String).join(' '));
  const { base, close } = await listen(quiet.app);
  const texts = [];
  try {
    // A malformed body that still carries the password: the JSON parser's own
    // message would quote it, so it must be answered here, not logged.
    const malformed = await post(base, '/maintenance/unlock', `{"password": ${PASSWORD}}`);
    assert.equal(malformed.status, 400);
    texts.push(await malformed.text());
    const oversized = await post(base, '/maintenance/unlock', { password: `${PASSWORD}${'z'.repeat(5000)}` });
    assert.equal(oversized.status, 413);
    texts.push(await oversized.text());
    texts.push(await (await post(base, '/maintenance/unlock', { password: `${PASSWORD}!` })).text());
    texts.push(await (await post(base, '/maintenance/unlock', { password: PASSWORD })).text());
  } finally {
    Object.assign(console, originals);
    await close();
  }
  assert.equal(quiet.reachedErrorHandler.length, 0, 'body errors are answered by the unlock route itself');
  for (const text of [...texts, ...logged]) {
    assert.equal(text.includes('correct horse'), false, text.slice(0, 80));
    assert.equal(text.includes('battery'), false, text.slice(0, 80));
  }
});
