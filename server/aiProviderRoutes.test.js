import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createAiProviderManager, createAiProviderStore } from './aiProviderConfig.js';
import { AiAdvisor } from './botAdvisor.js';
import { registerAiProviderRoutes } from './aiProviderRoutes.js';

const app = express();
const accountStore = { sessionAccount: token => token === 'admin-session' ? { id: 'acct-admin' } : null };
const store = createAiProviderStore({});
const advisor = new AiAdvisor({ apiKey: '', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
const manager = createAiProviderManager({ store, advisor, fetchImpl: async (_url, options) => {
  const body = JSON.parse(options.body);
  if (body.messages) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  return { ok: true, status: 200, json: async () => ({ output_text: '{"ok":true}' }) };
} });
registerAiProviderRoutes(app, { manager, accountStore, adminIds: ['acct-admin'] });

const server = http.createServer(app);
await new Promise(resolve => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const headers = { 'x-poorup-session-token': 'admin-session' };

try {
  const denied = await fetch(`${base}/admin/ai/providers`);
  assert.equal(denied.status, 403);

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
  console.log('AI provider routes: all checks passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
