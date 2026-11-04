/* global process */
import assert from 'node:assert/strict';

globalThis.window = { location: { pathname: '/admin/analytics' } };
const { setSectionState, setSectionFailure, failureText, isUnauthorizedStatus, syncScrollCue } = await import('./clientAdminPanelState.js');
const { createAdminOpsController } = await import('./clientAdminConsole.js');

async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}: ${error.stack || error.message}`); process.exitCode = 1; }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForCondition(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Condition was not met within ${timeoutMs}ms`);
    await wait(5);
  }
}

function el(children = {}, attrs = {}) {
  const attributes = { ...attrs };
  const classes = new Set();
  const listeners = new Map();
  const node = {
    innerHTML: '', textContent: '', value: '', disabled: false, scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n), toggle: (n, force) => ((force ?? !classes.has(n)) ? classes.add(n) : classes.delete(n)) },
    getAttribute: n => attributes[n] ?? null, setAttribute: (n, v) => { attributes[n] = String(v); }, hasAttribute: n => n in attributes, removeAttribute: n => { delete attributes[n]; },
    querySelector: selector => children[selector] || null,
    querySelectorAll: selector => (selector === '[data-clear]' ? (children['[data-clear]'] ? [children['[data-clear]']] : []) : []),
    addEventListener: (n, h) => listeners.set(n, h), removeEventListener: n => listeners.delete(n),
    click() { listeners.get('click')?.({}); }, focus() { node.focused = true; },
  };
  return node;
}

function section() {
  const clear = el();
  const state = el();
  const body = el({ '[data-clear]': clear });
  const root = el({ '[data-section-state]': state, '[data-section-body]': body });
  return { root, state, body, clear };
}

await check('a first load shows the loading state and hides the empty body', () => {
  const s = section();
  setSectionState(s.root, 'loading', { message: 'LOADING…' });
  assert.equal(s.root.getAttribute('data-section-kind'), 'loading');
  assert.equal(s.root.getAttribute('aria-busy'), 'true');
  assert.equal(s.state.classList.contains('is-hidden'), false);
  assert.equal(s.body.classList.contains('is-hidden'), true);
  assert.equal(s.state.getAttribute('role'), 'status');
});

await check('ready shows the body, remembers that data exists, and a later refresh keeps it on screen', () => {
  const s = section();
  setSectionState(s.root, 'ready');
  assert.equal(s.body.classList.contains('is-hidden'), false);
  assert.equal(s.state.classList.contains('is-hidden'), true);
  assert.equal(s.root.getAttribute('data-has-data'), 'true');
  setSectionState(s.root, 'loading');
  assert.equal(s.body.classList.contains('is-hidden'), false, 'refreshing never blanks the content');
  assert.equal(s.root.getAttribute('aria-busy'), 'true');
});

await check('an error offers a retry that runs the loader and moves focus to the message', () => {
  const s = section();
  const retry = el();
  s.state.querySelector = selector => (selector === '[data-section-retry]' ? retry : null);
  let retried = 0;
  setSectionFailure(s.root, 503, () => { retried += 1; });
  assert.equal(s.root.getAttribute('data-section-kind'), 'error');
  assert.equal(s.state.getAttribute('role'), 'alert');
  assert.match(s.state.innerHTML, /data-section-retry/);
  assert.match(s.state.textContent, /UNAVAILABLE · RETRY/);
  retry.click();
  assert.equal(retried, 1);
  assert.equal(s.state.focused, true, 'focus is not lost when the retry button is replaced');
});

await check('an error after data keeps the stale content visible', () => {
  const s = section();
  setSectionState(s.root, 'ready');
  setSectionFailure(s.root, 429);
  assert.equal(s.body.classList.contains('is-hidden'), false);
  assert.match(s.state.textContent, /RATE LIMITED/);
});

await check('unauthorized clears the data but keeps the structure and offers a way to check again', () => {
  const s = section();
  s.clear.textContent = 'private rows';
  setSectionState(s.root, 'ready');
  setSectionFailure(s.root, 403);
  assert.equal(s.clear.textContent, '', 'rendered data is removed');
  assert.equal(s.body.classList.contains('is-hidden'), true);
  assert.equal(s.root.getAttribute('data-has-data'), 'false');
  assert.match(s.state.textContent, /ADMIN ACCESS REQUIRED/);
  assert.match(s.state.innerHTML, /CHECK AGAIN/);
  setSectionState(s.root, 'ready');
  assert.equal(s.body.classList.contains('is-hidden'), false, 'a new sign-in can fill the same section again');
});

