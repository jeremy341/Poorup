/* global process */
import assert from 'node:assert/strict';

globalThis.window = { location: { pathname: '/admin/analytics' } };
const { normalizeOpsStatus, normalizeOpsRooms, normalizeOpsBots, normalizeOpsAudit, normalizeMaintenance, fetchOps, postMaintenance, postLockout, buildLockoutRequest, OPS_ENDPOINTS } = await import('./clientAdminOps.js');
const panels = await import('./clientAdminPanels.js');

function check(name, run) {
  try { run(); console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
async function checkAsync(name, run) {
  try { await run(); console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}

check('status keeps the contract fields and turns unknown values into explicit nulls', () => {
  const status = normalizeOpsStatus({
    generatedAt: '2026-09-15T12:00:00.000Z',
    health: { state: 'degraded', checks: [{ id: 'backup', label: 'Backup', state: 'ok', detail: 'fresh' }, { id: 'secrets', label: 'Leak', state: 'ok', detail: 'x' }, { id: 'errors', label: 'Errors', state: 'weird', detail: 'y' }], uptimeSeconds: 90, sockets: 4, rooms: 2, activeRounds: 1, backup: { configured: true, fresh: true, lastRunAt: '2026-09-15T11:00:00.000Z', failures: 0 }, errorCount: 3, restoreFailures: 0, latencyP95Ms: null, accountId: 'raw' },
    maintenance: { mode: 'draining', message: 'Back soon', releaseId: 'r1', drainDeadline: null, activeRounds: 1 },
    sessionToken: 'secret',
  });
  assert.equal(status.health.state, 'degraded');
  assert.deepEqual(status.health.checks.map(check => check.id), ['backup', 'errors'], 'an unknown check id is dropped');
  assert.equal(status.health.checks[1].state, 'unknown', 'an unknown state reads as unknown, not ok');
  assert.equal(status.health.latencyP95Ms, null, 'null stays null');
  assert.equal(status.maintenance.mode, 'draining');
  assert.equal(JSON.stringify(status).includes('secret'), false);
  assert.equal(JSON.stringify(status).includes('raw'), false);
  assert.equal(normalizeOpsStatus({}).health.state, 'unknown');
  assert.equal(normalizeMaintenance({ mode: 'bogus' }).mode, 'normal');
});

check('rooms keep only hashed ids; codes, names and extra fields never pass', () => {
  const model = normalizeOpsRooms({
    totals: { rooms: 3, lobby: 1, playing: 2, humans: 5, bots: 1 },
    rooms: [
      { id: 'r-0a1b2c', phase: 'playing', visibility: 'public', humans: 2, bots: 1, round: 4, ageSeconds: 100, idleSeconds: 5, stalled: false },
      { id: 'ABCDEF', phase: 'lobby', visibility: 'private', humans: 1, bots: 0, round: null, ageSeconds: 5, idleSeconds: 5, stalled: false },
      { id: 'r-zzzzzz', phase: 'lobby', visibility: 'private' },
      { id: 'r-3d4e5f', phase: 'finished', visibility: 'private', humans: 1, bots: 0, roomCode: 'QWERTY', hostName: 'Ada', nickname: 'Bee', stalled: true },
    ],
  });
  assert.deepEqual(model.rooms.map(room => room.id), ['r-0a1b2c', 'r-3d4e5f']);
  assert.equal(model.rooms[1].stalled, true);
  const serialized = JSON.stringify(model);
  for (const leak of ['ABCDEF', 'QWERTY', 'Ada', 'Bee', 'roomCode', 'hostName', 'nickname']) assert.equal(serialized.includes(leak), false, leak);
  assert.equal(model.rooms[0].round, 4);
  assert.equal(normalizeOpsRooms({ rooms: Array.from({ length: 300 }, (_, i) => ({ id: `r-${i.toString(16).padStart(6, '0')}` })) }).rooms.length, 200, 'capped at 200');
});

check('bots keep null as null so the panel can say not recorded', () => {
  const model = normalizeOpsBots({
    range: 'day',
    totals: { botMatches: 10, decisions: null, fallbacks: null, fallbackRate: null, sampleSize: 10 },
    providers: [{ provider: 'openai', botMode: 'ai', matches: 4, decisions: 100, fallbacks: 3, fallbackRate: 0.03, sampleSize: 4, apiKey: 'sk-secret' }],
    provider: { state: 'healthy', activeLabel: null, capPerBot: 240, baseUrl: 'https://x' },
  });
  assert.equal(model.totals.decisions, null);
  assert.equal(model.totals.fallbackRate, null);
  assert.equal(model.providers[0].fallbackRate, 0.03);
  assert.equal(model.provider.activeLabel, null);
  assert.equal(JSON.stringify(model).includes('sk-secret'), false);
  assert.equal(JSON.stringify(model).includes('https://x'), false);
  assert.equal(normalizeOpsBots({}).totals.botMatches, null);
});

check('audit keeps pseudonymous actors only and drops entries it cannot place', () => {
  const model = normalizeOpsAudit({ entries: [
    { at: '2026-09-15T11:58:00.000Z', area: 'provider', action: 'activate', target: 'OpenAI main', actor: 'admin-1a2b3c4d', outcome: 'ok' },
    { at: '2026-09-15T11:59:00.000Z', area: 'release', action: 'mode', target: 'draining', actor: 'ada@example.com', outcome: 'failed', apiKey: 'sk' },
    { at: 'nonsense', area: 'billing', action: 'refund', target: 'x', actor: 'admin-1a2b3c4d', outcome: 'ok' },
  ] });
  assert.equal(model.entries.length, 2);
  assert.equal(model.entries[0].actor, 'admin-1a2b3c4d');
  assert.equal(model.entries[1].actor, 'admin', 'an actor that is not a pseudonym is not shown');
  assert.equal(model.entries[1].outcome, 'failed');
  assert.equal(JSON.stringify(model).includes('example.com'), false);
});

check('usage is one slim line: a missing number says not recorded and a recorded zero stays zero', () => {
  const bots = panels.botsMarkup(normalizeOpsBots({ totals: { botMatches: 0, decisions: null }, providers: [{ provider: '<img src=x onerror=1>', botMode: 'ai', matches: 2, decisions: null }], provider: { state: 'open', activeLabel: '<b>x</b>', capPerBot: null } }));
  assert.match(bots.line, /not recorded/);
  assert.match(bots.line, />0</, 'a recorded zero is still zero');
  assert.equal(bots.line.includes('<img'), false);
  assert.equal(bots.line.includes('<b>'), false);
  assert.doesNotMatch(bots.line, /<table/, 'no provider table: the roster and the log carry the detail');
  assert.equal((bots.line.match(/<dt /g) || []).length, 6, 'five rollup figures and the since-start fallback count');
});

check('rooms are one inline totals line and a plain table of hashed ids', () => {
  const rooms = panels.roomsMarkup(normalizeOpsRooms({ totals: { rooms: 1, lobby: 0, playing: 1, humans: 1, bots: 0 }, rooms: [{ id: 'r-0a1b2c', phase: 'playing', visibility: 'public', humans: 1, bots: 0, round: null, ageSeconds: 3700, idleSeconds: 12, stalled: true }] }));
  assert.match(rooms.totals, /<p class="[^"]*admin-totals-line">/);
  assert.match(rooms.totals, /<b>1<\/b> rooms/);
  assert.doesNotMatch(rooms.totals, /<dl|<dt/, 'not a sidebar of tiles');
  assert.match(rooms.table, /data-room-id="r-0a1b2c"/);
  assert.match(rooms.table, /STALLED/, 'a stalled room is labelled, not only coloured');
  assert.match(rooms.table, /1h 01m/);
  assert.match(rooms.table, /<caption class="sr-only">/);
  assert.equal(rooms.count, 1);
});

check('health is one slim line: the verdict, then only the checks that need attention', () => {
  const at = '2026-09-15T12:00:00.000Z';
  const degraded = panels.healthMarkup(normalizeOpsStatus({ generatedAt: at, health: { state: 'degraded', checks: [{ id: 'backup', label: 'Backup', state: 'ok', detail: 'fresh' }, { id: 'errors', label: 'Errors', state: 'warn', detail: '14 in the last hour' }, { id: 'latency', label: 'Latency', state: 'unknown', detail: '' }] } }));
  assert.match(degraded, /data-health-state="degraded"/);
  assert.match(degraded, />DEGRADED</);
  assert.match(degraded, /Errors<\/span> <span[^>]*>WARN</);
  assert.match(degraded, /title="14 in the last hour"/);
  assert.doesNotMatch(degraded, /Backup|Latency|NO DATA/, 'ok and no-data checks are not listed');
  const healthy = panels.healthMarkup(normalizeOpsStatus({ generatedAt: at, health: { state: 'healthy', checks: [{ id: 'backup', label: 'Backup', state: 'ok', detail: 'fresh' }], uptimeSeconds: 99, sockets: 4 } }));
  assert.match(healthy, />HEALTHY</);
  assert.doesNotMatch(healthy, /<ul|Backup|UPTIME|SOCKETS|uptime|sockets/i, 'healthy is just the pill, with no stat band');
  const down = panels.healthMarkup(normalizeOpsStatus({ health: { state: 'down', checks: [{ id: 'storage', label: 'Storage', state: 'bad', detail: 'full' }] } }));
  assert.match(down, />DOWN</);
  assert.match(down, />FAILING</);
  assert.match(panels.healthMarkup(normalizeOpsStatus({})), />NO READING</);
});

check('the change log keeps the newest ten entries', () => {
  const entries = Array.from({ length: 14 }, (_, index) => ({ at: '2026-09-15T12:00:00.000Z', area: 'release', action: 'mode', target: `t-${index}`, actor: 'admin-1a2b3c4d', outcome: index === 0 ? 'failed' : 'ok' }));
  const html = panels.auditMarkup(entries);
  assert.equal((html.match(/<li /g) || []).length, 10);
  assert.match(html, /t-0/);
  assert.doesNotMatch(html, /t-10/);
  assert.match(html, />FAILED</);
});

check('release actions follow the controller: drain only from open, resume only when closed', () => {
  assert.deepEqual(panels.releaseActions('normal'), { draining: true, maintenance: true, normal: false });
  assert.deepEqual(panels.releaseActions('draining'), { draining: false, maintenance: true, normal: true });
  assert.deepEqual(panels.releaseActions('maintenance'), { draining: false, maintenance: false, normal: true });
  for (const mode of ['draining', 'maintenance', 'normal']) assert.ok(panels.RELEASE_COPY[mode].confirm.length > 0);
});

await checkAsync('fetchOps reads the right endpoint and maps failures without throwing', async () => {
  const seen = [];
  const reply = (status, body) => async (path, init) => { seen.push({ path, init }); return { ok: status < 400, status, json: async () => body }; };
  const ok = await fetchOps('bots', { range: 'week', fetcher: reply(200, { success: true, totals: {}, providers: [] }) });
  assert.equal(ok.ok, true);
  assert.equal(seen[0].path, '/admin/ops/bots?range=week');
  assert.equal(seen[0].init.credentials, 'include');
  assert.equal(seen[0].init.method, 'GET');
  assert.equal((await fetchOps('status', { fetcher: reply(403, { success: false }) })).status, 403);
  assert.equal((await fetchOps('status', { fetcher: reply(403, { success: false }) })).model, null);
  assert.equal((await fetchOps('rooms', { fetcher: async () => { throw new Error('offline'); } })).status, 503);
  assert.equal((await fetchOps('rooms', { fetcher: async () => { const error = new Error('x'); error.name = 'AbortError'; throw error; } })).aborted, true);
  assert.equal((await fetchOps('constructor', {})).ok, false, 'only known resources are fetched');
  assert.equal(OPS_ENDPOINTS.maintenance, '/admin/ops/maintenance');
});

await checkAsync('postMaintenance sends only mode and a trimmed message, and reports server refusals', async () => {
  const seen = [];
  const fetcher = async (path, init) => { seen.push({ path, init }); return { ok: true, status: 200, json: async () => ({ success: true, maintenance: { mode: 'draining', message: 'Back soon' } }) }; };
  const done = await postMaintenance({ mode: 'draining', message: '  Back soon\u0007  ' }, { fetcher });
  assert.equal(done.ok, true);
  assert.equal(done.maintenance.mode, 'draining');
  assert.equal(seen[0].path, '/admin/ops/maintenance');
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].init.body), { mode: 'draining', message: 'Back soon' });
  const refused = await postMaintenance({ mode: 'maintenance' }, { fetcher: async () => ({ ok: false, status: 400, json: async () => ({ success: false, error: 'Choose normal, draining, or maintenance.' }) }) });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 400);
  assert.match(refused.error, /Choose normal/);
  assert.equal((await postMaintenance({ mode: 'bogus' }, { fetcher })).ok, false);
  assert.equal(seen.length, 1, 'an invalid mode never reaches the network');
  assert.equal((await postMaintenance({ mode: 'normal' }, { fetcher: async () => { throw new Error('down'); } })).status, 503);
});

