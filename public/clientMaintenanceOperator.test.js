/* global process */
import assert from 'node:assert/strict';

// The lockout panel and operator sign-in, driven through a small fake DOM and a fake fetch.
const handlers = { click: [], submit: [] };
const storageWrites = [];
let current = null;

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null, setItem: (...args) => storageWrites.push(args), removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: (...args) => storageWrites.push(args), removeItem: () => {} };
globalThis.document = {
  querySelector: selector => current?.nodes[selector] || null,
  querySelectorAll: selector => current?.lists[selector] || [],
  addEventListener: (type, handler) => handlers[type]?.push(handler),
};

const { state } = await import('./clientState.js');
const maintenance = await import('./clientMaintenance.js');
const { applyMaintenanceState, configureMaintenanceUi, resetOperatorStateForTests } = maintenance;

function node(children = {}, attributes = {}) {
  const attrs = { ...attributes };
  const classes = new Set();
  const self = {
    textContent: '', value: '', disabled: false, type: 'text', focused: 0,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name), toggle: (name, force) => ((force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name)) },
    setAttribute: (name, value) => { attrs[name] = String(value); },
    getAttribute: name => (name in attrs ? attrs[name] : null),
    removeAttribute: name => { delete attrs[name]; },
    hasAttribute: name => name in attrs,
    querySelector: selector => children[selector] || null,
    focus() { self.focused += 1; current.focus = self; },
  };
  return self;
}

function fixture() {
  const label = node();
  const submit = node({ '.t-label': label });
  const revealLabel = node();
  const reveal = node({ '.t-label': revealLabel });
  const form = node();
  form.classList.add('is-hidden');
  const input = node();
  input.type = 'password';
  const status = node();
  const signout = node();
  const chip = node({ '[data-operator-signout]': signout });
  chip.classList.add('is-hidden');
  const panel = node({
    '[data-maintenance-title]': node(), '[data-maintenance-copy]': node(), '[data-maintenance-note]': node(),
    '[data-maintenance-release]': node(), '[data-maintenance-rounds]': node(),
  });
  panel.classList.add('is-hidden');
  const banner = node({ '[data-maintenance-copy]': node(), '[data-maintenance-rounds]': node() });
  banner.classList.add('is-hidden');
  const home = node();
  const main = node();
  const header = node();
  current = {
    focus: null,
    nodes: {
      '#maintenance-home': panel, '#maintenance-game': banner, '#operator-chip': chip, '#view-home': home, '#home-main': main,
      '[data-operator-form]': form, '[data-operator-password]': input, '[data-operator-submit]': submit,
      '[data-operator-reveal]': reveal, '[data-operator-status]': status,
    },
    lists: { '#view-home > :not(#maintenance-home)': [header, main] },
  };
  return { panel, banner, chip, form, input, submit, label, reveal, revealLabel, status, signout, main, header, home };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (body, status = 200, headers = {}) => ({ ok: status < 400, status, headers: { get: name => headers[name.toLowerCase()] ?? null }, json: async () => body });

async function check(name, run) {
  try { await run(); console.log(`PASS - ${name}`); } catch (error) { console.error(`FAIL - ${name}:`, error.stack || error.message); process.exitCode = 1; }
}

function harness(routes) {
  const calls = [];
  const reconnects = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, ...init });
    const route = routes[`${init.method || 'GET'} ${url}`] || routes[url];
    if (!route) throw new Error(`unexpected request ${url}`);
    const answer = typeof route === 'function' ? route(init) : route;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  resetOperatorStateForTests();
  storageWrites.length = 0;
  state.maintenance = { mode: 'normal' };
  const f = fixture();
  configureMaintenanceUi({ emitServer: () => {}, reconnectSocket: () => reconnects.push(true), fetcher });
  return { f, calls, reconnects };
}