await check('failure wording and the scroll cue', () => {
  assert.equal(failureText(401), 'ADMIN ACCOUNT REQUIRED');
  assert.equal(failureText(403), 'ADMIN ACCESS REQUIRED');
  assert.equal(failureText(429), 'RATE LIMITED · RETRY');
  assert.equal(failureText(500), 'UNAVAILABLE · RETRY');
  assert.equal(failureText('constructor'), 'UNAVAILABLE · RETRY');
  assert.equal(isUnauthorizedStatus(401) && isUnauthorizedStatus(403) && !isUnauthorizedStatus(500), true);
  const surface = el();
  Object.assign(surface, { scrollHeight: 500, clientHeight: 300 });
  syncScrollCue(surface);
  assert.equal(surface.getAttribute('data-overflow'), 'true');
  Object.assign(surface, { scrollHeight: 300 });
  syncScrollCue(surface);
  assert.equal(surface.getAttribute('data-overflow'), 'false');
  const main = el({}, { 'data-scroll-focus': '', tabindex: '-1' });
  Object.assign(main, { scrollHeight: 500, clientHeight: 300 });
  syncScrollCue(main);
  assert.equal(main.getAttribute('tabindex'), '0', 'a scrolling console is a tab stop');
  Object.assign(main, { scrollHeight: 300 });
  syncScrollCue(main);
  assert.equal(main.getAttribute('tabindex'), '-1', 'and not when nothing scrolls');
});

// ---- the operator panels -------------------------------------------------------
function consoleRoot() {
  const nodes = {};
  const sections = {};
  for (const name of ['health', 'rooms', 'usage', 'log-bots', 'control', 'log-release']) sections[name] = section();
  const buttons = ['draining', 'maintenance', 'normal'].map(mode => Object.assign(el({}, { 'data-release-action': mode })));
  Object.assign(nodes, {
    '[data-rooms-totals]': el(), '[data-rooms-table]': el(), '[data-rooms-note]': el(), '[data-rooms-empty]': el(),
    '[data-release-summary]': el(), '[data-release-status]': el(), '[data-release-message]': el(),
    '[data-bots-line]': el(), '[data-rooms-scroll]': el(),
  });
  for (const [name, s] of Object.entries(sections)) nodes[`[data-section="${name}"]`] = s.root;
  return {
    sections, buttons, nodes,
    root: { querySelector: selector => nodes[selector] || null, querySelectorAll: selector => (selector === '[data-release-action]' ? buttons : []) },
  };
}

const ROOM = (id, extra = {}) => ({ id, phase: 'playing', visibility: 'public', humans: 1, bots: 0, round: 2, ageSeconds: 10, idleSeconds: 1, stalled: false, ...extra });
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

await check('rooms poll on their interval, pause while hidden or not shown, and stop on teardown', async () => {
  const fixture = consoleRoot();
  let hidden = false;
  let shown = true;
  const paths = [];
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 15,
    isDocumentHidden: () => hidden, isViewShown: () => shown,
    fetcher: async path => { paths.push(path); return json({ success: true, generatedAt: '2026-09-15T12:00:00.000Z', totals: { rooms: 1 }, rooms: [ROOM('r-0a1b2c', { roomCode: 'LEAKED' })] }); },
  });
  controller.show('rooms');
  await waitForCondition(() => paths.length >= 3);
  assert.ok(paths.length >= 3, `polled repeatedly (${paths.length})`);
  assert.ok(paths.every(path => path === '/admin/ops/rooms'));
  assert.match(fixture.nodes['[data-rooms-table]'].innerHTML, /r-0a1b2c/);
  assert.equal(fixture.nodes['[data-rooms-table]'].innerHTML.includes('LEAKED'), false, 'no room code ever reaches the table');
  assert.match(fixture.nodes['[data-rooms-totals]'].innerHTML, /<b>1<\/b> rooms/);
  assert.match(fixture.nodes['[data-rooms-note]'].textContent, /^NEWEST FIRST · REFRESHES EVERY/);

  shown = false;
  await wait(20);
  const whileNotShown = paths.length;
  await wait(60);
  assert.equal(paths.length, whileNotShown, 'a view that is not shown makes no requests');
  shown = true;
  await waitForCondition(() => paths.length > whileNotShown);
  assert.ok(paths.length > whileNotShown, 'and resumes by itself when shown again');

  hidden = true;
  controller.show('rooms');
  const whileHidden = paths.length;
  await wait(60);
  assert.ok(paths.length <= whileHidden + 1, 'a hidden tab does not poll');
  hidden = false;

  controller.destroy();
  const after = paths.length;
  await wait(60);
  assert.equal(paths.length, after, 'nothing runs after teardown');
});