console.log('admin ops client: normalizers, markup and requests pass');

check('since-start counters survive normalizing as numbers or null, and nothing else does', () => {
  const status = normalizeOpsStatus({ health: { state: 'healthy', roomReconnects: 3, botFallbacks: null } });
  assert.equal(status.health.roomReconnects, 3);
  assert.equal(status.health.botFallbacks, null);
  assert.equal(normalizeOpsStatus({}).health.roomReconnects, null);
  assert.equal(normalizeOpsRooms({ sinceStart: { reconnects: 2, roomCode: 'ABCDEF' } }).sinceStart.reconnects, 2);
  assert.equal(JSON.stringify(normalizeOpsRooms({ sinceStart: { reconnects: 2, roomCode: 'ABCDEF' } })).includes('ABCDEF'), false);
  assert.equal(normalizeOpsRooms({}).sinceStart.reconnects, null);
  assert.equal(normalizeOpsBots({ sinceStart: { fallbacks: 0 } }).sinceStart.fallbacks, 0);
  assert.equal(normalizeOpsBots({}).sinceStart.fallbacks, null);
});

check('rooms and bots say not recorded yet for a counter nothing has incremented, and show a recorded zero', () => {
  const none = panels.botsMarkup(normalizeOpsBots({ totals: { botMatches: 1 } }));
  assert.match(none.line, /FALLBACKS SINCE START<\/dt><dd[^>]*><span class="admin-null">not recorded yet</);
  const zero = panels.botsMarkup(normalizeOpsBots({ totals: { botMatches: 1 }, sinceStart: { fallbacks: 0 } }));
  assert.match(zero.line, /FALLBACKS SINCE START<\/dt><dd[^>]*>0</);
  const quiet = panels.roomsMarkup(normalizeOpsRooms({ totals: { rooms: 0 } }));
  assert.match(quiet.totals, /reconnects since start[^<]*<span class="admin-null">not recorded yet</);
  const busy = panels.roomsMarkup(normalizeOpsRooms({ totals: { rooms: 1 }, sinceStart: { reconnects: 4 } }));
  assert.match(busy.totals, /<b>4<\/b> reconnects since start/);
});

