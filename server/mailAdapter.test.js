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

for (const [url, environment, allowed] of [
  ['http://mail.example.test/send', 'production', false],
  ['http://127.0.0.1:1234/send', 'production', false],
  ['http://localhost:1234/send', 'development', true],
  ['http://127.0.0.1:1234/send', 'test', true],
  ['http://[::1]:1234/send', 'development', true],
  ['http://localhost.evil.test/send', 'development', false],
  ['http://127.0.0.1:1234/send', '', false],
  ['https://user:pass@mail.example.test/send', 'production', false],
  ['https://mail.example.test/send', 'production', true],
  ['javascript:alert(1)', 'development', false]
]) {
  let called = false;
  const subject = createMailAdapter({ env: { NODE_ENV: environment }, config: { apiUrl: url, apiKey: 'secret', from: 'a@example.test' }, fetchImpl: async (_url, options) => {
    called = true;
    assert.equal(options.redirect, 'error');
    return { ok: true, status: 202 };
  }});
  assert.equal(subject.configured, allowed, `${environment} ${url}`);
  const sent = await subject.send({ to: 'b@example.test', subject: 'Test', template: 'deletion-requested' });
  assert.equal(sent.success, allowed, `${environment} ${url}`);
  assert.equal(called, allowed, `${environment} ${url}`);
}