await check('leaving Rooms stops its poll', async () => {
  const fixture = consoleRoot();
  const paths = [];
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 10,
    fetcher: async path => { paths.push(path); return json({ success: true, totals: {}, rooms: [] }); },
  });
  controller.show('rooms');
  await wait(35);
  controller.show('status');
  await wait(10);
  const afterLeaving = paths.filter(path => path.endsWith('/rooms')).length;
  await wait(60);
  assert.equal(paths.filter(path => path.endsWith('/rooms')).length, afterLeaving);
  controller.destroy();
});

await check('a failed rooms read shows an error with retry, and 403 clears the table', async () => {
  const fixture = consoleRoot();
  let status = 200;
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000,
    fetcher: async () => (status === 200 ? json({ success: true, totals: { rooms: 1 }, rooms: [ROOM('r-0a1b2c')] }) : json({ success: false }, status)),
  });
  controller.show('rooms');
  await wait(10);
  fixture.sections.rooms.clear.textContent = 'rows';
  status = 503;
  controller.refresh();
  await wait(10);
  assert.equal(fixture.sections.rooms.root.getAttribute('data-section-kind'), 'error');
  status = 403;
  controller.refresh();
  await wait(10);
  assert.equal(fixture.sections.rooms.root.getAttribute('data-section-kind'), 'unauthorized');
  controller.destroy();
});

await check('the health line shows the verdict, hides itself when unauthorized, and comes back', async () => {
  const fixture = consoleRoot();
  let status = 200;
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000,
    fetcher: async () => (status === 200 ? json({ success: true, generatedAt: '2026-09-15T12:00:00.000Z', health: { state: 'degraded', checks: [{ id: 'errors', label: 'Errors', state: 'warn', detail: '14 in the last hour' }] }, maintenance: { mode: 'normal' } }) : json({ success: false }, status)),
  });
  fixture.sections.health.body.setAttribute('data-clear', '');
  controller.show('status');
  await wait(10);
  assert.match(fixture.sections.health.body.innerHTML, /DEGRADED/);
  assert.match(fixture.sections.health.body.innerHTML, /Errors/);
  assert.equal(fixture.sections.health.root.classList.contains('is-hidden'), false);
  status = 403;
  controller.refresh();
  await wait(10);
  assert.equal(fixture.sections.health.root.getAttribute('data-section-kind'), 'unauthorized');
  assert.equal(fixture.sections.health.root.classList.contains('is-hidden'), true, 'the chart area already says access is required');
  assert.equal(fixture.sections.health.body.textContent, '', 'nothing from the verdict is kept');
  status = 200;
  controller.refresh();
  await wait(10);
  assert.equal(fixture.sections.health.root.classList.contains('is-hidden'), false);
  controller.destroy();
});