// ---- release request: id, deadline and the form's validation ------------------------

const { buildMaintenanceRequest, MAX_DEADLINE_MINUTES } = await import('./clientAdminOps.js');
const NOW_MS = Date.parse('2026-10-20T12:00:00.000Z');
const localStamp = ms => {
  const date = new Date(ms);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

check('release request: id and minutes-from-now become a trimmed id and an ISO deadline', () => {
  const result = buildMaintenanceRequest({ mode: 'draining', message: '  Back at nine ', releaseId: ' rel-2026.10_a ', deadlineMinutes: '30' }, NOW_MS);
  assert.equal(result.ok, true);
  assert.deepEqual(result.body, { mode: 'draining', message: 'Back at nine', releaseId: 'rel-2026.10_a', deadline: '2026-10-20T12:30:00.000Z' });
  // Blank optional fields are left out.
  assert.deepEqual(buildMaintenanceRequest({ mode: 'draining', message: '', releaseId: '', deadlineMinutes: '', deadlineAt: '' }, NOW_MS).body, { mode: 'draining' });
  assert.deepEqual(buildMaintenanceRequest({ mode: 'normal', message: 'x', releaseId: 'rel-1', deadlineMinutes: '5' }, NOW_MS).body, { mode: 'normal' }, 'resume carries nothing');
  const maintenance = buildMaintenanceRequest({ mode: 'maintenance', message: 'Back soon', releaseId: 'rel-1', deadlineMinutes: '5' }, NOW_MS);
  assert.deepEqual(maintenance.body, { mode: 'maintenance', message: 'Back soon', releaseId: 'rel-1' }, 'a deadline belongs to a drain only');
});

check('release request: a date and time is read as local time and sent as ISO', () => {
  const target = NOW_MS + 90 * 60_000;
  const result = buildMaintenanceRequest({ mode: 'draining', deadlineAt: localStamp(target) }, NOW_MS);
  assert.equal(result.ok, true);
  assert.equal(Date.parse(result.body.deadline), Math.floor(target / 60_000) * 60_000);
  assert.match(result.body.deadline, /Z$/);
});

check('release request: bad ids and deadlines are refused with a reason before anything is sent', () => {
  const refused = input => buildMaintenanceRequest({ mode: 'draining', ...input }, NOW_MS);
  for (const releaseId of ['rel 7', 'rel/7', '<b>x</b>', 'r'.repeat(81), 'ünï']) {
    const result = refused({ releaseId });
    assert.equal(result.ok, false, releaseId);
    assert.equal(result.field, 'releaseId');
    assert.match(result.error, /release id/i);
  }
  for (const deadlineMinutes of ['0', '-5', '1.5', 'abc', String(MAX_DEADLINE_MINUTES + 1)]) {
    const result = refused({ deadlineMinutes });
    assert.equal(result.ok, false, deadlineMinutes);
    assert.equal(result.field, 'deadlineMinutes');
  }
  assert.equal(refused({ deadlineMinutes: String(MAX_DEADLINE_MINUTES) }).ok, true, 'two weeks is the limit and is allowed');
  assert.equal(refused({ deadlineAt: localStamp(NOW_MS - 3_600_000) }).field, 'deadlineAt', 'a time in the past');
  assert.equal(refused({ deadlineAt: localStamp(NOW_MS + (MAX_DEADLINE_MINUTES + 120) * 60_000) }).field, 'deadlineAt', 'beyond two weeks');
  assert.equal(refused({ deadlineAt: 'not a date' }).field, 'deadlineAt');
  const both = refused({ deadlineMinutes: '10', deadlineAt: localStamp(NOW_MS + 3_600_000) });
  assert.equal(both.ok, false);
  assert.match(both.error, /not both/i);
  assert.equal(buildMaintenanceRequest({ mode: 'explode' }, NOW_MS).ok, false);
  // A bad value the chosen mode does not use never blocks the change.
  assert.equal(buildMaintenanceRequest({ mode: 'maintenance', deadlineMinutes: 'abc' }, NOW_MS).ok, true);
  assert.equal(buildMaintenanceRequest({ mode: 'normal', releaseId: 'rel 7' }, NOW_MS).ok, true);
});

await checkAsync('postMaintenance and postLockout flag a success whose audit entry was not saved', async () => {
  const unaudited = async () => ({ ok: true, status: 200, json: async () => ({ success: true, audited: false, maintenance: { mode: 'draining' } }) });
  const plain = async () => ({ ok: true, status: 200, json: async () => ({ success: true, maintenance: { mode: 'draining' } }) });
  assert.equal((await postMaintenance({ mode: 'draining' }, { fetcher: unaudited })).audited, false);
  assert.equal((await postLockout({ enabled: false, reopen: true }, { fetcher: unaudited })).audited, false);
  assert.equal((await postMaintenance({ mode: 'draining' }, { fetcher: plain })).audited, true, 'persisted responses carry no flag');
  assert.equal((await postLockout({ enabled: false }, { fetcher: plain })).audited, true);
});

await checkAsync('release request: postMaintenance sends the id and deadline and nothing else the contract lacks', async () => {
  const sent = [];
  const fetcher = async (path, init) => { sent.push({ path, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ success: true, maintenance: { mode: 'draining', releaseId: 'rel-1', drainDeadline: '2026-10-20T12:30:00.000Z' } }) }; };
  const result = await postMaintenance({ mode: 'draining', message: 'Soon', releaseId: 'rel-1', deadline: '2026-10-20T12:30:00.000Z', accountId: 'acct-1' }, { fetcher });
  assert.equal(result.ok, true);
  assert.deepEqual(sent[0].body, { mode: 'draining', message: 'Soon', releaseId: 'rel-1', deadline: '2026-10-20T12:30:00.000Z' });
  assert.equal(result.maintenance.releaseId, 'rel-1');
  assert.equal(result.maintenance.drainDeadline, '2026-10-20T12:30:00.000Z');
  const bad = await postMaintenance({ mode: 'draining', releaseId: 'rel 7' }, { fetcher });
  assert.equal(bad.ok, false);
  assert.equal(sent.length, 1, 'an invalid id never reaches the network');
});

