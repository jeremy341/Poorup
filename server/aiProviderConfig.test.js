import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROVIDER_PROTOCOLS,
  ProviderConfigError,
  createAiProviderStore,
  createAiProviderManager,
  decryptApiKey,
  deriveProviderEndpoint,
  detectProtocolFromUrl,
  encryptApiKey,
  extractProviderText,
  normalizeProviderConfig,
  normalizeProviderUrl,
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

check('private provider URL checks normalize host and IP representations', () => {
  const privateUrls = [
    'https://localhost./v1',
    'https://api.localhost./v1',
    'https://127.0.0.1./v1',
    'https://0x7f.1/v1',
    'https://192.0.2.10/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'https://[::ffff:7f00:1]/v1',
    'https://[fd00::1]/v1',
    'https://[fe80::1]/v1',
  ];
  for (const baseUrl of privateUrls) {
    assert.throws(
      () => normalizeProviderUrl(baseUrl, { allowPrivateEndpoints: false }),
      error => error instanceof ProviderConfigError && error.code === 'BASE_URL_PRIVATE_HOST',
      baseUrl
    );
  }
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
  }, undefined, { resolveHost: async () => [{ address: '8.8.8.8', family: 4 }] });
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
  }, undefined, { resolveHost: async () => [{ address: '8.8.8.8', family: 4 }] });
  assert.equal(responsesResult.ok, true);
  assert.equal(responsesResult.protocol, 'responses');
  assert.equal(extractProviderText({ output: [{ content: [{ type: 'output_text', text: 'hello' }] }] }, 'responses'), 'hello');
});

check('provider probes refuse redirects so a public URL cannot redirect to a private host', async () => {
  const calls = [];
  const config = {
    ...normalizeProviderConfig({ id: 'redirect', label: 'Redirect', baseUrl: 'https://provider.test/v1', model: 'model', protocol: 'chat' }),
    apiKey: 'key',
  };
  const result = await probeProvider(config, async (url, options) => {
    calls.push({ url, options });
    return { ok: false, status: 302, json: async () => ({}) };
  }, undefined, { resolveHost: async () => [{ address: '8.8.8.8', family: 4 }] });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'error');
});