await check('release: cancel changes nothing, confirm posts once, then the state is read back', async () => {
  const fixture = consoleRoot();
  const calls = [];
  let mode = 'normal';
  const confirmations = [];
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000,
    confirm: options => confirmations.push(options),
    fetcher: async (path, init) => {
      calls.push({ path, method: init.method, body: init.body });
      if (path === '/admin/ops/maintenance') { mode = JSON.parse(init.body).mode; return json({ success: true, maintenance: { mode } }); }
      if (path === '/admin/ops/audit') return json({ success: true, entries: [{ at: '2026-09-15T12:00:00.000Z', area: 'release', action: 'mode', target: mode, actor: 'admin-1a2b3c4d', outcome: 'ok' }] });
      return json({ success: true, generatedAt: '2026-09-15T12:00:00.000Z', maintenance: { mode, activeRounds: 2 }, health: {} });
    },
  });
  controller.show('release');
  await wait(15);
  const drain = fixture.buttons[0];
  assert.equal(drain.disabled, false, 'drain is available while open');
  assert.equal(fixture.buttons[2].disabled, true, 'resume is not');
  assert.match(fixture.nodes['[data-release-summary]'].innerHTML, /OPEN/);
  const reads = calls.length;

  fixture.buttons[0].click();
  await wait(5);
  assert.equal(confirmations.length, 1, 'a click asks first');
  assert.match(confirmations[0].title, /draining/i);
  assert.equal(calls.length, reads, 'nothing is sent while the dialog is open');
  // Cancel is closing the dialog without calling onConfirm: nothing happens.
  await wait(10);
  assert.equal(calls.some(call => call.method === 'POST'), false);
  assert.equal(mode, 'normal');

  fixture.nodes['[data-release-message]'].value = 'Back at nine';
  confirmations[0].onConfirm();
  await wait(30);
  const posts = calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body), { mode: 'draining', message: 'Back at nine' });
  const afterPost = calls.slice(calls.indexOf(posts[0]) + 1);
  assert.ok(afterPost.some(call => call.path === '/admin/ops/status'), 'status is re-fetched after the change');
  assert.ok(afterPost.some(call => call.path === '/admin/ops/audit'), 'and so is the log');
  assert.match(fixture.nodes['[data-release-summary]'].innerHTML, /DRAINING/, 'the page shows what the server reports');
  assert.match(fixture.nodes['[data-release-status]'].textContent, /DRAIN APPLIED/);
  assert.equal(fixture.buttons[0].disabled, true, 'drain is no longer offered');
  assert.equal(fixture.buttons[2].disabled, false, 'resume now is');
  controller.destroy();
});

await check('release: a refused change surfaces the error and still re-reads the server', async () => {
  const fixture = consoleRoot();
  const calls = [];
  const confirmations = [];
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000, confirm: options => confirmations.push(options),
    fetcher: async (path, init) => {
      calls.push(path);
      if (path === '/admin/ops/maintenance') return json({ success: false, error: 'Choose normal, draining, or maintenance.' }, 400);
      if (path === '/admin/ops/audit') return json({ success: true, entries: [] });
      return json({ success: true, maintenance: { mode: 'normal', activeRounds: 0 }, health: {} });
    },
  });
  controller.show('release');
  await wait(15);
  fixture.buttons[1].click();
  await wait(5);
  confirmations[0].onConfirm();
  await wait(30);
  assert.match(fixture.nodes['[data-release-status]'].textContent, /^NOT APPLIED · Choose normal/);
  assert.equal(fixture.nodes['[data-release-status]'].getAttribute('role'), 'alert');
  assert.match(fixture.nodes['[data-release-summary]'].innerHTML, /OPEN/, 'the display is still what the server says');
  assert.equal(fixture.buttons[1].disabled, false, 'the operator can try again');
  assert.equal(fixture.sections['log-release'].root.getAttribute('data-section-kind'), 'empty');
  controller.destroy();
});

await check('bots: one usage line says not recorded for nulls, and the change log is provider-only', async () => {
  const fixture = consoleRoot();
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000, getRange: () => 'week',
    fetcher: async path => {
      if (path.startsWith('/admin/ops/bots')) return json({ success: true, range: 'week', generatedAt: '2026-09-15T12:00:00.000Z', totals: { botMatches: 9, decisions: null, fallbacks: null, fallbackRate: null, sampleSize: 9 }, providers: [], provider: { state: 'healthy', activeLabel: null, capPerBot: 240 } });
      return json({ success: true, entries: [
        { at: '2026-09-15T12:00:00.000Z', area: 'provider', action: 'activate', target: 'OpenAI main', actor: 'admin-1a2b3c4d', outcome: 'ok' },
        { at: '2026-09-15T12:01:00.000Z', area: 'release', action: 'mode', target: 'draining', actor: 'admin-1a2b3c4d', outcome: 'ok' },
      ] });
    },
  });
  controller.show('bots');
  await wait(20);
  assert.match(fixture.nodes['[data-bots-line]'].innerHTML, /not recorded/);
  assert.match(fixture.nodes['[data-bots-line]'].innerHTML, /BOT MATCHES/);
  assert.match(fixture.sections['log-bots'].clear.innerHTML, /OpenAI main/);
  assert.equal(fixture.sections['log-bots'].clear.innerHTML.includes('DRAINING'), false);
  assert.equal(controller.tableForExport, undefined, 'there is no export');
  controller.destroy();
});