const AVAILABLE = json({ success: true, available: true, bypass: false });
const LOCKED = { mode: 'maintenance', lockout: true, message: 'Back at nine', releaseId: 'rel-9', activeRounds: 2, bypass: false };

await check('a locked-out visitor gets the full panel, the sign-in form and an unreachable lobby', async () => {
  const { f, calls } = harness({ 'GET /maintenance/unlock': AVAILABLE });
  applyMaintenanceState(LOCKED);
  assert.equal(f.panel.classList.contains('is-hidden'), false);
  assert.equal(f.panel.getAttribute('data-maintenance-kind'), 'lockout');
  assert.equal(f.panel.querySelector('[data-maintenance-title]').textContent, 'Under maintenance');
  assert.equal(f.panel.querySelector('[data-maintenance-copy]').textContent, 'Back at nine');
  assert.equal(f.panel.querySelector('[data-maintenance-release]').textContent, 'RELEASE rel-9');
  assert.equal(f.panel.querySelector('[data-maintenance-rounds]').textContent, 'ACTIVE ROUNDS: 2');
  assert.match(f.panel.querySelector('[data-maintenance-note]').textContent, /closed/);
  assert.equal(f.main.hasAttribute('inert') && f.header.hasAttribute('inert'), true, 'the site behind the panel is inert');
  assert.equal(f.panel.querySelector('[data-maintenance-title]').focused, 1, 'focus moves to the heading');
  assert.equal(f.chip.classList.contains('is-hidden'), true);
  assert.equal(f.banner.classList.contains('is-hidden'), false, 'the in-game banner still tells seated players');
  await wait(5);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].url, calls[0].credentials], ['/maintenance/unlock', 'same-origin']);
  assert.equal(f.form.classList.contains('is-hidden'), false, 'sign-in is offered once the server says so');
  assert.equal(state.maintenance.bypass, false);
});

await check('a bypassed socket sees the site, the Operator mode chip and no inert background', async () => {
  const { f, calls } = harness({});
  applyMaintenanceState({ ...LOCKED, bypass: true });
  assert.equal(f.panel.classList.contains('is-hidden'), true);
  assert.equal(f.main.hasAttribute('inert'), false);
  assert.equal(f.chip.classList.contains('is-hidden'), false);
  assert.equal(f.chip.getAttribute('aria-hidden'), 'false');
  assert.equal(calls.length, 0, 'an operator is not asked whether sign-in exists');
  applyMaintenanceState({ ...LOCKED, lockout: false, mode: 'normal', bypass: true });
  assert.equal(f.chip.classList.contains('is-hidden'), true, 'no chip once the lockout is lifted');
});

await check('draining and plain maintenance keep the old panel and never offer sign-in', async () => {
  const { f, calls } = harness({});
  applyMaintenanceState({ mode: 'draining', message: 'MAINTENANCE WINDOW', activeRounds: 1 });
  assert.equal(f.panel.classList.contains('is-hidden'), false);
  assert.equal(f.panel.getAttribute('data-maintenance-kind'), 'window');
  assert.equal(f.panel.querySelector('[data-maintenance-title]').textContent, 'Maintenance window');
  assert.match(f.panel.querySelector('[data-maintenance-copy]').textContent, /NEW ROUNDS ARE PAUSED/);
  assert.equal(f.form.classList.contains('is-hidden'), true);
  applyMaintenanceState({ mode: 'maintenance', lockout: false, bypass: true });
  assert.equal(f.panel.classList.contains('is-hidden'), false, 'a bypass does not lift plain maintenance');
  await wait(5);
  assert.equal(calls.length, 0);
});

await check('a 404 from the unlock route hides the form and says sign-in is not available', async () => {
  const { f } = harness({ 'GET /maintenance/unlock': json({ success: false, error: 'Not found.' }, 404) });
  applyMaintenanceState(LOCKED);
  await wait(5);
  assert.equal(f.form.classList.contains('is-hidden'), true);
  assert.match(f.panel.querySelector('[data-maintenance-note]').textContent, /Operator sign-in is not available on this server\./);
});