check('release panel: a draining deadline counts down, a passed one says so, and the id shows', () => {
  const draining = { mode: 'draining', message: '', releaseId: 'rel-2026.10_a', drainDeadline: '2026-10-20T12:30:00.000Z', activeRounds: 2 };
  const live = panels.releaseMarkup(draining, NOW_MS);
  assert.match(live, /release <b>rel-2026\.10_a<\/b>/);
  assert.match(live, /data-release-countdown/);
  assert.match(live, /data-deadline="2026-10-20T12:30:00\.000Z"/);
  assert.match(live, />30m 00s</);
  assert.match(live, /2026-10-20 12:30 UTC/);
  const passed = panels.releaseMarkup(draining, NOW_MS + 31 * 60_000);
  assert.doesNotMatch(passed, /data-release-countdown/, 'a deadline in the past is not counted down');
  assert.match(passed, /deadline reached/i);
  const closed = panels.releaseMarkup({ ...draining, mode: 'maintenance' }, NOW_MS);
  assert.doesNotMatch(closed, /data-release-countdown/, 'only a drain counts down');
  assert.doesNotMatch(panels.releaseMarkup({ mode: 'normal', message: '', releaseId: '', drainDeadline: null, activeRounds: 0 }, NOW_MS), /countdown|deadline/);
  assert.equal(panels.formatCountdown(3_723_000), '1h 02m 03s');
  assert.equal(panels.formatCountdown(61_000), '1m 01s');
  assert.equal(panels.formatCountdown(0), '0s');
  assert.equal(panels.formatCountdown(-5), '0s');
});

