import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createAiProviderManager, createAiProviderStore } from './aiProviderConfig.js';
import { AiAdvisor } from './botAdvisor.js';
import { registerAiProviderRoutes } from './aiProviderRoutes.js';
import { createAdminAuditLog } from './adminAuditLog.js';

const app = express();
const accountStore = { sessionAccount: token => token === 'admin-session' ? { id: 'acct-admin' } : null };
const store = createAiProviderStore({});
const advisor = new AiAdvisor({ apiKey: '', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
const manager = createAiProviderManager({ store, advisor, fetchImpl: async (_url, options) => {
  const body = JSON.parse(options.body);
  if (body.messages) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  return { ok: true, status: 200, json: async () => ({ output_text: '{"ok":true}' }) };
}, resolveHost: async () => [{ address: '8.8.8.8', family: 4 }], requestImpl: async (_url, options) => {
  const body = JSON.parse(options.body);
  if (body.messages) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  return { ok: true, status: 200, json: async () => ({ output_text: '{"ok":true}' }) };
} });
const auditLog = createAdminAuditLog({ key: 'route-test' });
registerAiProviderRoutes(app, {
  manager,
  auditLog,
  accountStore,
  adminIds: ['acct-admin'],
  accountResolver: req => {
    if (req.headers.cookie === 'poorup_session=valid-cookie-session') return { id: 'acct-admin' };
    if (req.headers.cookie === 'poorup_session=member-session') return { id: 'acct-member' };
    return null;
  }
});

const server = http.createServer(app);
await new Promise(resolve => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const headers = { 'x-poorup-session-token': 'admin-session' };

try {
  const denied = await fetch(`${base}/admin/ai/providers`);
  assert.equal(denied.status, 401);

  const cookieSessionResponse = await fetch(`${base}/admin/ai/providers`, { headers: { cookie: 'poorup_session=valid-cookie-session' } });
  assert.equal(cookieSessionResponse.status, 200);

  const nonAdminCookieResponse = await fetch(`${base}/admin/ai/providers`, { headers: { cookie: 'poorup_session=member-session' } });
  assert.equal(nonAdminCookieResponse.status, 403);

  const forbiddenOrigin = await fetch(`${base}/admin/ai/providers`, { headers: { ...headers, origin: 'https://evil.example' } });
  assert.equal(forbiddenOrigin.status, 403);

  const createdResponse = await fetch(`${base}/admin/ai/providers`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'openai-main', label: 'OpenAI main', baseUrl: 'https://provider.test/v1', model: 'chat-model', protocol: 'auto', apiKey: 'secret-key' })
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(created.profile.keyConfigured, true);
  assert.equal(JSON.stringify(created).includes('secret-key'), false);

  const listedResponse = await fetch(`${base}/admin/ai/providers`, { headers });
  const listed = await listedResponse.json();
  assert.equal(listedResponse.status, 200);
  assert.equal(listed.providers[0].keyConfigured, true);
  assert.equal(JSON.stringify(listed).includes('secret-key'), false);
  // The roster carries the server's own health, so the badge never has to guess it.
  assert.equal(listed.provider.state, 'unconfigured', 'a saved profile that is not active leaves the advisor unconfigured');
  assert.equal(JSON.stringify(listed.provider).includes('apiKey'), false);

  const testedResponse = await fetch(`${base}/admin/ai/providers/openai-main/test`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
  const tested = await testedResponse.json();
  assert.equal(testedResponse.status, 200);
  assert.equal(tested.test.ok, true);
  assert.equal(tested.test.protocol, 'chat');

  const activatedResponse = await fetch(`${base}/admin/ai/providers/openai-main/activate`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
  const activated = await activatedResponse.json();
  assert.equal(activatedResponse.status, 200);
  assert.equal(activated.active.id, 'openai-main');
  assert.equal(manager.status().active.id, 'openai-main');
  assert.equal(activated.status.provider.state, 'healthy', 'activation answers with the health it produced');
  const relisted = await (await fetch(`${base}/admin/ai/providers`, { headers })).json();
  assert.equal(relisted.provider.state, 'healthy');
  assert.equal(relisted.active.id, 'openai-main');
  // Every change above landed in the shared operator log, without the key or the URL.
  assert.deepEqual(auditLog.list().map(entry => `${entry.action}:${entry.target}:${entry.outcome}`).reverse(), ['create:OpenAI main:ok', 'test:OpenAI main:ok', 'activate:OpenAI main:ok']);
  assert.equal(JSON.stringify(auditLog.list()).includes('secret-key'), false);
  assert.equal(JSON.stringify(auditLog.list()).includes('provider.test'), false);

  // A probe that was not stored (the profile changed while it ran) is not a success.
  const raceStore = createAiProviderStore({});
  raceStore.upsert({ id: 'race', label: 'Race', baseUrl: 'https://provider.test/v1', model: 'old-model', apiKey: 'secret-key', protocol: 'chat' });
  const raceOk = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  const raceManager = createAiProviderManager({
    store: raceStore,
    advisor: new AiAdvisor({ apiKey: '', fetchImpl: async () => ({}) }),
    env: { NODE_ENV: 'test' },
    requestImpl: async () => { await new Promise(resolve => setTimeout(resolve, 5)); raceStore.upsert({ id: 'race', model: 'edited-model' }); return raceOk; },
    resolveHost: async () => [{ address: '8.8.8.8', family: 4 }],
  });
  const raceLog = createAdminAuditLog({ key: 'race-test' });
  const raceApp = express();
  registerAiProviderRoutes(raceApp, { manager: raceManager, auditLog: raceLog, accountStore, adminIds: ['acct-admin'] });
  const raceServer = http.createServer(raceApp);
  await new Promise(resolve => raceServer.listen(0, resolve));
  try {
    const staleResponse = await fetch(`http://127.0.0.1:${raceServer.address().port}/admin/ai/providers/race/test`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
    const staleBody = await staleResponse.json();
    assert.equal(staleResponse.status, 409);
    assert.equal(staleBody.success, false);
    assert.equal(staleBody.code, 'PROFILE_CHANGED');
    assert.match(staleBody.error, /changed while the test ran; run the test again/i);
    assert.equal(raceStore.list()[0].lastTest, null);
    assert.deepEqual(raceLog.list().map(entry => `${entry.action}:${entry.outcome}`), ['test:failed'], 'a stale test is audited as a failure');
  } finally {
    await new Promise(resolve => raceServer.close(resolve));
  }
  // The write limit (12 a minute per admin) still applies to provider changes.
  const statuses = [];
  for (let index = 0; index < 12; index += 1) {
    const response = await fetch(`${base}/admin/ai/providers/openai-main`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'chat-model' }) });
    statuses.push(response.status);
  }
  assert.equal(statuses.includes(429), true);
  assert.equal(statuses.at(-1), 429);
  console.log('AI provider routes: all checks passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
