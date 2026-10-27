import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createAiProviderManager, createAiProviderStore } from './aiProviderConfig.js';
import { AiAdvisor } from './botAdvisor.js';
import { registerAiProviderRoutes } from './aiProviderRoutes.js';
import { registerAdminOpsRoutes } from './adminOpsRoutes.js';
import { createAdminGuard } from './adminOpsGuard.js';
import { createAdminAuditLog } from './adminAuditLog.js';
import { createRoomActivityTracker } from './adminOpsReports.js';
import { createDrainController } from './drainController.js';
import { createMetricsRegistry } from './metricsRegistry.js';
import { createAnalyticsRollupStore } from './analyticsRollupStore.js';

async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const ADMIN_COOKIE = 'poorup_session=admin';
const MEMBER_COOKIE = 'poorup_session=member';
const accountResolver = (req) => {
  if (req.headers.cookie === ADMIN_COOKIE) return { id: 'acct-admin' };
  if (req.headers.cookie === MEMBER_COOKIE) return { id: 'acct-member' };
  return null;
};

let harnessSerial = 0;

function buildHarness({ rooms = new Map(), rollup = createAnalyticsRollupStore({}), withProviders = true, operatorPassword = false, now = () => Date.now(), auditLog = createAdminAuditLog({ key: 'test-key' }) } = {}) {
  const app = express();
  const adminId = `acct-admin-${++harnessSerial}`;
  // The write budget is shared per operator across route families, so each
  // harness plays a different operator and starts with a clean window.
  const resolveAccount = (req) => {
    if (req.headers.cookie === ADMIN_COOKIE) return { id: adminId };
    if (req.headers.cookie === MEMBER_COOKIE) return { id: 'acct-member' };
    return null;
  };
  const metrics = createMetricsRegistry();
  const changes = [];
  const maintenance = createDrainController({ getActiveRounds: () => 2, onChange: snapshot => changes.push(snapshot.lockout ? `${snapshot.mode}+lockout` : snapshot.mode) });
  const store = createAiProviderStore({});
  const advisor = new AiAdvisor({ apiKey: '', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  const reply = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.messages) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
    return { ok: true, status: 200, json: async () => ({ output_text: '{"ok":true}' }) };
  };
  const providerManager = createAiProviderManager({ store, advisor, fetchImpl: reply, requestImpl: reply, resolveHost: async () => [{ address: '8.8.8.8', family: 4 }] });
  const common = { accountResolver: resolveAccount, adminIds: [adminId], accountStore: null };
  if (withProviders) registerAiProviderRoutes(app, { ...common, manager: providerManager, auditLog });
  registerAdminOpsRoutes(app, {
    ...common,
    maintenance,
    auditLog,
    metrics,
    rollup,
    providerManager,
    roomManager: { rooms },
    roomActivity: createRoomActivityTracker(),
    operatorPassword,
    now,
    readRuntime: () => ({
      uptimeSeconds: 120,
      sockets: 3,
      rooms: rooms.size,
      activeRounds: 2,
      backup: { configured: true, fresh: true, lastRunAt: new Date().toISOString(), failures: 0 },
      backupIntervalMs: 900_000,
      storesLoaded: true,
      dataDirectory: true,
    }),
  });
  return { app, metrics, auditLog, maintenance, changes, providerManager };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(resolve => server.close(resolve)) };
}

const call = (base, pathname, { cookie = ADMIN_COOKIE, method = 'GET', body, headers = {} } = {}) => fetch(`${base}${pathname}`, {
  method,
  headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
});

const GETS = ['/admin/ops/status', '/admin/ops/rooms', '/admin/ops/bots', '/admin/ops/audit'];

const secretRoom = () => ({
  roomCode: 'QX7ZKD',
  roomName: 'Zelda private table',
  visibility: 'private',
  destroyed: false,
  game: {
    started: true, roundNumber: 4, lastEndReason: null, feed: [{ text: 'secret chat line' }],
    players: [
      { id: 'player-id-77', nickname: 'ZeldaTheGreat', clientId: 'client-77', accountId: 'acct-77', isBot: false, disconnected: false },
      { id: 'player-id-78', nickname: 'Botty', isBot: true, disconnected: false },
    ],
  },
});

