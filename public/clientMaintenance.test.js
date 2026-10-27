/* global process */
import assert from 'node:assert/strict';
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, addEventListener: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const {
  normalizeMaintenanceSnapshot,
  maintenanceActive,
  maintenanceCopy,
  homePanelVisible,
  lockoutBlocking,
  operatorModeActive,
  lockoutMessage,
  lockoutNote,
  parseRetryAfter,
  retryAfterText,
  postOperatorSignIn,
  postOperatorSignOut,
  fetchOperatorAvailability,
} = await import('./clientMaintenance.js');

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('normalizes malformed maintenance snapshots safely', () => {
  const snapshot = normalizeMaintenanceSnapshot({ mode: 'invalid', activeRounds: '3', releaseId: '<release>' });
  assert.equal(snapshot.mode, 'normal');
  assert.equal(snapshot.activeRounds, 3);
  assert.equal(snapshot.releaseId, 'release');
  assert.equal(maintenanceActive(snapshot), false);
});

check('keeps draining copy explicit and stable', () => {
  const snapshot = normalizeMaintenanceSnapshot({ mode: 'draining', message: 'MAINTENANCE WINDOW' });
  assert.equal(maintenanceActive(snapshot), true);
  assert.match(maintenanceCopy(snapshot), /NEW ROUNDS ARE PAUSED/);
  assert.match(maintenanceCopy(snapshot), /CURRENT ROUNDS CONTINUE/);
});

check('never treats a maintenance snapshot as a game action', () => {
  const snapshot = normalizeMaintenanceSnapshot({ mode: 'maintenance', activeRounds: 1 });
  assert.equal(snapshot.mode, 'maintenance');
  assert.equal(snapshot.activeRounds, 1);
  assert.equal(maintenanceCopy(snapshot).includes('START'), false);
});

async function checkAsync(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('lockout and bypass only count together with maintenance and a real boolean', () => {
  assert.equal(normalizeMaintenanceSnapshot({ mode: 'maintenance', lockout: true }).lockout, true);
  assert.equal(normalizeMaintenanceSnapshot({ mode: 'maintenance', lockout: true }).bypass, false);
  assert.equal(normalizeMaintenanceSnapshot({ mode: 'draining', lockout: true }).lockout, false);
  assert.equal(normalizeMaintenanceSnapshot({ mode: 'normal', lockout: true, bypass: true }).lockout, false);
  assert.equal(normalizeMaintenanceSnapshot({ mode: 'maintenance', lockout: 'true', bypass: 1 }).lockout, false);
  assert.equal(normalizeMaintenanceSnapshot({ mode: 'maintenance', bypass: 'yes' }).bypass, false);
  assert.equal(normalizeMaintenanceSnapshot({ mode: 'normal', bypass: true }).bypass, true, 'bypass is reported in every mode');
  // An old server sends neither field.
  const legacy = normalizeMaintenanceSnapshot({ mode: 'maintenance', message: 'Soon' });
  assert.deepEqual([legacy.lockout, legacy.bypass], [false, false]);
});

check('the full panel shows for visitors in any maintenance mode but not for an operator inside a lockout', () => {
  const locked = { mode: 'maintenance', lockout: true, bypass: false };
  assert.equal(homePanelVisible(locked), true);
  assert.equal(lockoutBlocking(locked), true);
  assert.equal(operatorModeActive(locked), false);
  const operator = { ...locked, bypass: true };
  assert.equal(homePanelVisible(operator), false);
  assert.equal(lockoutBlocking(operator), false);
  assert.equal(operatorModeActive(operator), true);
  assert.equal(homePanelVisible({ mode: 'normal', bypass: true }), false);
  assert.equal(homePanelVisible({ mode: 'draining', bypass: true }), true, 'a bypass does not lift draining');
  assert.equal(homePanelVisible({ mode: 'maintenance', lockout: false, bypass: true }), true, 'nor plain maintenance');
  assert.equal(operatorModeActive({ mode: 'normal', bypass: true }), false);
});

check('the lockout copy leads with the operator message and falls back to a plain line', () => {
  assert.equal(lockoutMessage({ mode: 'maintenance', lockout: true, message: 'Back at nine' }), 'Back at nine');
  assert.equal(/[<>]/.test(lockoutMessage({ mode: 'maintenance', lockout: true, message: '<b>Back</b>' })), false, 'markup characters never reach the panel');
  assert.equal(lockoutMessage({ mode: 'maintenance', lockout: true }), 'MAINTENANCE IN PROGRESS');
  assert.match(lockoutNote({}, 'available'), /Rounds already in progress carry on/);
  assert.doesNotMatch(lockoutNote({}, 'available'), /not available/);
  assert.match(lockoutNote({}, 'unavailable'), /Operator sign-in is not available on this server\./);
});

check('Retry-After becomes a readable wait and never an unsafe number', () => {
  assert.equal(parseRetryAfter('30'), 30);
  assert.equal(parseRetryAfter(' 900 '), 900);
  for (const bad of [undefined, null, '', 'soon', '0', '-5', 'NaN']) assert.equal(parseRetryAfter(bad), 60, String(bad));
  assert.equal(parseRetryAfter('999999999'), 86_400);
  assert.equal(retryAfterText(1), '1 second');
  assert.equal(retryAfterText(45), '45 seconds');
  assert.equal(retryAfterText(60), '1 minute');
  assert.equal(retryAfterText(125), '3 minutes');
  assert.equal(retryAfterText(900), '15 minutes');
  assert.equal(retryAfterText(3600), '1 hour');
  assert.equal(retryAfterText(7300), '3 hours');
  assert.equal(retryAfterText('garbage'), '1 minute');
});

const response = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: name => headers[name.toLowerCase()] ?? null }, json: async () => body });