// ---- release: the id and deadline fields ---------------------------------------------

function releaseFields(fixture) {
  const fields = {
    id: Object.assign(el(), { value: '' }),
    minutes: Object.assign(el(), { value: '' }),
    at: Object.assign(el(), { value: '' }),
  };
  fixture.nodes['[data-release-id]'] = fields.id;
  fixture.nodes['[data-release-minutes]'] = fields.minutes;
  fixture.nodes['[data-release-at]'] = fields.at;
  return fields;
}

await check('release: the id and a minutes-from-now deadline are validated, confirmed with their details, then posted', async () => {
  const fixture = consoleRoot();
  const fields = releaseFields(fixture);
  const calls = [];
  const confirmations = [];
  let t = Date.parse('2026-10-20T12:00:00.000Z');
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000, clock: () => t,
    confirm: options => confirmations.push(options),
    fetcher: async (path, init) => {
      calls.push({ path, method: init.method, body: init.body });
      if (path === '/admin/ops/maintenance') return json({ success: true, maintenance: { mode: 'draining', releaseId: 'rel-9', drainDeadline: '2026-10-20T12:30:00.000Z' } });
      if (path === '/admin/ops/audit') return json({ success: true, entries: [] });
      return json({ success: true, generatedAt: '2026-10-20T12:00:00.000Z', maintenance: { mode: 'normal', activeRounds: 0 }, health: {} });
    },
  });
  controller.show('release');
  await until(() => fixture.nodes['[data-release-summary]'].innerHTML.includes('OPEN'), 'the release state');

  fields.id.value = 'rel 9';
  fixture.buttons[0].click();
  await wait(5);
  assert.equal(confirmations.length, 0, 'an invalid id never opens the confirm step');
  assert.match(fixture.nodes['[data-release-status]'].textContent, /^NOT APPLIED · The release ID may use/);
  assert.equal(fields.id.getAttribute('aria-invalid'), 'true');
  assert.equal(fields.id.focused, true, 'the cursor goes to the field to fix');

  fields.id.value = 'rel-9';
  fields.minutes.value = '0';
  fixture.buttons[0].click();
  assert.equal(confirmations.length, 0);
  assert.equal(fields.minutes.getAttribute('aria-invalid'), 'true');
  assert.equal(fields.id.getAttribute('aria-invalid'), null, 'only the faulty field is flagged');

  fields.minutes.value = '30';
  fixture.buttons[0].click();
  await wait(5);
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0].message, /Release rel-9\./);
  assert.match(confirmations[0].message, /2026-10-20 12:30 UTC/);
  assert.equal(calls.some(call => call.method === 'POST'), false, 'nothing is sent before the dialog is accepted');
  assert.equal(fields.minutes.getAttribute('aria-invalid'), null);

  // Minutes count from the moment of the change, not from the click.
  t += 5 * 60_000;
  confirmations[0].onConfirm();
  await until(() => /DRAIN APPLIED/.test(fixture.nodes['[data-release-status]'].textContent), 'the change to be applied');
  const posts = calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body), { mode: 'draining', releaseId: 'rel-9', deadline: '2026-10-20T12:35:00.000Z' });
  assert.equal(JSON.stringify(JSON.parse(posts[0].body)).includes('message'), false, 'a blank message is not sent');
  assert.match(fixture.nodes['[data-release-status]'].textContent, /DRAIN APPLIED/);
  controller.destroy();
});