// This harness writes through both route families in the shared per-operator
// budget. Its ops clock runs one window ahead of the provider family's real
// clock, so each family's burst starts a fresh window instead of tripping the
// limit inside the test.
const harness = buildHarness({ rooms: new Map([['QX7ZKD', secretRoom()]]), now: () => Date.now() + 61_000 });
const { base, close } = await listen(harness.app);

try {
  await check('refuses every ops route without a session (401), for non-admins (403) and for foreign origins (403)', async () => {
    for (const route of GETS) {
      assert.equal((await call(base, route, { cookie: null })).status, 401, route);
      assert.equal((await call(base, route, { cookie: MEMBER_COOKIE })).status, 403, route);
      assert.equal((await call(base, route, { headers: { origin: 'https://evil.example' } })).status, 403, route);
      assert.equal((await call(base, route, { headers: { origin: base } })).status, 200, route);
    }
    assert.equal((await call(base, '/admin/ops/maintenance', { cookie: null, method: 'POST', body: { mode: 'normal' } })).status, 401);
    assert.equal((await call(base, '/admin/ops/maintenance', { cookie: MEMBER_COOKIE, method: 'POST', body: { mode: 'normal' } })).status, 403);
    assert.equal((await call(base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'draining' }, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.deepEqual(harness.changes, [], 'a refused request must not change the drain state');
    assert.equal(harness.auditLog.list().length, 0, 'refused requests are not operator changes');
  });

  await check('marks every ops response, including refusals, as no-store', async () => {
    for (const response of [
      await call(base, '/admin/ops/status', { cookie: null }),
      await call(base, '/admin/ops/status', { cookie: MEMBER_COOKIE }),
      await call(base, '/admin/ops/status'),
      await call(base, '/admin/ops/rooms'),
    ]) {
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });

  await check('GET /admin/ops/status returns the contract shape from live server state', async () => {
    harness.metrics.setMetric('active-sockets', 3, { scope: 'all' });
    const body = await (await call(base, '/admin/ops/status')).json();
    assert.equal(body.success, true);
    assert.equal(['healthy', 'degraded', 'down'].includes(body.health.state), true);
    assert.deepEqual(body.health.checks.map(item => item.id), ['backup', 'errors', 'restore', 'latency', 'storage']);
    assert.equal(body.health.sockets, 3);
    assert.equal(body.health.rooms, 1);
    assert.equal(body.health.activeRounds, 2);
    assert.equal(body.health.uptimeSeconds, 120);
    assert.equal(body.health.backup.configured, true);
    assert.equal(body.health.latencyP95Ms, null);
    assert.equal(body.maintenance.mode, 'normal');
    assert.equal(typeof body.generatedAt, 'string');
  });

  await check('GET /admin/ops/rooms never exposes a room code, name, nickname, id or chat', async () => {
    const response = await call(base, '/admin/ops/rooms');
    const text = await response.text();
    ['QX7ZKD', 'qx7zkd', 'Zelda', 'Botty', 'player-id', 'client-77', 'acct-77', 'secret chat'].forEach(fragment => assert.equal(text.includes(fragment), false, fragment));
    const body = JSON.parse(text);
    assert.deepEqual(body.totals, { rooms: 1, lobby: 0, playing: 1, humans: 1, bots: 1 });
    assert.match(body.rooms[0].id, /^r-[0-9a-f]{6}$/);
    assert.equal(body.rooms[0].visibility, 'private');
    assert.equal(body.rooms[0].round, 4);
  });

  await check('GET /admin/ops/bots validates the range and reports provider status without secrets', async () => {
    const body = await (await call(base, '/admin/ops/bots?range=season')).json();
    assert.equal(body.success, true);
    assert.equal(body.range, 'month');
    assert.deepEqual(Object.keys(body.totals).sort(), ['botMatches', 'decisions', 'fallbackRate', 'fallbacks', 'sampleSize']);
    assert.deepEqual(Object.keys(body.provider).sort(), ['activeLabel', 'capPerBot', 'state']);
    assert.equal((await (await call(base, '/admin/ops/bots?range=bogus')).json()).range, 'hour');
  });

  await check('POST /admin/ops/maintenance runs the drain controller transitions and audits each one', async () => {
    const post = body => call(base, '/admin/ops/maintenance', { method: 'POST', body });
    const drain = await post({ mode: 'draining', message: 'Deploy in a few minutes', releaseId: 'rel-7', deadline: new Date(Date.now() + 3_600_000).toISOString() });
    const drained = await drain.json();
    assert.equal(drain.status, 200);
    assert.equal(drained.success, true);
    assert.equal(drained.maintenance.mode, 'draining');
    assert.equal(drained.maintenance.releaseId, 'rel-7');
    assert.equal(drained.maintenance.activeRounds, 2);
    assert.equal(harness.maintenance.snapshot().mode, 'draining');
    assert.equal(harness.maintenance.canStartRound(), false);
    const status = await (await call(base, '/admin/ops/status')).json();
    assert.equal(status.maintenance.mode, 'draining');
    assert.equal(status.health.state, 'degraded');
    const closed = await (await post({ mode: 'maintenance', message: 'Back soon' })).json();
    assert.equal(closed.maintenance.mode, 'maintenance');
    assert.equal(closed.maintenance.message, 'Back soon');
    const refused = await post({ mode: 'draining', deadline: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).success, false);
    assert.equal(harness.maintenance.snapshot().mode, 'maintenance');
    const normal = await (await post({ mode: 'normal' })).json();
    assert.equal(normal.maintenance.mode, 'normal');
    assert.equal(harness.maintenance.canCreateRoom(), true);
    assert.deepEqual(harness.changes, ['draining', 'maintenance', 'normal']);
    const entries = (await (await call(base, '/admin/ops/audit')).json()).entries;
    assert.deepEqual(entries.map(item => [item.area, item.action, item.target, item.outcome]), [
      ['release', 'mode', 'normal', 'ok'],
      ['release', 'mode', 'draining', 'failed'],
      ['release', 'mode', 'maintenance', 'ok'],
      ['release', 'mode', 'draining', 'ok'],
    ]);
  });

  await check('rejects bad maintenance input with 400 and leaves the controller alone', async () => {
    const before = harness.changes.length;
    const post = body => call(base, '/admin/ops/maintenance', { method: 'POST', body });
    for (const body of [{}, { mode: 'explode' }, { mode: 42 }, { mode: 'draining', deadline: 'not a date' }, { mode: 'draining', deadline: '2020-01-01T00:00:00.000Z' }]) {
      const response = await post(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      const payload = await response.json();
      assert.equal(payload.success, false);
      assert.equal(typeof payload.error, 'string');
    }
    const malformed = await call(base, '/admin/ops/maintenance', { method: 'POST', body: '{broken' });
    assert.equal(malformed.status, 400);
    assert.equal((await call(base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'normal', message: 'x'.repeat(6000) } })).status, 413);
    assert.equal(harness.changes.length, before);
    assert.equal(harness.maintenance.snapshot().mode, 'normal');
  });

  await check('provider changes through /admin/ai write the same audit log without keys, urls or account ids', async () => {
    const send = (pathname, method, body) => call(base, pathname, { method, body: body ?? {} });
    const created = await send('/admin/ai/providers', 'POST', { id: 'main', label: 'Main provider', baseUrl: 'https://provider.test/v1', model: 'chat-model', protocol: 'auto', apiKey: 'sk-secret-key-9999' });
    assert.equal(created.status, 201);
    assert.equal((await send('/admin/ai/providers', 'POST', { baseUrl: 'https://provider.test/v1' })).status, 400);
    assert.equal((await send('/admin/ai/providers/main', 'PATCH', { model: 'chat-model-2' })).status, 200);
    assert.equal((await send('/admin/ai/providers/main/test', 'POST')).status, 200);
    assert.equal((await send('/admin/ai/providers/main/activate', 'POST')).status, 200);
    assert.equal((await send('/admin/ai/providers/nope/activate', 'POST')).status, 409);
    assert.equal((await send('/admin/ai/providers/main', 'DELETE')).status, 409);
    const entries = (await (await call(base, '/admin/ops/audit')).json()).entries.filter(item => item.area === 'provider');
    assert.deepEqual(entries.map(item => `${item.action}:${item.target}:${item.outcome}`).reverse(), [
      'create:Main provider:ok',
      'create:unknown:failed',
      'update:Main provider:ok',
      'test:Main provider:ok',
      'activate:Main provider:ok',
      'activate:unknown:failed',
      'delete:Main provider:failed',
    ]);
    entries.forEach(item => assert.match(item.actor, /^admin-[0-9a-f]{8}$/));
    const text = JSON.stringify((await (await call(base, '/admin/ops/audit')).json()));
    ['sk-secret', 'provider.test', 'acct-admin', 'baseUrl', 'apiKey'].forEach(fragment => assert.equal(text.includes(fragment), false, fragment));
    // The activation also reaches the bots report.
    const bots = await (await call(base, '/admin/ops/bots')).json();
    assert.equal(bots.provider.activeLabel, 'Main provider');
    assert.equal(bots.provider.capPerBot > 0, true);
  });

  await check('the audit route returns newest first and at most 50 entries', async () => {
    for (let index = 0; index < 60; index += 1) harness.auditLog.record({ area: 'provider', action: 'test', target: `bulk ${index}`, accountId: 'acct-admin', outcome: 'ok' });
    const entries = (await (await call(base, '/admin/ops/audit')).json()).entries;
    assert.equal(entries.length, 50);
    assert.equal(entries[0].target, 'bulk 59');
  });
} finally {
  await close();
}

// The write limit is shared by the guard: 12 changes a minute per admin, then 429.
const limited = buildHarness({ withProviders: false });
const limitedServer = await listen(limited.app);
try {
  await check('rate-limits ops writes after 12 a minute with Retry-After', async () => {
    let last;
    for (let index = 0; index < 13; index += 1) last = await call(limitedServer.base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'normal' } });
    assert.equal(last.status, 429);
    assert.equal(Number(last.headers.get('retry-after')) > 0, true);
    assert.equal((await call(limitedServer.base, '/admin/ops/status')).status, 200, 'reads are not rate limited');
  });
} finally {
  await limitedServer.close();
}

