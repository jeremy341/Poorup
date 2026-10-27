import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const index = readFileSync(join(root, 'index.html'), 'utf8');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');
const source = readFileSync(join(root, 'clientAdminAiProvider.js'), 'utf8');
const main = readFileSync(join(root, 'main.js'), 'utf8');

// The editor is inline again, beside the active provider, inside Bots & AI. No drawer, no separate surface switcher.
assert.doesNotMatch(index, /data-admin-console-tabs|data-admin-console-tab=|data-admin-provider-drawer|admin-drawer|data-drawer-close/);
assert.match(index, /data-admin-provider-roster/);
assert.match(index, /<aside class="admin-provider-active panel" aria-label="Active provider">/);
assert.match(index, /<section class="admin-provider-editor"/);
assert.match(index, /data-admin-provider-field="baseUrl"[^>]*type="url"/);
assert.match(index, /data-admin-provider-field="apiKey"[^>]*type="password"[^>]*autocomplete="new-password"/);
assert.match(index, /data-admin-provider-field="protocol"/);
assert.match(index, /data-admin-provider-field="model"/);
assert.doesNotMatch(index, /data-admin-provider-field="apiKey"[^>]*value=/i);
assert.doesNotMatch(styles, /\.admin-drawer|@keyframes admin-drawer-in/);
assert.match(styles, /\.admin-provider-layout/);
assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*?admin-console/);