await check('release: both deadline fields filled is refused, and a deadline is ignored for maintenance', async () => {
  const fixture = consoleRoot();
  const fields = releaseFields(fixture);
  const confirmations = [];
  const calls = [];
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000, confirm: options => confirmations.push(options),
    fetcher: async (path, init) => {
      calls.push({ path, method: init.method, body: init.body });
      if (path === '/admin/ops/maintenance') return json({ success: true, maintenance: { mode: 'maintenance' } });
      if (path === '/admin/ops/audit') return json({ success: true, entries: [] });
      return json({ success: true, maintenance: { mode: 'normal', activeRounds: 0 }, health: {} });
    },
  });
  controller.show('release');
  await until(() => fixture.nodes['[data-release-summary]'].innerHTML.includes('OPEN'), 'the release state');
  fields.minutes.value = '20';
  fields.at.value = '2099-01-01T10:00';
  fixture.buttons[0].click();
  assert.equal(confirmations.length, 0);
  assert.match(fixture.nodes['[data-release-status]'].textContent, /not both/i);
  fixture.buttons[1].click();
  await wait(5);
  assert.equal(confirmations.length, 1, 'maintenance takes no deadline, so the two fields do not block it');
  confirmations[0].onConfirm();
  await until(() => calls.some(call => call.method === 'POST'), 'the change to be sent');
  assert.deepEqual(JSON.parse(calls.find(call => call.method === 'POST').body), { mode: 'maintenance' });
  controller.destroy();
});

// Waits for a condition instead of a fixed delay, so a slow machine slows the test, not fails it.
async function until(condition, message, limitMs = 4000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > limitMs) throw new Error(`timed out waiting for: ${message}`);
    await wait(5);
  }
}

// A controller that is not destroyed keeps its timers alive, so a failed assertion would hang the
// process instead of reporting. Destroy in finally.
async function withController(options, run) {
  const controller = createAdminOpsController(options);
  try { await run(controller); } finally { controller.destroy(); }
}

function countdownSummary(fixture) {
  const summary = fixture.nodes['[data-release-summary]'];
  const countdown = el();
  // The fake summary finds the countdown element the markup describes.
  summary.querySelector = selector => {
    const match = selector === '[data-release-countdown]' ? /data-deadline="([^"]+)"/.exec(summary.innerHTML) : null;
    if (!match) return null;
    countdown.setAttribute('data-deadline', match[1]);
    return countdown;
  };
  return { summary, countdown };
}

await check('release: a draining deadline counts down, reads the state back once at zero and then stops', async () => {
  const fixture = consoleRoot();
  releaseFields(fixture);
  const { summary, countdown } = countdownSummary(fixture);
  const base = Date.parse('2026-10-20T12:00:00.000Z');
  let t = base;
  let statusReads = 0;
  let mode = 'draining';
  await withController({
    root: fixture.root, pollMs: 60_000, clock: () => t, countdownTickMs: 10,
    fetcher: async (path) => {
      if (path === '/admin/ops/audit') return json({ success: true, entries: [] });
      statusReads += 1;
      return json({ success: true, generatedAt: new Date(t).toISOString(), maintenance: { mode, releaseId: 'rel-9', drainDeadline: new Date(base + 3000).toISOString(), activeRounds: 1 }, health: {} });
    },
  }, async controller => {
    controller.show('release');
    await until(() => countdown.textContent === '3s', 'the countdown to show 3s');
    assert.match(summary.innerHTML, /DRAINING/);
    assert.match(summary.innerHTML, /rel-9/);
    t = base + 1000;
    await until(() => countdown.textContent === '2s', 'the countdown to follow the clock');
    assert.equal(statusReads, 1, 'ticking does not poll the server');
    // The server ends the drain at the deadline; the page reads that back once.
    mode = 'maintenance';
    t = base + 3000;
    await until(() => statusReads === 2 && /MAINTENANCE/.test(summary.innerHTML), 'one read at zero');
    assert.doesNotMatch(summary.innerHTML, /data-release-countdown/);
    await wait(100);
    assert.equal(statusReads, 2, 'the countdown stopped');
  });
});

await check('release: a deadline already past is drawn as reached and never loops on reads', async () => {
  const fixture = consoleRoot();
  releaseFields(fixture);
  const { summary } = countdownSummary(fixture);
  const base = Date.parse('2026-10-20T12:00:00.000Z');
  let reads = 0;
  await withController({
    root: fixture.root, pollMs: 60_000, clock: () => base + 10_000, countdownTickMs: 10,
    fetcher: async (path) => {
      if (path === '/admin/ops/audit') return json({ success: true, entries: [] });
      reads += 1;
      return json({ success: true, generatedAt: new Date(base).toISOString(), maintenance: { mode: 'draining', drainDeadline: new Date(base + 3000).toISOString(), activeRounds: 1 }, health: {} });
    },
  }, async controller => {
    controller.show('release');
    await until(() => /deadline reached/i.test(summary.innerHTML), 'the passed deadline to be drawn');
    await wait(100);
    assert.equal(reads, 1, 'an expired deadline never starts a countdown that re-reads in a loop');
  });
});