// A rollup that never loaded must not be reported as zero bot usage.
const broken = buildHarness({ rollup: { health: () => ({ loaded: false }), query: () => ({}) }, withProviders: false });
const brokenServer = await listen(broken.app);
try {
  await check('bots report is 503 when the analytics rollup is not loaded', async () => {
    assert.equal((await call(brokenServer.base, '/admin/ops/bots')).status, 503);
  });
} finally {
  await brokenServer.close();
}

// The live counters reach the operator routes: unknown before the first event, real after it.
const counted = buildHarness({ withProviders: false });
const countedServer = await listen(counted.app);
try {
  await check('rooms, bots and status report the since-start counters, null until recorded', async () => {
    const read = async pathname => (await call(countedServer.base, pathname)).json();
    assert.equal((await read('/admin/ops/rooms')).sinceStart.reconnects, null);
    assert.equal((await read('/admin/ops/bots')).sinceStart.fallbacks, null);
    assert.equal((await read('/admin/ops/status')).health.roomReconnects, null);
    counted.metrics.incrementMetric('room-reconnects', { scope: 'seat' });
    counted.metrics.incrementMetric('room-reconnects', { scope: 'seat' });
    counted.metrics.incrementMetric('bot-fallbacks', { scope: 'ai' });
    assert.equal((await read('/admin/ops/rooms')).sinceStart.reconnects, 2);
    assert.equal((await read('/admin/ops/bots')).sinceStart.fallbacks, 1);
    const status = await read('/admin/ops/status');
    assert.equal(status.health.roomReconnects, 2);
    assert.equal(status.health.botFallbacks, 1);
  });
} finally {
  await countedServer.close();
}