function submitEvent(f) {
  return { target: { closest: selector => (selector === '[data-operator-form]' ? f.form : null) }, preventDefault() { this.prevented = true; } };
}
const submit = async f => { const event = submitEvent(f); const done = handlers.submit.map(handler => handler(event)); await Promise.all(done); return event; };
const click = async (f, selector) => { const event = { target: { closest: wanted => (wanted === selector ? f.reveal : null) }, preventDefault() {} }; await Promise.all(handlers.click.map(handler => handler(event))); };

await check('a wrong password: only the password is sent, the field is cleared at once, the error is generic', async () => {
  const { f, calls } = harness({ 'GET /maintenance/unlock': AVAILABLE, 'POST /maintenance/unlock': json({ success: false, error: 'Sign-in failed.' }, 401) });
  applyMaintenanceState(LOCKED);
  await wait(5);
  f.input.value = 'hunter2-wrong';
  const pending = submit(f);
  assert.equal(f.input.value, '', 'cleared before the answer arrives');
  assert.equal(f.submit.disabled, true, 'busy while waiting');
  assert.equal(f.label.textContent, 'SIGNING IN…');
  assert.equal(f.form.getAttribute('aria-busy'), 'true');
  const event = await pending;
  assert.equal(event.prevented, true, 'the browser never submits the form itself');
  const post = calls.at(-1);
  assert.equal(post.url, '/maintenance/unlock', 'the password is never in the address');
  assert.equal(post.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(post.body), { password: 'hunter2-wrong' });
  assert.equal(f.status.textContent, 'Sign-in failed. Check the password and try again.');
  assert.equal(f.status.getAttribute('role'), 'alert');
  assert.equal(f.submit.disabled, false);
  assert.equal(f.label.textContent, 'SIGN IN');
  assert.equal(f.input.focused > 0, true, 'focus returns to the field');
  assert.equal(f.panel.classList.contains('is-hidden'), false);
  assert.deepEqual(storageWrites, [], 'nothing is written to local or session storage');
  assert.equal(JSON.stringify(state.maintenance).includes('hunter2'), false);
});

await check('an empty password is not sent', async () => {
  const { f, calls } = harness({ 'GET /maintenance/unlock': AVAILABLE });
  applyMaintenanceState(LOCKED);
  await wait(5);
  await submit(f);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(f.status.textContent, 'Enter the operator password.');
});

await check('the right password reconnects the socket and the next snapshot opens the site', async () => {
  const { f, reconnects } = harness({ 'GET /maintenance/unlock': AVAILABLE, 'POST /maintenance/unlock': json({ success: true, expiresAt: '2026-10-20T20:00:00.000Z' }) });
  applyMaintenanceState(LOCKED);
  await wait(5);
  f.input.value = 'the-right-one';
  await submit(f);
  assert.equal(reconnects.length, 1, 'the cookie is only read at the handshake');
  assert.equal(f.status.textContent, 'Signed in. Opening the parlor…');
  assert.equal(f.input.value, '');
  assert.equal(f.panel.classList.contains('is-hidden'), false, 'the panel stays until the server says bypass');
  applyMaintenanceState({ ...LOCKED, bypass: true });
  assert.equal(f.panel.classList.contains('is-hidden'), true);
  assert.equal(f.chip.classList.contains('is-hidden'), false);
  assert.equal(f.main.focused, 1, 'focus is handed to the site');
  assert.deepEqual(storageWrites, []);
});

await check('a rate limit shows the wait from Retry-After and blocks another attempt', async () => {
  const { f, calls } = harness({ 'GET /maintenance/unlock': AVAILABLE, 'POST /maintenance/unlock': json({ success: false, error: 'Too many attempts. Try again later.' }, 429, { 'retry-after': '125' }) });
  applyMaintenanceState(LOCKED);
  await wait(5);
  f.input.value = 'whatever';
  await submit(f);
  assert.equal(f.status.textContent, 'Too many attempts. Try again in 3 minutes.');
  assert.equal(f.submit.disabled, true);
  f.input.value = 'again';
  await submit(f);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1, 'a blocked form sends nothing');
  resetOperatorStateForTests();
});