await checkAsync('sign-in sends JSON with the password only, over the same origin, and maps each answer', async () => {
  const seen = [];
  const answer = (status, body, headers) => async (url, init) => { seen.push({ url, init }); return response(status, body, headers); };
  assert.deepEqual(await postOperatorSignIn('pw', { fetcher: answer(200, { success: true, expiresAt: 'x' }) }), { kind: 'ok' });
  assert.equal(seen[0].url, '/maintenance/unlock');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.credentials, 'same-origin');
  assert.equal(seen[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(seen[0].init.body), { password: 'pw' });
  assert.deepEqual(await postOperatorSignIn('pw', { fetcher: answer(401, { success: false }) }), { kind: 'wrong' });
  assert.deepEqual(await postOperatorSignIn('pw', { fetcher: answer(429, { success: false }, { 'retry-after': '90' }) }), { kind: 'limited', retryAfterSeconds: 90 });
  assert.deepEqual(await postOperatorSignIn('pw', { fetcher: answer(404, { success: false }) }), { kind: 'unavailable' });
  for (const status of [400, 403, 413, 500]) assert.deepEqual(await postOperatorSignIn('pw', { fetcher: answer(status, { success: false }) }), { kind: 'error' }, String(status));
  assert.deepEqual(await postOperatorSignIn('pw', { fetcher: answer(200, { success: false }) }), { kind: 'error' }, 'a 200 without success is not a sign-in');
  assert.deepEqual(await postOperatorSignIn('pw', { fetcher: async () => { throw new Error('offline'); } }), { kind: 'network' });
  assert.deepEqual(JSON.parse((await (async () => { await postOperatorSignIn(42, { fetcher: answer(401, {}) }); return seen.at(-1).init; })()).body), { password: '' }, 'a non-string is never sent as given');
});

await checkAsync('availability reads 200 as offered, 404 as not configured, anything else as unknown', async () => {
  const answer = (status, body) => async () => response(status, body);
  assert.deepEqual(await fetchOperatorAvailability({ fetcher: answer(200, { success: true, available: true, bypass: true }) }), { availability: 'available', bypass: true });
  assert.deepEqual(await fetchOperatorAvailability({ fetcher: answer(200, { success: true, available: true }) }), { availability: 'available', bypass: false });
  assert.deepEqual(await fetchOperatorAvailability({ fetcher: answer(404, { success: false }) }), { availability: 'unavailable', bypass: false });
  assert.deepEqual(await fetchOperatorAvailability({ fetcher: answer(500, {}) }), { availability: 'unknown', bypass: false });
  assert.deepEqual(await fetchOperatorAvailability({ fetcher: async () => { throw new Error('offline'); } }), { availability: 'unknown', bypass: false });
});

await checkAsync('sign-out posts an empty JSON object and reports success or failure', async () => {
  const seen = [];
  const ok = await postOperatorSignOut({ fetcher: async (url, init) => { seen.push({ url, init }); return response(200, { success: true }); } });
  assert.deepEqual(ok, { ok: true });
  assert.equal(seen[0].url, '/maintenance/logout');
  assert.equal(seen[0].init.body, '{}');
  assert.equal(seen[0].init.credentials, 'same-origin');
  assert.deepEqual(await postOperatorSignOut({ fetcher: async () => { throw new Error('offline'); } }), { ok: false });
});