// Release inputs: what the Release tab sends, and what the route refuses.
const release = buildHarness({ withProviders: false });
const releaseServer = await listen(release.app);
try {
  await check('a drain keeps its release id and deadline, a bad one is a 400 that changes nothing', async () => {
    const post = body => call(releaseServer.base, '/admin/ops/maintenance', { method: 'POST', body });
    const day = 24 * 60 * 60 * 1000;
    const refusals = [
      { mode: 'draining', releaseId: 'rel 7' },
      { mode: 'draining', releaseId: 'rel/7' },
      { mode: 'draining', releaseId: 42 },
      { mode: 'maintenance', releaseId: '<b>x</b>' },
      { mode: 'draining', releaseId: 'r'.repeat(81) },
      // setTimeout treats a delay past about 24.8 days as 1 ms, which would end the drain at once.
      { mode: 'draining', deadline: new Date(Date.now() + 60 * day).toISOString() },
      { mode: 'draining', deadline: Date.now() + 60 * day },
    ];
    for (const body of refusals) {
      const response = await post(body);
      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal((await response.json()).success, false);
    }
    assert.deepEqual(release.changes, [], 'a refused request never reaches the drain controller');
    assert.equal(release.maintenance.snapshot().mode, 'normal');
    const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
    const accepted = await (await post({ mode: 'draining', releaseId: 'rel-2026.10_a', deadline, message: 'Deploy at nine' })).json();
    assert.equal(accepted.maintenance.mode, 'draining');
    assert.equal(accepted.maintenance.releaseId, 'rel-2026.10_a');
    assert.equal(accepted.maintenance.drainDeadline, deadline);
    const status = await (await call(releaseServer.base, '/admin/ops/status')).json();
    assert.equal(status.maintenance.releaseId, 'rel-2026.10_a');
    assert.equal(status.maintenance.drainDeadline, deadline);
    // Going from a drain to maintenance without a new id keeps the release the drain was for.
    const closed = await (await post({ mode: 'maintenance' })).json();
    assert.equal(closed.maintenance.releaseId, 'rel-2026.10_a');
    // Blank optional fields mean "not given", as the form sends them.
    await post({ mode: 'normal' });
    const blank = await (await post({ mode: 'draining', releaseId: '', deadline: '', message: '' })).json();
    assert.equal(blank.maintenance.releaseId, '');
    assert.equal(blank.maintenance.drainDeadline, null);
    release.maintenance.dispose();
  });

  await check('the audit log keeps the mode only: no release id, deadline or message', async () => {
    await call(releaseServer.base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'maintenance', releaseId: 'rel-secret-77', message: 'Operator note about payroll' } });
    const text = JSON.stringify(await (await call(releaseServer.base, '/admin/ops/audit')).json());
    ['rel-secret-77', 'payroll', 'Operator note'].forEach(fragment => assert.equal(text.includes(fragment), false, fragment));
    assert.match(text, /"target":"maintenance"/);
  });
} finally {
  await releaseServer.close();
}

