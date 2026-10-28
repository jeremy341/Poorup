// Editing the ACTIVE provider's connection must not reach the advisor until
// a connection test passes, so a bad key or URL never goes live.
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createAiProviderManager, createAiProviderStore } from './aiProviderConfig.js';
import { AiAdvisor } from './botAdvisor.js';
import { registerAiProviderRoutes } from './aiProviderRoutes.js';

async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const GOOD_KEY = 'good-key-1';
const BAD_KEY = 'bad-key-9';

// A provider that accepts one key and rejects every other with a 401.
function provider(calls) {
  return async (_url, options) => {
    const key = String(options.headers.authorization || '').replace(/^Bearer /, '');
    calls.push(key);
    if (key !== GOOD_KEY && key !== 'good-key-2') return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  };
}

function build() {
  const calls = [];
  const store = createAiProviderStore({});
  const advisor = new AiAdvisor({ apiKey: '', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  const reply = provider(calls);
  const manager = createAiProviderManager({
    store,
    advisor,
    env: { NODE_ENV: 'test' },
    fetchImpl: reply,
    requestImpl: reply,
    resolveHost: async () => [{ address: '8.8.8.8', family: 4 }],
  });
  manager.upsert({ id: 'main', label: 'Main', baseUrl: 'https://provider.test/v1', model: 'model-a', apiKey: GOOD_KEY, protocol: 'chat' });
  return { calls, store, advisor, manager };
}

async function activate(manager) {
  assert.equal((await manager.test('main')).ok, true);
  manager.activate('main');
}

await check('an edit to the active provider that fails the test leaves the previous config active', async () => {
  const { store, advisor, manager, calls } = build();
  await activate(manager);
  const before = advisor.getHealth();
  const probes = calls.length;
  const outcome = await manager.update({ id: 'main', apiKey: BAD_KEY });
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.test.ok, false);
  assert.equal(calls.length, probes + 1, 'the same probe the test route uses ran against the candidate');
  assert.equal(calls.at(-1), BAD_KEY, 'the candidate key, not the stored one, was probed');
  assert.equal(store.get('main').apiKey, GOOD_KEY, 'the stored key is unchanged');
  assert.equal(store.active().apiKey, GOOD_KEY);
  assert.equal(store.active().lastTest.ok, true, 'the previous passing test is still on record');
  assert.equal(advisor.apiKey, GOOD_KEY, 'the advisor is still using the working key');
  assert.deepEqual(advisor.getHealth(), before);
});

await check('an edit to the active provider that passes the test is applied and stored as tested', async () => {
  const { store, advisor, manager } = build();
  await activate(manager);
  const outcome = await manager.update({ id: 'main', apiKey: 'good-key-2', model: 'model-b' });
  assert.equal(outcome.rejected, undefined);
  assert.equal(outcome.test.ok, true);
  assert.equal(store.active().apiKey, 'good-key-2');
  assert.equal(store.active().model, 'model-b');
  assert.equal(store.active().lastTest.ok, true, 'the profile is recorded as tested, so it stays activatable');
  assert.equal(advisor.apiKey, 'good-key-2');
  assert.equal(advisor.model, 'model-b');
});

await check('manager.upsert refuses a connection change to the active provider instead of applying it untested', async () => {
  const { store, advisor, manager } = build();
  await activate(manager);
  assert.throws(() => manager.upsert({ id: 'main', apiKey: BAD_KEY }), error => error.code === 'TEST_REQUIRED');
  assert.equal(store.active().apiKey, GOOD_KEY);
  assert.equal(advisor.apiKey, GOOD_KEY);
});

await check('edits that do not touch the connection, and edits to inactive profiles, need no test', async () => {
  const { calls, store, manager } = build();
  await activate(manager);
  const probes = calls.length;
  assert.equal((await manager.update({ id: 'main', label: 'Renamed' })).profile.label, 'Renamed');
  manager.upsert({ id: 'spare', label: 'Spare', baseUrl: 'https://provider.test/v1', model: 'm', apiKey: BAD_KEY, protocol: 'chat' });
  assert.equal((await manager.update({ id: 'spare', apiKey: 'other-key' })).profile.id, 'spare');
  assert.equal(calls.length, probes, 'no probe ran');
  assert.equal(store.get('spare').lastTest, null, 'an inactive edit still has to be tested before it can be activated');
});

await check('PATCH on the active provider answers a failed test with an error and keeps the previous config', async () => {
  const { store, manager } = build();
  await activate(manager);
  const app = express();
  registerAiProviderRoutes(app, { manager, adminIds: ['acct-admin'], accountResolver: () => ({ id: 'acct-admin' }) });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = body => fetch(`${base}/admin/ai/providers/main`, { method: 'PATCH', headers: { cookie: 'poorup_session=x', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const rejected = await send({ apiKey: BAD_KEY });
    const payload = await rejected.json();
    assert.equal(rejected.status, 422);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'PROVIDER_TEST_FAILED');
    assert.equal(JSON.stringify(payload).includes(BAD_KEY), false);
    assert.equal(store.active().apiKey, GOOD_KEY);
    const accepted = await send({ apiKey: 'good-key-2' });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).success, true);
    assert.equal(store.active().apiKey, 'good-key-2');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
