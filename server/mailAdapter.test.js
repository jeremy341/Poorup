import assert from 'node:assert/strict';
import { createMailAdapter } from './mailAdapter.js';

let request;
const adapter = createMailAdapter({
  config: { apiUrl: 'https://mail.example.test/send', apiKey: 'secret-key', from: 'Poorup <noreply@example.test>' },
  fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, status: 202, text: async () => '' }; },
  now: () => 0,
});
const result = await adapter.send({ to: 'owner@example.test', subject: 'Account update', template: 'deletion-requested', variables: { dueAt: '2026-10-17T12:00:00.000Z' } });
assert.equal(result.success, true);
assert.equal(request.url, 'https://mail.example.test/send');
assert.equal(request.options.headers.Authorization, 'Bearer secret-key');
assert.equal(JSON.parse(request.options.body).to, 'owner@example.test');
assert.equal(JSON.parse(request.options.body).template, 'deletion-requested');
assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(request.options.body), 'token'), false);
console.log('mail adapter: 5 passed, 0 failed');