// The lockout toggle: the full "under maintenance" panel for the public site.
// The clock moves a minute per toggle so the 12-a-minute write limit (tested
// above) does not cut the sequence short.
let lockoutClock = Date.now();
const lockout = buildHarness({ withProviders: false, operatorPassword: true, now: () => lockoutClock });
const lockoutServer = await listen(lockout.app);
try {
  const toggle = (body, options = {}) => {
    lockoutClock += 61_000;
    return call(lockoutServer.base, '/admin/ops/lockout', { method: 'POST', body, ...options });
  };

  await check('POST /admin/ops/lockout is behind the admin guard', async () => {
    assert.equal((await toggle({ enabled: true }, { cookie: null })).status, 401);
    assert.equal((await toggle({ enabled: true }, { cookie: MEMBER_COOKIE })).status, 403);
    assert.equal((await toggle({ enabled: true }, { headers: { origin: 'https://evil.example' } })).status, 403);
    const refused = await toggle({ enabled: true }, { cookie: null });
    assert.equal(refused.headers.get('cache-control'), 'no-store');
    assert.deepEqual(lockout.changes, []);
    assert.equal(lockout.auditLog.list().length, 0);
  });

  await check('enabling the lockout enters maintenance with the panel on and shows in status', async () => {
    const before = await (await call(lockoutServer.base, '/admin/ops/status')).json();
    assert.equal(before.maintenance.lockout, false);
    assert.equal(before.maintenance.operatorPassword, true, 'the console can say whether password sign-in exists');
    const response = await toggle({ enabled: true, message: '  Back at <b>ten</b>  ', releaseId: 'rel-11' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.maintenance.mode, 'maintenance');
    assert.equal(body.maintenance.lockout, true);
    assert.equal(body.maintenance.message, 'Back at bten/b', 'the message goes through the maintenance sanitiser');
    assert.equal(body.maintenance.releaseId, 'rel-11');
    const status = await (await call(lockoutServer.base, '/admin/ops/status')).json();
    assert.equal(status.maintenance.lockout, true);
    assert.equal(status.maintenance.mode, 'maintenance');
    assert.equal(status.health.state, 'degraded');
    // Idempotent: a second "on" answers 200 with the same state.
    const again = await (await toggle({ enabled: true })).json();
    assert.equal(again.maintenance.lockout, true);
    assert.equal(again.maintenance.message, 'Back at bten/b', 'repeating the toggle keeps the message');
  });

  await check('the MAINTENANCE button keeps the lockout and a drain cannot relax it', async () => {
    const kept = await (await call(lockoutServer.base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'maintenance', message: 'Still busy' } })).json();
    assert.equal(kept.maintenance.lockout, true);
    const drain = await call(lockoutServer.base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'draining' } });
    assert.equal(drain.status, 409);
    assert.equal(lockout.maintenance.snapshot().lockout, true);
  });

  await check('disabling lifts the panel but keeps maintenance; reopen returns to normal', async () => {
    const lifted = await (await toggle({ enabled: false })).json();
    assert.equal(lifted.maintenance.mode, 'maintenance');
    assert.equal(lifted.maintenance.lockout, false);
    const idle = await toggle({ enabled: false });
    assert.equal(idle.status, 200, 'turning off an absent lockout is a no-op, not an error');
    await toggle({ enabled: true });
    const reopened = await (await toggle({ enabled: false, reopen: true })).json();
    assert.equal(reopened.maintenance.mode, 'normal');
    assert.equal(reopened.maintenance.lockout, false);
    assert.deepEqual(lockout.changes, ['maintenance+lockout', 'maintenance+lockout', 'maintenance+lockout', 'maintenance', 'maintenance+lockout', 'normal']);
  });

  await check('bad lockout input is a 400 that changes nothing', async () => {
    const before = lockout.changes.length;
    for (const body of [{}, { enabled: 'true' }, { enabled: 1 }, { enabled: true, reopen: true }, { enabled: true, releaseId: 'rel 7' }, { enabled: false, reopen: 'yes' }]) {
      const response = await toggle(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal((await response.json()).success, false);
    }
    assert.equal((await toggle('{broken')).status, 400);
    assert.equal(lockout.changes.length, before);
    assert.equal(lockout.maintenance.snapshot().mode, 'normal');
  });

  await check('the audit log records the toggle only: no message or release id', async () => {
    await toggle({ enabled: true, message: 'Payroll migration secret', releaseId: 'rel-secret-99' });
    const entries = (await (await call(lockoutServer.base, '/admin/ops/audit')).json()).entries.filter(item => item.action === 'lockout');
    assert.deepEqual(entries.map(item => `${item.target}:${item.outcome}`).reverse(), [
      'on:ok', 'on:ok', 'off:ok', 'off:ok', 'on:ok', 'reopen:ok',
      'invalid:failed', 'invalid:failed', 'invalid:failed', 'invalid:failed', 'on:failed', 'invalid:failed',
      'on:ok',
    ]);
    const text = JSON.stringify(await (await call(lockoutServer.base, '/admin/ops/audit')).json());
    ['Payroll', 'rel-secret-99', 'acct-admin'].forEach(fragment => assert.equal(text.includes(fragment), false, fragment));
    lockout.maintenance.dispose();
  });
} finally {
  await lockoutServer.close();
}