// ---- the public maintenance panel (lockout) ---------------------------------------------
check('lockout: the snapshot keeps lockout only with maintenance and reads the operator password flag', () => {
  assert.equal(normalizeMaintenance({ mode: 'maintenance', lockout: true, operatorPassword: true }).lockout, true);
  assert.equal(normalizeMaintenance({ mode: 'maintenance', lockout: true, operatorPassword: true }).operatorPassword, true);
  assert.equal(normalizeMaintenance({ mode: 'draining', lockout: true }).lockout, false, 'a lockout never rides on another mode');
  assert.equal(normalizeMaintenance({ mode: 'maintenance', lockout: 'yes', operatorPassword: 1 }).lockout, false, 'only a real boolean counts');
  assert.equal(normalizeMaintenance({ mode: 'maintenance' }).operatorPassword, false);
  assert.equal(normalizeMaintenance(undefined).lockout, false);
});

check('lockout: the change log keeps the lockout action instead of blanking it', () => {
  const log = normalizeOpsAudit({ entries: [
    { at: '2026-10-20T12:00:00.000Z', area: 'release', action: 'lockout', target: 'on', actor: 'admin-1a2b3c4d', outcome: 'ok' },
    { at: '2026-10-20T12:01:00.000Z', area: 'release', action: 'mystery', target: 'on', actor: 'admin-1a2b3c4d', outcome: 'ok' },
  ] });
  assert.deepEqual(log.entries.map(entry => entry.action), ['lockout'], 'unknown actions are still dropped');
  assert.match(panels.auditMarkup(log.entries), /LOCKOUT · on/);
});