check('provider probes allow a hostname resolving only to public addresses', async () => {
  const calls = [];
  const config = {
    ...normalizeProviderConfig({ id: 'dns-public', label: 'DNS Public', baseUrl: 'https://provider.example/v1', model: 'model', protocol: 'chat' }),
    apiKey: 'key',
  };
  const result = await probeProvider(config, async () => {
    calls.push(true);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  }, () => 1, { resolveHost: async host => {
    assert.equal(host, 'provider.example');
    return [{ address: '8.8.8.8', family: 4 }];
  } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

check('provider probes reject private DNS answers before connecting', async () => {
  const config = {
    ...normalizeProviderConfig({ id: 'dns-private', label: 'DNS Private', baseUrl: 'https://provider.example/v1', model: 'model', protocol: 'chat' }),
    apiKey: 'key',
  };
  let calls = 0;
  const result = await probeProvider(config, async () => { calls += 1; }, () => 1, {
    resolveHost: async () => [{ address: '10.20.30.40', family: 4 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network');
  assert.equal(calls, 0);
});

check('provider probes reject mixed public and private DNS answers', async () => {
  const config = {
    ...normalizeProviderConfig({ id: 'dns-mixed', label: 'DNS Mixed', baseUrl: 'https://provider.example/v1', model: 'model', protocol: 'chat' }),
    apiKey: 'key',
  };
  let calls = 0;
  const result = await probeProvider(config, async () => { calls += 1; }, () => 1, {
    resolveHost: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

check('provider probes classify IPv4-mapped IPv6 DNS answers as private', async () => {
  const config = {
    ...normalizeProviderConfig({ id: 'dns-mapped', label: 'DNS Mapped', baseUrl: 'https://provider.example/v1', model: 'model', protocol: 'chat' }),
    apiKey: 'key',
  };
  let calls = 0;
  const result = await probeProvider(config, async () => { calls += 1; }, () => 1, {
    resolveHost: async () => [{ address: '::ffff:192.168.1.5', family: 6 }],
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

check('provider probes reject reserved non-global IPv6 DNS answers', async () => {
  const config = {
    ...normalizeProviderConfig({ id: 'dns-reserved-v6', label: 'DNS Reserved IPv6', baseUrl: 'https://provider.example/v1', model: 'model', protocol: 'chat' }),
    apiKey: 'key',
  };
  let calls = 0;
  const result = await probeProvider(config, async () => { calls += 1; }, () => 1, {
    resolveHost: async () => [{ address: '2001:db8::1', family: 6 }],
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

check('provider probes fail closed when DNS resolution errors', async () => {
  const config = {
    ...normalizeProviderConfig({ id: 'dns-error', label: 'DNS Error', baseUrl: 'https://provider.example/v1', model: 'model', protocol: 'chat' }),
    apiKey: 'key',
  };
  let calls = 0;
  const result = await probeProvider(config, async () => { calls += 1; }, () => 1, {
    resolveHost: async () => { throw new Error('resolver unavailable'); },
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

check('private DNS endpoints require an explicit non-production opt-in', async () => {
  const config = {
    ...normalizeProviderConfig({ id: 'dns-opt-in', label: 'DNS Opt In', baseUrl: 'http://provider.example/v1', model: 'model', protocol: 'chat', allowPrivateEndpoints: true }),
    apiKey: 'key',
  };
  const result = await probeProvider(config, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
  }), () => 1, {
    allowPrivateEndpoints: true,
    resolveHost: async () => [{ address: '192.168.1.20', family: 4 }],
  });
  assert.equal(result.ok, true);
});

check('production requests ignore private endpoint opt-in and fail closed', async () => {
  const calls = [];
  const advisor = { fetchImpl: async (...args) => { calls.push(args); }, configureProvider() {} };
  createAiProviderManager({
    store: { active: () => ({ apiKey: 'key', baseUrl: 'https://provider.example/v1', label: 'Provider', model: 'model', protocol: 'chat' }) },
    advisor,
    env: { NODE_ENV: 'production', POORUP_AI_ALLOW_PRIVATE: 'true' },
    resolveHost: async () => [{ address: '10.0.0.2', family: 4 }],
  });
  await assert.rejects(advisor.fetchImpl('https://provider.example/v1/chat/completions'), error => error.code === 'BASE_URL_PRIVATE_HOST');
  assert.equal(calls.length, 0);
});

check('production mode normalization blocks private endpoints despite surrounding whitespace', async () => {
  let requestCalls = 0;
  const profile = {
    ...normalizeProviderConfig({ id: 'local', label: 'Local', baseUrl: 'http://provider.example/v1', model: 'model', allowPrivateEndpoints: true }),
    apiKey: 'key',
  };
  const advisor = { fetchImpl: async () => { requestCalls += 1; }, configureProvider() {} };
  createAiProviderManager({
    store: { active: () => profile },
    advisor,
    env: { NODE_ENV: 'production ' },
    requestImpl: async () => { requestCalls += 1; },
    resolveHost: async () => [{ address: '10.0.0.2', family: 4 }],
  });

  await assert.rejects(advisor.fetchImpl('http://provider.example/v1/chat/completions'), error => error.code === 'BASE_URL_PRIVATE_HOST');
  assert.equal(requestCalls, 0);
});

check('non-production active providers honor explicit private endpoint opt-in', async () => {
  const calls = [];
  const advisor = { fetchImpl: async (...args) => { calls.push(args); }, configureProvider() {} };
  const profile = {
    ...normalizeProviderConfig({ id: 'local', label: 'Local', baseUrl: 'http://provider.example/v1', model: 'model', allowPrivateEndpoints: true }),
    apiKey: 'key',
  };
  createAiProviderManager({
    store: { active: () => profile },
    advisor,
    env: { NODE_ENV: 'test' },
    requestImpl: async (_url, _options, destination) => { calls.push(destination); return { ok: true, status: 200 }; },
    resolveHost: async () => [{ address: '192.168.1.20', family: 4 }],
  });
  await advisor.fetchImpl('http://provider.example/v1/chat/completions');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].addresses, ['192.168.1.20']);
});

check('active provider requests refuse redirects as well as configuration probes', async () => {
  const calls = [];
  const rawFetch = async (_url, options) => {
    calls.push(options);
    return { ok: false, status: 302 };
  };
  const advisor = { fetchImpl: rawFetch, configureProvider() {} };
  const profile = {
    apiKey: 'key',
    baseUrl: 'https://provider.test/v1',
    label: 'Provider',
    model: 'model',
    protocol: 'chat',
    timeoutMs: 4_000,
    maxDecisionsPerGame: 120,
  };
  createAiProviderManager({
    store: { active: () => profile },
    advisor,
    env: { NODE_ENV: 'test' },
    fetchImpl: rawFetch,
    requestImpl: async (_url, options) => {
      calls.push(options);
      return { ok: false, status: 302 };
    },
    resolveHost: async () => [{ address: '8.8.8.8', family: 4 }],
  });
  await advisor.fetchImpl('https://provider.test/v1/chat/completions', { redirect: 'follow' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, 'error');
});

check('active provider transport uses only the address resolved and validated for the request', async () => {
  const calls = [];
  const profile = {
    apiKey: 'key', baseUrl: 'https://provider.test/v1', label: 'Provider', model: 'model', protocol: 'chat',
    timeoutMs: 4_000, maxDecisionsPerGame: 120,
  };
  const advisor = { fetchImpl: async () => { throw new Error('un-pinned fetch must not be used'); }, configureProvider() {} };
  createAiProviderManager({
    store: { active: () => profile },
    advisor,
    env: { NODE_ENV: 'test' },
    requestImpl: async (url, options, destination) => {
      calls.push({ url, options, destination });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    resolveHost: async () => [{ address: '8.8.8.8', family: 4 }],
  });

  const response = await advisor.fetchImpl('https://provider.test/v1/chat/completions', { method: 'POST', body: '{}' });
  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(calls[0].destination.addresses, ['8.8.8.8']);
});

check('default provider transport connects to the vetted DNS address while retaining the provider host', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ host: request.headers.host, received: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const profile = {
      ...normalizeProviderConfig({ id: 'local', label: 'Local', baseUrl: `http://provider.test:${address.port}/v1`, model: 'model', allowPrivateEndpoints: true }),
      apiKey: 'key',
    };
    const advisor = { fetchImpl: async () => { throw new Error('un-pinned fetch must not be used'); }, configureProvider() {} };
    createAiProviderManager({
      store: { active: () => profile },
      advisor,
      env: { NODE_ENV: 'test' },
      resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    const response = await advisor.fetchImpl(`http://provider.test:${address.port}/v1/chat/completions`, { method: 'POST', body: '{}' });
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { host: `provider.test:${address.port}`, received: true });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

await Promise.all(pendingChecks);
console.log('AI provider config tests complete');