const noPassword = buildHarness({ withProviders: false });
const noPasswordServer = await listen(noPassword.app);
try {
  await check('status reports when no operator password is configured', async () => {
    const status = await (await call(noPasswordServer.base, '/admin/ops/status')).json();
    assert.equal(status.maintenance.operatorPassword, false);
  });
} finally {
  await noPasswordServer.close();
}

// Body-parser failures other than bad JSON, and the order of auth and parsing.
const parsing = buildHarness();
const parsingServer = await listen(parsing.app);
try {
  await check('an unsupported request Content-Encoding answers 415 JSON, not the 500 page', async () => {
    const response = await call(parsingServer.base, '/admin/ops/maintenance', { method: 'POST', body: '{"mode":"normal"}', headers: { 'content-encoding': 'br' } });
    assert.equal(response.status, 415);
    assert.match(response.headers.get('content-type') || '', /json/);
    assert.equal((await response.json()).success, false);
  });

  await check('/admin/ai refuses an anonymous caller before parsing and answers no-store', async () => {
    const malformed = await call(parsingServer.base, '/admin/ai/providers', { method: 'POST', cookie: null, body: '{bad' });
    assert.equal(malformed.status, 401);
    assert.equal(malformed.headers.get('cache-control'), 'no-store');
    const oversized = await call(parsingServer.base, '/admin/ai/providers', { method: 'POST', cookie: null, body: JSON.stringify({ pad: 'x'.repeat(20_000) }) });
    assert.equal(oversized.status, 401);
    const member = await call(parsingServer.base, '/admin/ai/providers', { method: 'POST', cookie: MEMBER_COOKIE, body: '{bad' });
    assert.equal(member.status, 403);
    assert.equal(member.headers.get('cache-control'), 'no-store');
  });

  await check('/admin/ai answers malformed and oversized admin JSON with 400 and 413', async () => {
    const malformed = await call(parsingServer.base, '/admin/ai/providers', { method: 'POST', body: '{bad' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).success, false);
    const oversized = await call(parsingServer.base, '/admin/ai/providers', { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(20_000) }) });
    assert.equal(oversized.status, 413);
    const encoded = await call(parsingServer.base, '/admin/ai/providers', { method: 'POST', body: '{}', headers: { 'content-encoding': 'br' } });
    assert.equal(encoded.status, 415);
  });
} finally {
  parsing.maintenance.dispose();
  await parsingServer.close();
}