// ---- the public maintenance panel switch ----------------------------------------------
function lockoutFixture() {
  const fixture = consoleRoot();
  const label = el();
  const button = el({ '[data-lockout-label]': label }, { 'data-lockout-action': 'on' });
  button.disabled = true;
  Object.assign(fixture.nodes, { '[data-lockout-action]': button, '[data-lockout-badge]': el(), '[data-lockout-note]': el(), '[data-release-id]': el() });
  return { ...fixture, button, label };
}

await check('lockout: the switch shows what the server reports, asks first, posts once and reads the state back', async () => {
  const fixture = lockoutFixture();
  const calls = [];
  const confirmations = [];
  const announced = [];
  let server = { mode: 'normal', lockout: false };
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000, announce: text => announced.push(text),
    confirm: options => confirmations.push(options),
    fetcher: async (path, init) => {
      calls.push({ path, method: init.method, body: init.body });
      if (path === '/admin/ops/lockout') {
        const body = JSON.parse(init.body);
        server = body.enabled ? { mode: 'maintenance', lockout: true, message: body.message, releaseId: body.releaseId } : { mode: 'normal', lockout: false };
        return json({ success: true, maintenance: server });
      }
      if (path === '/admin/ops/audit') return json({ success: true, entries: [{ at: '2026-10-20T12:00:00.000Z', area: 'release', action: 'lockout', target: server.lockout ? 'on' : 'reopen', actor: 'admin-1a2b3c4d', outcome: 'ok' }] });
      return json({ success: true, generatedAt: '2026-10-20T12:00:00.000Z', maintenance: { ...server, activeRounds: 1, operatorPassword: true }, health: {} });
    },
  });
  assert.equal(fixture.button.disabled, true, 'the switch waits for the first read');
  controller.show('release');
  await wait(20);
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.nodes['[data-lockout-badge]'].textContent, 'OFF');
  assert.equal(fixture.nodes['[data-lockout-badge]'].getAttribute('data-lockout-state'), 'off');
  assert.match(fixture.nodes['[data-lockout-note]'].textContent, /Operator password is set/);
  assert.equal(fixture.label.textContent, 'SHOW MAINTENANCE PANEL');
  assert.equal(fixture.button.getAttribute('aria-pressed'), 'false');
  const reads = calls.length;

  fixture.nodes['[data-release-message]'].value = 'Back at nine';
  fixture.nodes['[data-release-id]'].value = 'rel-9';
  fixture.button.click();
  await wait(5);
  assert.equal(confirmations.length, 1, 'a click asks first');
  assert.match(confirmations[0].title, /Show the maintenance panel/);
  assert.match(confirmations[0].message, /Release rel-9\./);
  assert.match(confirmations[0].message, /Visitors read: Back at nine/);
  assert.equal(calls.length, reads, 'nothing is sent while the dialog is open');

  confirmations[0].onConfirm();
  await wait(30);
  const posts = calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body), { enabled: true, message: 'Back at nine', releaseId: 'rel-9' });
  const after = calls.slice(calls.indexOf(posts[0]) + 1);
  assert.ok(after.some(call => call.path === '/admin/ops/status'), 'status is re-read after the change');
  assert.ok(after.some(call => call.path === '/admin/ops/audit'), 'and so is the log');
  assert.match(fixture.nodes['[data-release-status]'].textContent, /PANEL ON · CONFIRMED BY SERVER/);
  assert.equal(fixture.nodes['[data-lockout-badge]'].getAttribute('data-lockout-state'), 'on');
  assert.equal(fixture.label.textContent, 'TURN PANEL OFF · REOPEN SITE');
  assert.equal(fixture.button.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(announced, ['Maintenance panel is on.']);

  fixture.button.click();
  await wait(5);
  assert.equal(confirmations.length, 2);
  assert.match(confirmations[1].title, /Turn the maintenance panel off/);
  confirmations[1].onConfirm();
  await wait(30);
  const lastPost = calls.filter(call => call.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(lastPost.body), { enabled: false, reopen: true }, 'turning it off also reopens the site');
  assert.match(fixture.nodes['[data-release-status]'].textContent, /PANEL OFF/);
  assert.equal(fixture.nodes['[data-lockout-badge]'].getAttribute('data-lockout-state'), 'off');
  controller.destroy();
});