check('lockout: request building follows the contract and refuses a bad release id locally', () => {
  assert.deepEqual(buildLockoutRequest({ enabled: true }), { ok: true, body: { enabled: true } });
  assert.deepEqual(buildLockoutRequest({ enabled: true, message: '  Back at nine\u0007 ', releaseId: ' rel-1 ' }), { ok: true, body: { enabled: true, message: 'Back at nine', releaseId: 'rel-1' } });
  assert.deepEqual(buildLockoutRequest({ enabled: false }), { ok: true, body: { enabled: false } });
  assert.deepEqual(buildLockoutRequest({ enabled: false, reopen: true, message: 'ignored', releaseId: 'ignored' }), { ok: true, body: { enabled: false, reopen: true } });
  const bad = buildLockoutRequest({ enabled: true, releaseId: 'rel 7' });
  assert.equal(bad.ok, false);
  assert.equal(bad.field, 'releaseId');
  assert.equal(buildLockoutRequest({}).ok, false, 'enabled must be a boolean');
  assert.equal(buildLockoutRequest({ enabled: 'true' }).ok, false);
  assert.equal(OPS_ENDPOINTS.lockout, '/admin/ops/lockout');
});

await checkAsync('lockout: postLockout sends one JSON body with the account credentials and reads the snapshot back', async () => {
  const seen = [];
  const fetcher = async (path, init) => {
    seen.push({ path, init });
    return { ok: true, status: 200, json: async () => ({ success: true, maintenance: { mode: 'maintenance', lockout: true, message: 'Back at nine', releaseId: 'rel-1' } }) };
  };
  const done = await postLockout({ enabled: true, message: 'Back at nine', releaseId: 'rel-1' }, { fetcher });
  assert.equal(done.ok, true);
  assert.equal(done.maintenance.lockout, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, '/admin/ops/lockout');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.credentials, 'include');
  assert.equal(seen[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(seen[0].init.body), { enabled: true, message: 'Back at nine', releaseId: 'rel-1' });
});