const unsaved = express();
const unsavedAudit = createAdminAuditLog({ key: 'test-key' });
const unsavedMaintenance = createDrainController({ onChange: () => false });
registerAdminOpsRoutes(unsaved, {
  accountResolver,
  adminIds: ['acct-admin'],
  maintenance: unsavedMaintenance,
  auditLog: unsavedAudit,
  metrics: createMetricsRegistry(),
  rollup: createAnalyticsRollupStore({}),
  roomManager: { rooms: new Map() },
  roomActivity: createRoomActivityTracker(),
});
const unsavedServer = await listen(unsaved);
try {
  await check('a maintenance change that could not be persisted says so instead of plain success', async () => {
    const response = await call(unsavedServer.base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'maintenance' } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.persisted, false);
    assert.equal(body.maintenance.mode, 'maintenance');
    const entries = (await (await call(unsavedServer.base, '/admin/ops/audit')).json()).entries;
    assert.equal(entries[0].outcome, 'failed');
    const lockout = await (await call(unsavedServer.base, '/admin/ops/lockout', { method: 'POST', body: { enabled: false, reopen: true } })).json();
    assert.equal(lockout.persisted, false);
  });
} finally {
  await unsavedServer.close();
}

function guardResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function guardRequest(headers = {}) {
  return { headers, get: name => headers[String(name).toLowerCase()] || '', sessionCookie: '' };
}