// Auth and transport: one shared admin request helper, cookie session plus optional token, never cached.
assert.match(source, /export async function adminRequest/);
assert.match(source, /x-poorup-session-token/);
assert.doesNotMatch(source, /if \(!state\.account\?\.sessionToken\)/);
assert.match(source, /credentials:\s*['"]include['"]/);
assert.match(source, /cache:\s*['"]no-store['"]/);
assert.match(source, /credentials are write-only|write-only/i);
assert.doesNotMatch(source, /localStorage/);
assert.equal((source.match(/\bfetch\(/g) || []).length, 0, 'every call goes through adminRequest');

// The roster refreshes when the section is shown; there is no dialog to trap focus in.
assert.doesNotMatch(source, /createDrawer|clientAdminDrawer/);
assert.match(source, /poorup-bot-provider-status/);
assert.match(source, /poorup-admin-tab/);

assert.match(main, /import \{ initAdminAiProvider \} from ["']\.\/clientAdminAiProvider\.js["'];/);
assert.match(main, /const analyticsPathActive = initAnalytics\(\);\s*if \(analyticsPathActive\) initAdminAiProvider\(\);/);
assert.equal((main.match(/initAdminAiProvider\(\)/g) || []).length, 1);

// adminRequest behaviour with an injected fetcher.
globalThis.window = { location: { pathname: '/' } };
const { adminRequest, sessionHeaders } = await import('./clientAdminAiProvider.js');
const { state } = await import('./clientState.js');
const calls = [];
const fetcher = async (path, init) => { calls.push({ path, init }); return { ok: init.method !== 'POST', status: init.method === 'POST' ? 400 : 200, json: async () => (init.method === 'POST' ? { success: false, error: 'nope' } : { success: true, value: 1 }) }; };
const previous = state.account;
state.account = { sessionToken: 'tok' };
assert.deepEqual(sessionHeaders(true), { 'x-poorup-session-token': 'tok', 'content-type': 'application/json' });
const read = await adminRequest('/admin/ops/status', { fetcher });
assert.equal(read.ok, true);
assert.equal(calls[0].init.credentials, 'include');
assert.equal(calls[0].init.cache, 'no-store');
assert.equal(calls[0].init.method, 'GET');
assert.equal(calls[0].init.body, undefined);
const write = await adminRequest('/admin/ops/maintenance', { method: 'POST', body: { mode: 'draining' }, fetcher });
assert.equal(write.ok, false);
assert.equal(write.status, 400);
assert.equal(write.payload.error, 'nope');
assert.equal(calls[1].init.body, '{"mode":"draining"}');
assert.equal(calls[1].init.headers['content-type'], 'application/json');
state.account = null;
assert.deepEqual(sessionHeaders(), {}, 'a cookie session needs no token header');
state.account = previous;
const savedFetch = globalThis.fetch;
globalThis.fetch = undefined;
assert.equal((await adminRequest('/x')).status, 503, 'no transport reads as unavailable');
globalThis.fetch = savedFetch;

// The state badge: one answer from the server's own health, never invented from profile test data.
const { providerBadge, mergeProviderHealth } = await import('./clientAdminAiProvider.js');
const TESTED = { id: 'p', label: 'P', lastTest: { ok: true } };
const UNTESTED = { id: 'p', label: 'P', lastTest: null };
assert.equal(providerBadge(null, null).label, 'UNCONFIGURED', 'no profile and no health is unconfigured, not a fallback in progress');
assert.equal(providerBadge(null, { state: 'unconfigured' }).label, 'UNCONFIGURED');
assert.equal(providerBadge(TESTED, { state: 'healthy' }).label, 'READY');
assert.equal(providerBadge(TESTED, { state: 'healthy' }).state, 'healthy');
assert.equal(providerBadge(TESTED, { state: 'quota-exhausted' }).label, 'CREDITS EXHAUSTED');
assert.equal(providerBadge(TESTED, { state: 'cooldown' }).label, 'COOLDOWN');
assert.equal(providerBadge(TESTED, { state: 'open' }).label, 'FALLBACK ACTIVE');
assert.equal(providerBadge(TESTED, { state: 'open' }).state, 'error');
// Before any health is known, an active profile is described by its last test.
assert.equal(providerBadge(TESTED, null).label, 'READY');
assert.equal(providerBadge(UNTESTED, null).label, 'FALLBACK ACTIVE');
// A saved profile the server is not actually using is told apart from a working one.
assert.equal(providerBadge(TESTED, { state: 'unconfigured' }).label, 'UNCONFIGURED');
assert.equal(providerBadge(TESTED, { state: 'unconfigured' }).notInUse, true);
assert.equal(providerBadge(TESTED, { state: 'healthy' }).notInUse, false);
assert.equal(providerBadge(null, { state: 'unconfigured' }).notInUse, false, 'nothing active: nothing to say it is not in use');
// A roster read that carries no health must not erase the health already known.
assert.deepEqual(mergeProviderHealth({ state: 'unconfigured' }, undefined), { state: 'unconfigured' });
assert.deepEqual(mergeProviderHealth({ state: 'unconfigured' }, null), { state: 'unconfigured' });
assert.deepEqual(mergeProviderHealth({ state: 'unconfigured' }, { state: 'healthy' }), { state: 'healthy' });
assert.equal(mergeProviderHealth(null, 'nonsense'), null);

// Controller behaviour with a small fake DOM and fetch: audit warning and the stale test answer.
const fakeEl = () => {
  const attrs = {}; const classes = new Set(); const listeners = {};
  return {
    textContent: '', value: '', dataset: {}, disabled: false, children: [], attrs, listeners,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: k => attrs[k] ?? null, hasAttribute: k => k in attrs,
    querySelector: () => null, querySelectorAll: () => [], append() {}, replaceChildren() {}, focus() {},
    addEventListener: (type, fn) => { listeners[type] = fn; }, reportValidity: () => true, closest: () => null,
  };
};
const nodes = {};
const nodeFor = selector => (nodes[selector] ||= fakeEl());
globalThis.window = { location: { pathname: '/admin/analytics' } };
globalThis.document = {
  querySelector: nodeFor, createElement: fakeEl, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
};
const profileRow = lastTest => ({ id: 'p1', label: 'Main', model: 'm', baseUrl: 'https://x.test/v1', protocol: 'auto', keyConfigured: true, lastTest });
let routes = {};
globalThis.fetch = async (path, init) => {
  const hit = routes[`${init.method} ${path}`];
  const [status, body] = hit ? hit() : [404, { success: false, error: 'missing' }];
  return { ok: status < 400, status, json: async () => body };
};
const { initAdminAiProvider } = await import('./clientAdminAiProvider.js');
assert.equal(initAdminAiProvider(), true);
const AUDIT_WARNING = 'Done, but the audit log could not be saved. Check the audit log file.';
const providerStatus = () => nodeFor('[data-admin-provider-test-status]');
const click = async (action) => {
  const button = { dataset: { adminProviderAction: action, profileId: 'p1' } };
  nodeFor('[data-admin-provider-list]').listeners.click({ target: { closest: selector => (selector.includes('action') ? button : null) } });
  await new Promise(resolve => setTimeout(resolve, 10));
};
routes['GET /admin/ai/providers'] = () => [200, { success: true, providers: [profileRow(null)], active: null }];
await globalThis.__poorupAdminAiProvider.load();

routes['POST /admin/ai/providers/p1/test'] = () => [409, { success: false, code: 'PROFILE_CHANGED', error: 'The profile changed while the test ran; run the test again.', test: { ok: false, reason: 'stale' } }];
await click('test');
assert.equal(providerStatus().textContent, 'The profile changed while the test ran; run the test again.');
assert.doesNotMatch(providerStatus().textContent, /STALE/);
assert.ok(providerStatus().classList.contains('warning'));
assert.equal(globalThis.__poorupAdminAiProvider.model.profiles[0].lastTest, null, 'a stale test never marks the profile tested');

routes['POST /admin/ai/providers/p1/test'] = () => [422, { success: false, test: { ok: false, reason: { weird: true } } }];
await click('test');
assert.ok(providerStatus().classList.contains('warning'), 'an unknown reason shape still renders a failure');

const tested = profileRow({ ok: true, protocol: 'chat', latencyMs: 12, testedAt: 'now' });
routes['POST /admin/ai/providers/p1/test'] = () => [200, { success: true, audited: false, test: { ok: true, protocol: 'chat', latencyMs: 12 }, profile: tested }];
await click('test');
assert.equal(providerStatus().textContent, AUDIT_WARNING);
assert.ok(providerStatus().classList.contains('warning'));
assert.equal(providerStatus().classList.contains('green'), false);
routes['POST /admin/ai/providers/p1/test'] = () => [200, { success: true, test: { ok: true, protocol: 'chat', latencyMs: 12 }, profile: tested }];
await click('test');
assert.match(providerStatus().textContent, /READY · 12MS/, 'persisted responses are unchanged');
assert.ok(providerStatus().classList.contains('green'));

routes['POST /admin/ai/providers/p1/activate'] = () => [200, { success: true, audited: false, active: tested }];
await click('activate');
assert.equal(providerStatus().textContent, AUDIT_WARNING);
routes['POST /admin/ai/providers/p1/activate'] = () => [200, { success: true, active: tested }];
await click('activate');
assert.match(providerStatus().textContent, /^PROVIDER ACTIVE/);

routes['PATCH /admin/ai/providers/p1'] = () => [200, { success: true, audited: false, profile: tested }];
await nodeFor('[data-admin-provider-form]').listeners.submit({ preventDefault() {} });
await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(providerStatus().textContent, AUDIT_WARNING);
routes['PATCH /admin/ai/providers/p1'] = () => [200, { success: true, profile: tested }];
await nodeFor('[data-admin-provider-form]').listeners.submit({ preventDefault() {} });
await new Promise(resolve => setTimeout(resolve, 10));
assert.match(providerStatus().textContent, /^PROFILE SAVED/);
globalThis.__poorupAdminAiProvider.destroy();

console.log('admin AI provider client contract: passed');