await check('a plain-text 429 (no JSON, no header) is handled the same way', async () => {
  const response = { ok: false, status: 429, headers: { get: () => null }, json: async () => { throw new Error('not json'); } };
  const { f } = harness({ 'GET /maintenance/unlock': AVAILABLE, 'POST /maintenance/unlock': response });
  applyMaintenanceState(LOCKED);
  await wait(5);
  f.input.value = 'whatever';
  await submit(f);
  assert.equal(f.status.textContent, 'Too many attempts. Try again in 1 minute.');
  resetOperatorStateForTests();
});

await check('a network failure or a server error keeps the panel and asks to try again', async () => {
  const { f } = harness({ 'GET /maintenance/unlock': AVAILABLE, 'POST /maintenance/unlock': new Error('offline') });
  applyMaintenanceState(LOCKED);
  await wait(5);
  f.input.value = 'whatever';
  await submit(f);
  assert.equal(f.status.textContent, 'The server could not be reached. Try again.');
  assert.equal(f.panel.classList.contains('is-hidden'), false);
});

await check('show and hide flips the field type and the label without losing state', async () => {
  const { f } = harness({ 'GET /maintenance/unlock': AVAILABLE });
  applyMaintenanceState(LOCKED);
  await wait(5);
  await click(f, '[data-operator-reveal]');
  assert.equal(f.input.type, 'text');
  assert.equal(f.revealLabel.textContent, 'HIDE');
  assert.equal(f.reveal.getAttribute('aria-pressed'), 'true');
  await click(f, '[data-operator-reveal]');
  assert.equal(f.input.type, 'password');
  assert.equal(f.revealLabel.textContent, 'SHOW');
});

await check('sign-out posts to the logout route and reconnects the socket', async () => {
  const { f, calls, reconnects } = harness({ 'POST /maintenance/logout': json({ success: true }) });
  applyMaintenanceState({ ...LOCKED, bypass: true });
  const event = { target: { closest: selector => (selector === '[data-operator-signout]' ? f.signout : null) }, preventDefault() {} };
  await Promise.all(handlers.click.map(handler => handler(event)));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/maintenance/logout');
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(reconnects.length, 1);
  assert.equal(f.signout.disabled, false);
});

await check('a failed sign-out does not reconnect', async () => {
  const { f, reconnects } = harness({ 'POST /maintenance/logout': new Error('offline') });
  applyMaintenanceState({ ...LOCKED, bypass: true });
  const event = { target: { closest: selector => (selector === '[data-operator-signout]' ? f.signout : null) }, preventDefault() {} };
  await Promise.all(handlers.click.map(handler => handler(event)));
  assert.equal(reconnects.length, 0);
});

await check('Retry status re-asks whether sign-in exists', async () => {
  let reads = 0;
  const { f } = harness({ 'GET /maintenance/unlock': () => { reads += 1; return AVAILABLE; } });
  applyMaintenanceState(LOCKED);
  await wait(5);
  assert.equal(reads, 1);
  const retry = node();
  const event = { target: { closest: selector => (selector === '[data-maintenance-retry]' ? retry : null) }, preventDefault() {} };
  // emitServer is a no-op here; the acknowledgement path is the same apply call the socket uses.
  handlers.click.forEach(handler => handler(event));
  assert.equal(retry.disabled, true);
  applyMaintenanceState(LOCKED);
  await wait(5);
  assert.equal(reads, 2);
  assert.equal(f.form.classList.contains('is-hidden'), false);
});

if (!process.exitCode) console.log('clientMaintenanceOperator: lockout panel, sign-in, sign-out and states pass');