await check('lockout: a bad release id names the field and sends nothing; a refusal is shown and re-read', async () => {
  const fixture = lockoutFixture();
  const calls = [];
  const confirmations = [];
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000, confirm: options => confirmations.push(options),
    fetcher: async (path, init) => {
      calls.push({ path, method: init.method });
      if (path === '/admin/ops/lockout') return json({ success: false, error: 'Too many changes. Try again shortly.' }, 429);
      if (path === '/admin/ops/audit') return json({ success: true, entries: [] });
      return json({ success: true, generatedAt: '2026-10-20T12:00:00.000Z', maintenance: { mode: 'normal' }, health: {} });
    },
  });
  controller.show('release');
  await wait(20);
  fixture.nodes['[data-release-id]'].value = 'rel 9';
  fixture.button.click();
  await wait(5);
  assert.equal(confirmations.length, 0, 'no dialog for an invalid id');
  assert.equal(fixture.nodes['[data-release-id]'].getAttribute('aria-invalid'), 'true');
  assert.match(fixture.nodes['[data-release-status]'].textContent, /^NOT APPLIED · The release ID may use/);
  assert.equal(calls.some(call => call.method === 'POST'), false);

  fixture.nodes['[data-release-id]'].value = '';
  fixture.button.click();
  await wait(5);
  confirmations[0].onConfirm();
  await wait(30);
  assert.match(fixture.nodes['[data-release-status]'].textContent, /^NOT APPLIED · Too many changes/);
  assert.equal(fixture.nodes['[data-release-status]'].getAttribute('role'), 'alert');
  assert.equal(fixture.nodes['[data-lockout-badge]'].getAttribute('data-lockout-state'), 'off', 'the display is still what the server says');
  assert.equal(fixture.button.disabled, false, 'the switch is usable again');
  controller.destroy();
});

await check('release and lockout: a success whose audit entry was not saved shows a warning', async () => {
  const fixture = lockoutFixture();
  const confirmations = [];
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000, confirm: options => confirmations.push(options),
    fetcher: async (path, init) => {
      if (path === '/admin/ops/lockout' || path === '/admin/ops/maintenance') return json({ success: true, audited: false, maintenance: { mode: 'normal' } });
      if (path === '/admin/ops/audit') return json({ success: true, entries: [] });
      return json({ success: true, generatedAt: '2026-10-20T12:00:00.000Z', maintenance: { mode: 'normal' }, health: {} });
    },
  });
  controller.show('release');
  await wait(20);
  fixture.button.click();
  await wait(5);
  confirmations[0].onConfirm();
  await wait(30);
  const status = fixture.nodes['[data-release-status]'];
  assert.match(status.textContent, /Done, but the audit log could not be saved\. Check the audit log file\./);
  assert.equal(status.getAttribute('role'), 'alert');
  assert.ok(status.classList.contains('warning'));
  assert.equal(status.classList.contains('green'), false);

  fixture.buttons[0].click();
  await wait(5);
  confirmations[1].onConfirm();
  await wait(30);
  assert.match(status.textContent, /Done, but the audit log could not be saved\./);
  assert.ok(status.classList.contains('warning'));
  controller.destroy();
});

await check('lockout: a console without the switch markup still works', async () => {
  const fixture = consoleRoot();
  const controller = createAdminOpsController({
    root: fixture.root, pollMs: 60_000,
    fetcher: async path => (path === '/admin/ops/audit' ? json({ success: true, entries: [] }) : json({ success: true, generatedAt: '2026-10-20T12:00:00.000Z', maintenance: { mode: 'maintenance', lockout: true }, health: {} })),
  });
  controller.show('release');
  await wait(20);
  assert.match(fixture.nodes['[data-release-summary]'].innerHTML, /public panel/);
  controller.destroy();
});

console.log('admin console controller: states, polling, release flow and teardown pass');
