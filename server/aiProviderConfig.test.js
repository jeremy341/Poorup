import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROVIDER_PROTOCOLS,
  ProviderConfigError,
  createAiProviderStore,
  decryptApiKey,
  deriveProviderEndpoint,
  detectProtocolFromUrl,
  encryptApiKey,
  extractProviderText,
  normalizeProviderConfig,
  probeProvider,
  redactProviderConfig,
} from './aiProviderConfig.js';

const pendingChecks = [];
function check(name, fn) {
  pendingChecks.push((async () => {
    try {
      await fn();
      console.log(`PASS - ${name}`);
    } catch (error) {
      console.error(`FAIL - ${name}:`, error.message);
      process.exitCode = 1;
    }
  })());
}

check('protocol and endpoint normalization is deterministic', () => {
  assert.deepEqual(PROVIDER_PROTOCOLS, ['auto', 'chat', 'responses']);
  assert.equal(detectProtocolFromUrl('https://api.openai.com/v1/chat/completions'), 'chat');
  assert.equal(detectProtocolFromUrl('https://api.openai.com/v1/responses'), 'responses');
  assert.equal(detectProtocolFromUrl('https://llm.example/v1'), null);
  assert.equal(deriveProviderEndpoint('https://api.openai.com/v1', 'chat'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(deriveProviderEndpoint('https://api.openai.com/v1', 'responses'), 'https://api.openai.com/v1/responses');
  assert.equal(deriveProviderEndpoint('https://api.openai.com/v1/chat/completions', 'responses'), 'https://api.openai.com/v1/chat/completions');
});

check('provider URL validation rejects unsafe inputs', () => {
  assert.throws(() => normalizeProviderConfig({ id: 'bad', label: 'Bad', baseUrl: 'file:///etc/passwd', model: 'x', apiKey: 'key' }), ProviderConfigError);
  assert.throws(() => normalizeProviderConfig({ id: 'bad', label: 'Bad', baseUrl: 'https://user:pass@example.test/v1', model: 'x', apiKey: 'key' }), ProviderConfigError);
  assert.throws(() => normalizeProviderConfig({ id: 'bad', label: 'Bad', baseUrl: 'http://127.0.0.1:9000/v1', model: 'x', apiKey: 'key', production: true }), ProviderConfigError);
  assert.equal(normalizeProviderConfig({ id: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:9000/v1', model: 'x', apiKey: 'key', allowPrivateEndpoints: true }).baseUrl, 'http://127.0.0.1:9000/v1');
});

check('API keys encrypt, decrypt, and reject tampering', () => {
  const cipher = encryptApiKey('secret-key', 'master-key-012345678901234567890123');
  assert.notEqual(cipher, 'secret-key');
  assert.equal(decryptApiKey(cipher, 'master-key-012345678901234567890123'), 'secret-key');
  assert.throws(() => decryptApiKey(`${cipher}ff`, 'master-key-012345678901234567890123'));
});

check('public provider views never include credentials', () => {
  const config = { ...normalizeProviderConfig({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', protocol: 'auto' }), apiKey: 'secret-key' };
  const view = redactProviderConfig(config);
  assert.equal(view.keyConfigured, true);
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'apiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'keyCipher'), false);
  assert.equal(view.protocol, 'auto');
});

check('encrypted store persists profiles and only returns redacted records', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-ai-provider-'));
  const filePath = path.join(directory, 'providers.json');
  const first = createAiProviderStore({ filePath, masterKey: 'test-master-key-0123456789012345' });
  const saved = first.upsert({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', apiKey: 'secret-key', protocol: 'auto' });
  assert.equal(saved.keyConfigured, true);
  first.markTest('openai', { ok: true, protocol: 'chat', latencyMs: 1 });
  assert.equal(first.activate('openai').id, 'openai');
  assert.equal(first.list()[0].keyConfigured, true);
  assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /secret-key/);
  const second = createAiProviderStore({ filePath, masterKey: 'test-master-key-0123456789012345' });
  assert.equal(second.active().apiKey, 'secret-key');
  assert.equal(second.active().model, 'gpt-test');
  fs.rmSync(directory, { recursive: true, force: true });
});

check('probe detects Chat Completions and Responses without game context', async () => {
  const calls = [];
  const chat = { ...normalizeProviderConfig({ id: 'chat', label: 'Chat', baseUrl: 'https://provider.test/v1', model: 'chat-model', protocol: 'auto' }), apiKey: 'key' };
  const chatResult = await probeProvider(chat, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  });
  assert.equal(chatResult.ok, true);
  assert.equal(chatResult.protocol, 'chat');
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.equal(JSON.stringify(calls[0].body).includes('cash'), false);

  const responses = { ...normalizeProviderConfig({ id: 'responses', label: 'Responses', baseUrl: 'https://provider.test/v1', model: 'response-model', protocol: 'responses' }), apiKey: 'key' };
  const responsesResult = await probeProvider(responses, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.ok(Array.isArray(body.input));
    assert.ok(body.text?.format);
    return { ok: true, status: 200, json: async () => ({ output_text: '{"ok":true}' }) };
  });
  assert.equal(responsesResult.ok, true);
  assert.equal(responsesResult.protocol, 'responses');
  assert.equal(extractProviderText({ output: [{ content: [{ type: 'output_text', text: 'hello' }] }] }, 'responses'), 'hello');
});

await Promise.all(pendingChecks);
console.log('AI provider config tests complete');