await check('the write budget is shared across admin route families for one operator', async () => {
  const accountId = 'acct-shared-budget';
  const options = { accountResolver: () => ({ id: accountId }), adminIds: [accountId], now: () => Date.now() };
  const familyA = createAdminGuard(options);
  const familyB = createAdminGuard(options);
  const write = (guard) => {
    const req = guardRequest();
    req.adminAccountId = accountId;
    const res = guardResponse();
    let passed = false;
    guard.writeGuard(req, res, () => { passed = true; });
    return { res, passed };
  };
  for (let index = 0; index < 12; index += 1) assert.equal(write(familyA).passed, true, `write ${index + 1}`);
  const denied = write(familyB);
  assert.equal(denied.passed, false, 'a sibling route family sees the same budget');
  assert.equal(denied.res.statusCode, 429);
});

await check('a denied admin request still delivers the cookie that replaced its legacy bearer', async () => {
  const cookie = 'poorup_session=replacement; Path=/; HttpOnly';
  const cases = [
    { accountId: 'acct-member', origin: '' },
    { accountId: 'acct-admin-6', origin: 'https://evil.example' },
  ];
  for (const item of cases) {
    const guard = createAdminGuard({
      accountResolver: (req) => { req.sessionCookie = cookie; return { id: item.accountId }; },
      adminIds: ['acct-admin-6'],
    });
    const req = guardRequest(item.origin ? { origin: item.origin } : {});
    const res = guardResponse();
    let passed = false;
    guard.requireAdmin(req, res, () => { passed = true; });
    assert.equal(passed, false, item.accountId);
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['set-cookie'], cookie, `${item.accountId} must keep a usable credential`);
  }
});

// An action is still performed when the audit entry could not be saved, but
// the operator is told the trail has a hole in it.
const realAuditLog = createAdminAuditLog({ key: 'test-key' });
let auditRecord = (...args) => realAuditLog.record(...args);
const unaudited = buildHarness({ auditLog: { record: (...args) => auditRecord(...args), list: () => realAuditLog.list() } });
const unauditedServer = await listen(unaudited.app);
try {
  await check('release and provider changes answer audited:false when the audit entry was not persisted', async () => {
    const errors = [];
    const realError = console.error;
    console.error = (...args) => { errors.push(args.join(' ')); };
    try {
      // Persisted: the response is unchanged (no audited field).
      const ok = await (await call(unauditedServer.base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'maintenance' } })).json();
      assert.equal(Object.hasOwn(ok, 'audited'), false);
      auditRecord = () => ({ persisted: false });
      const mode = await call(unauditedServer.base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'normal' } });
      assert.equal(mode.status, 200);
      const modeBody = await mode.json();
      assert.equal(modeBody.success, true);
      assert.equal(modeBody.audited, false);
      assert.equal(unaudited.maintenance.snapshot().mode, 'normal', 'the action was still performed');
      const lock = await call(unauditedServer.base, '/admin/ops/lockout', { method: 'POST', body: { enabled: true } });
      assert.equal(lock.status, 200);
      assert.equal((await lock.json()).audited, false);
      // A rejected entry (null) is the same hole.
      auditRecord = () => null;
      const rejected = await (await call(unauditedServer.base, '/admin/ops/lockout', { method: 'POST', body: { enabled: false, reopen: true } })).json();
      assert.equal(rejected.audited, false);
      // A throwing log too.
      auditRecord = () => { throw new Error('boom'); };
      const thrown = await (await call(unauditedServer.base, '/admin/ops/maintenance', { method: 'POST', body: { mode: 'maintenance' } })).json();
      assert.equal(thrown.audited, false);
      // Provider route.
      auditRecord = () => ({ persisted: false });
      const created = await call(unauditedServer.base, '/admin/ai/providers', { method: 'POST', body: { id: 'p1', label: 'P1', baseUrl: 'https://provider.test/v1', model: 'm', protocol: 'chat', apiKey: 'secret-key' } });
      assert.equal(created.status, 201);
      assert.equal((await created.json()).audited, false);
    } finally {
      console.error = realError;
      auditRecord = (...args) => realAuditLog.record(...args);
    }
    assert.equal(errors.some(line => /audit/i.test(line)), true, 'a server error line is logged');
  });
} finally {
  await unauditedServer.close();
}