await checkAsync('lockout: refusals, unreachable servers and bad input never claim success', async () => {
  const refused = await postLockout({ enabled: false, reopen: true }, { fetcher: async () => ({ ok: false, status: 429, json: async () => ({ success: false, error: 'Too many changes. Try again shortly.' }) }) });
  assert.deepEqual([refused.ok, refused.status, refused.error, refused.maintenance], [false, 429, 'Too many changes. Try again shortly.', null]);
  const down = await postLockout({ enabled: true }, { fetcher: async () => { throw new Error('down'); } });
  assert.deepEqual([down.ok, down.status], [false, 503]);
  let sent = 0;
  const invalid = await postLockout({ enabled: true, releaseId: 'no good' }, { fetcher: async () => { sent += 1; return { ok: true, status: 200, json: async () => ({}) }; } });
  assert.equal(invalid.ok, false);
  assert.equal(sent, 0, 'a bad id never leaves the page');
});

check('lockout: the release summary and switch copy say what is on and what pressing does', () => {
  const locked = { mode: 'maintenance', lockout: true, operatorPassword: false, message: '', releaseId: '', drainDeadline: null, activeRounds: 2 };
  assert.match(panels.releaseMarkup(locked, 0), /public panel <b>ON<\/b>/);
  assert.match(panels.releaseMarkup(locked, 0), /operators and admin accounts can still sign in/);
  assert.doesNotMatch(panels.releaseMarkup({ ...locked, lockout: false }, 0), /public panel/);
  const on = panels.lockoutView(locked);
  assert.deepEqual([on.locked, on.action], [true, 'off']);
  assert.match(on.note, /No operator password set; only admin accounts can pass the lockout\./);
  const off = panels.lockoutView({ ...locked, lockout: false, mode: 'normal', operatorPassword: true });
  assert.deepEqual([off.locked, off.action], [false, 'on']);
  assert.match(off.note, /Operator password is set/);
  assert.match(panels.LOCKOUT_COPY.off.message, /reopens to everyone/);
});
