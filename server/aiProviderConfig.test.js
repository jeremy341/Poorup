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
import { AiAdvisor } from './botAdvisor.js';

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

check('new provider profiles allow 240 AI decisions per bot in each game by default', () => {
  const profile = normalizeProviderConfig({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test' });
  assert.equal(profile.maxDecisionsPerGame, 240);
  assert.equal(normalizeProviderConfig({ id: 'legacy', label: 'Legacy', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', maxDecisionsPerGame: 120 }).maxDecisionsPerGame, 120,
    'an explicitly configured profile retains its chosen budget');
});

check('environment provider keeps configured caps and uses 240 as its default', () => {
  for (const [budgetEnv, expected] of [
    [{ POORUP_AI_DECISIONS: '120' }, 120],
    [{ POORUP_BOT_AI_DECISIONS: '75' }, 75],
    [{}, 240],
  ]) {
    let applied = null;
    const advisor = { fetchImpl: async () => {}, configureProvider: config => { applied = config; } };
    createAiProviderManager({
      store: { active: () => null },
      advisor,
      env: {
        NODE_ENV: 'production',
        POORUP_AI_API_KEY: 'environment-key',
        POORUP_AI_BASE_URL: 'https://provider.example/v1',
        ...budgetEnv,
      },
    });
    assert.equal(applied.maxDecisionsPerGame, expected);
  }
});

check('environment provider applies the configured timeout and bounded DeepSeek alias', () => {
  for (const [timeoutEnv, expected] of [
    [{ POORUP_AI_TIMEOUT_MS: '9000', DEEPSEEK_TIMEOUT_MS: '12000' }, 9000],
    [{ DEEPSEEK_TIMEOUT_MS: '12000' }, 12000],
    [{ POORUP_AI_TIMEOUT_MS: '500' }, 1000],
    [{ DEEPSEEK_TIMEOUT_MS: '80000' }, 60000],
    [{}, 4000],
  ]) {
    let applied = null;
    createAiProviderManager({
      store: { active: () => null },
      advisor: { fetchImpl: async () => {}, configureProvider: config => { applied = config; } },
      env: {
        NODE_ENV: 'production',
        POORUP_AI_API_KEY: 'environment-key',
        POORUP_AI_BASE_URL: 'https://provider.example/v1',
        ...timeoutEnv,
      },
    });
    assert.equal(applied.timeoutMs, expected);
  }
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

check('durable provider mutations restore memory when atomic replacement fails', () => {
  const createFixture = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-ai-provider-rollback-'));
    const filePath = path.join(directory, 'providers.json');
    const store = createAiProviderStore({ filePath, masterKey: 'test-master-key-0123456789012345' });
    store.upsert({ id: 'one', label: 'One', baseUrl: 'https://provider.example/v1', model: 'audit-one', apiKey: 'one-key', protocol: 'chat' });
    store.upsert({ id: 'two', label: 'Two', baseUrl: 'https://provider.example/v1', model: 'audit-two', apiKey: 'two-key', protocol: 'chat' });
    store.markTest('one', { ok: true, protocol: 'chat', latencyMs: 1 });
    store.markTest('two', { ok: true, protocol: 'chat', latencyMs: 1 });
    store.activate('one');
    const advisor = new AiAdvisor();
    const manager = createAiProviderManager({ store, advisor, env: {} });
    return {
      directory, filePath, store, advisor, manager,
      snapshotBefore: store.snapshot(),
      diskBefore: fs.readFileSync(filePath, 'utf8'),
    };
  };
  const failureCases = [
    ['activation', ({ manager }) => manager.activate('two')],
    ['active profile update', ({ manager }) => manager.upsert({ id: 'one', label: 'One edited' })],
    ['test result update', ({ store }) => store.markTest('two', { ok: false, reason: 'network' })],
    ['profile removal', ({ store }) => store.remove('two')],
    ['new profile insertion', ({ store }) => store.upsert({ id: 'three', label: 'Three', baseUrl: 'https://provider.example/v1', model: 'audit-three', apiKey: 'three-key' })],
  ];

  for (const [name, mutate] of failureCases) {
    const fixture = createFixture();
    const originalRename = fs.renameSync;
    const originalError = console.error;
    try {
      fs.renameSync = (from, to, ...rest) => {
        if (path.resolve(to) === fixture.filePath) {
          const error = new Error('injected atomic replacement failure');
          error.code = 'EIO';
          throw error;
        }
        return originalRename(from, to, ...rest);
      };
      console.error = (...args) => {
        if (/atomic rename failed/.test(String(args[0])) && String(args[0]).includes(path.basename(fixture.filePath))) return;
        originalError(...args);
      };

      assert.throws(() => mutate(fixture), /Atomic store write failed/, name);
      assert.equal(fixture.manager.active().id, 'one', name + ' leaves the public active profile unchanged');
      assert.equal(fixture.manager.active().label, 'One');
      assert.equal(fixture.advisor.model, 'audit-one', name + ' leaves the live advisor unchanged');
      assert.deepEqual(fixture.store.snapshot(), fixture.snapshotBefore, name + ' restores the complete public profile state');
      assert.equal(fixture.store.get('one').label, 'One');
      assert.equal(fixture.store.get('one').lastTest.ok, true);
      assert.equal(fixture.store.get('two').lastTest.ok, true);
      assert.equal(fixture.store.get('three'), null);
      assert.deepEqual(JSON.parse(fs.readFileSync(fixture.filePath, 'utf8')), JSON.parse(fixture.diskBefore), name + ' preserves the prior disk snapshot');
    } finally {
      fs.renameSync = originalRename;
      console.error = originalError;
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

check('a stored key never follows a profile to a different host', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-ai-key-host-'));
  const store = createAiProviderStore({ filePath: path.join(directory, 'providers.json'), masterKey: 'test-master-key-0123456789012345' });
  store.upsert({ id: 'p', label: 'P', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', apiKey: 'secret-key' });
  assert.throws(
    () => store.upsert({ id: 'p', label: 'P', baseUrl: 'https://api.deepseek.com/v1', model: 'gpt-test' }),
    error => error.code === 'API_KEY_REQUIRED'
  );
  assert.equal(store.upsert({ id: 'p', label: 'P2', model: 'gpt-test' }).label, 'P2', 'editing other fields keeps the stored key');
  assert.equal(store.upsert({ id: 'p', label: 'P', baseUrl: 'https://api.deepseek.com/v1', model: 'gpt-test', apiKey: 'new-key' }).keyConfigured, true);
  fs.rmSync(directory, { recursive: true, force: true });
});

check('stored provider profiles retain their explicitly configured decision caps', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-ai-budget-persistence-'));
  const filePath = path.join(directory, 'providers.json');
  const options = { filePath, masterKey: 'test-master-key-0123456789012345' };
  const first = createAiProviderStore(options);
  first.upsert({ id: 'legacy', label: 'Legacy', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', apiKey: 'legacy-key', maxDecisionsPerGame: 120 });
  first.upsert({ id: 'custom', label: 'Custom', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', apiKey: 'custom-key', maxDecisionsPerGame: 80 });

  const reloaded = createAiProviderStore(options);
  assert.equal(reloaded.get('legacy').maxDecisionsPerGame, 120, 'an explicitly saved 120-decision cap is retained');
  assert.equal(reloaded.get('custom').maxDecisionsPerGame, 80, 'non-default custom budgets are retained');
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(persisted.profiles.legacy.maxDecisionsPerGame, 120);
  assert.equal(persisted.profiles.custom.maxDecisionsPerGame, 80);
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

check('active provider requests stop promptly when DNS resolves after abort', async () => {
  const profile = {
    ...normalizeProviderConfig({ id: 'dns-abort', label: 'DNS Abort', baseUrl: 'https://provider.example/v1', model: 'model', protocol: 'chat' }),
    apiKey: 'key',
  };
  const outcomes = [];
  for (const lateResult of ['resolve', 'reject']) {
    const controller = new AbortController();
    const signal = controller.signal;
    let abortListeners = 0;
    const addEventListener = signal.addEventListener.bind(signal);
    const removeEventListener = signal.removeEventListener.bind(signal);
    signal.addEventListener = (type, listener, options) => {
      if (type === 'abort') abortListeners += 1;
      return addEventListener(type, listener, options);
    };
    signal.removeEventListener = (type, listener, options) => {
      if (type === 'abort') abortListeners -= 1;
      return removeEventListener(type, listener, options);
    };

    let markResolverStarted;
    const resolverStarted = new Promise(resolve => { markResolverStarted = resolve; });
    let resolveDns;
    let rejectDns;
    const calls = [];
    const advisor = { fetchImpl: async () => {}, configureProvider() {} };
    createAiProviderManager({
      store: { active: () => profile },
      advisor,
      env: { NODE_ENV: 'test' },
      resolveHost: async () => new Promise((resolve, reject) => {
        resolveDns = resolve;
        rejectDns = reject;
        markResolverStarted();
      }),
      requestImpl: async () => { calls.push(true); return { ok: true, status: 200 }; },
    });

    const pending = advisor.fetchImpl('https://provider.example/v1/chat/completions', { signal })
      .then(() => 'fulfilled', error => error?.name || 'error');
    await resolverStarted;
    controller.abort();
    const outcomeBeforeDnsRelease = await Promise.race([
      pending,
      new Promise(resolve => setTimeout(() => resolve('pending'), 100)),
    ]);
    if (lateResult === 'resolve') resolveDns([{ address: '8.8.8.8', family: 4 }]);
    else rejectDns(new Error('late resolver rejection'));
    const outcomeAfterDnsRelease = await pending;
    outcomes.push({ outcomeBeforeDnsRelease, outcomeAfterDnsRelease, requestCalls: calls.length, abortListeners });
  }
  assert.deepEqual(outcomes, [
    { outcomeBeforeDnsRelease: 'AbortError', outcomeAfterDnsRelease: 'AbortError', requestCalls: 0, abortListeners: 0 },
    { outcomeBeforeDnsRelease: 'AbortError', outcomeAfterDnsRelease: 'AbortError', requestCalls: 0, abortListeners: 0 },
  ]);
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

check('a provider that drops the connection mid-body rejects instead of leaving the request pending', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"choices":[');
    setTimeout(() => request.socket.destroy(), 50);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const profile = {
      ...normalizeProviderConfig({ id: 'drop', label: 'Drop', baseUrl: `http://provider.test:${address.port}/v1`, model: 'model', allowPrivateEndpoints: true }),
      apiKey: 'key',
    };
    const advisor = { fetchImpl: async () => { throw new Error('un-pinned fetch must not be used'); }, configureProvider() {} };
    createAiProviderManager({ store: { active: () => profile }, advisor, env: { NODE_ENV: 'test' }, resolveHost: async () => [{ address: '127.0.0.1', family: 4 }] });
    let timer;
    const outcome = await Promise.race([
      advisor.fetchImpl(`http://provider.test:${address.port}/v1/chat/completions`, { method: 'POST', body: '{}' }).then(() => 'resolved', () => 'rejected'),
      new Promise(resolve => { timer = setTimeout(() => resolve('pending'), 3000); }),
    ]);
    clearTimeout(timer);
    assert.equal(outcome, 'rejected', 'a dropped body settles the request (it stayed pending before)');

    // An abort signal also settles a response whose body never ends.
    const hanging = http.createServer((request, response) => { response.writeHead(200); response.write('{'); });
    await new Promise(resolve => hanging.listen(0, '127.0.0.1', resolve));
    try {
      const hangingPort = hanging.address().port;
      const hangingProfile = { ...normalizeProviderConfig({ id: 'hang', label: 'Hang', baseUrl: `http://provider.test:${hangingPort}/v1`, model: 'model', allowPrivateEndpoints: true }), apiKey: 'key' };
      const hangingAdvisor = { fetchImpl: async () => { throw new Error('un-pinned fetch must not be used'); }, configureProvider() {} };
      createAiProviderManager({ store: { active: () => hangingProfile }, advisor: hangingAdvisor, env: { NODE_ENV: 'test' }, resolveHost: async () => [{ address: '127.0.0.1', family: 4 }] });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      let timer2;
      const aborted = await Promise.race([
        hangingAdvisor.fetchImpl(`http://provider.test:${hangingPort}/v1/chat/completions`, { method: 'POST', body: '{}', signal: controller.signal }).then(() => 'resolved', error => (error?.name === 'AbortError' ? 'aborted' : `rejected:${error?.name}`)),
        new Promise(resolve => { timer2 = setTimeout(() => resolve('pending'), 3000); }),
      ]);
      clearTimeout(timer2);
      assert.equal(aborted, 'aborted', 'the abort signal settles a body that never ends');
    } finally {
      hanging.closeAllConnections?.();
      await new Promise(resolve => hanging.close(resolve));
    }
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

check('creating a profile with an existing name is refused instead of replacing the live one', () => {
  const store = createAiProviderStore({});
  const first = store.upsert({ label: 'DeepSeek', baseUrl: 'https://api.deepseek.test/v1', model: 'model-a', apiKey: 'key-a', protocol: 'chat' });
  assert.throws(
    () => store.upsert({ label: 'DeepSeek', baseUrl: 'https://attacker.test/v1', model: 'model-b', apiKey: 'key-b', protocol: 'chat' }),
    error => error.code === 'PROFILE_EXISTS',
  );
  assert.equal(store.get(first.id).baseUrl, 'https://api.deepseek.test/v1', 'the original connection is untouched');
  assert.equal(store.get(first.id).model, 'model-a');
  // Editing by id is still the way to change a profile.
  const edited = store.upsert({ id: first.id, model: 'model-c' });
  assert.equal(edited.model, 'model-c');
});

check('inherited object keys are not provider profiles', () => {
  const store = createAiProviderStore({});
  for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(store.get(id), null, `${id} is not a stored profile`);
    assert.throws(() => store.markTest(id, { ok: false }), error => error.code === 'PROFILE_NOT_FOUND');
    assert.throws(() => store.remove(id), error => error.code === 'PROFILE_NOT_FOUND');
    assert.throws(() => store.activate(id), error => error.code === 'PROFILE_NOT_FOUND');
  }
  assert.equal(Object.hasOwn(Object, 'lastTest'), false, 'no profile data lands on the global Object');
});

check('a probe that finishes after a profile edit cannot mark the new profile as tested', async () => {
  const store = createAiProviderStore({});
  store.upsert({ id: 'probe-race', label: 'Probe race', baseUrl: 'https://provider.test/v1', model: 'old-model', apiKey: 'secret-key', protocol: 'chat' });
  let releaseProbe = null;
  const manager = createAiProviderManager({
    store,
    advisor: { fetchImpl: async () => {}, configureProvider() {} },
    env: { NODE_ENV: 'test' },
    requestImpl: async () => new Promise(resolve => { releaseProbe = resolve; }),
    resolveHost: async () => [{ address: '8.8.8.8', family: 4 }],
  });
  const pending = manager.test('probe-race');
  while (!releaseProbe) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 5));
  store.upsert({ id: 'probe-race', model: 'edited-model' });
  releaseProbe({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  const result = await pending;
  assert.equal(result.ok, false, 'a probe that was not stored is not reported as a success');
  assert.equal(result.stale, true);
  const profile = store.list().find(entry => entry.id === 'probe-race');
  assert.equal(profile.model, 'edited-model');
  assert.equal(profile.lastTest, null, 'the stale probe result did not mark the edited profile');
  assert.equal(profile.detectedProtocol, null);
});

check('a provider edit that does not touch the connection keeps the health of the running provider', async () => {
  const store = createAiProviderStore({});
  store.upsert({ id: 'health', label: 'Health', baseUrl: 'https://provider.test/v1', model: 'model-a', apiKey: 'secret-key', protocol: 'chat' });
  store.markTest('health', { ok: true, protocol: 'chat', latencyMs: 1 });
  store.activate('health');
  const advisor = new AiAdvisor({ apiKey: '', fetchImpl: async () => ({}) });
  const passing = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  const manager = createAiProviderManager({ store, advisor, env: { NODE_ENV: 'test' }, fetchImpl: passing, requestImpl: passing, resolveHost: async () => [{ address: '8.8.8.8', family: 4 }] });
  advisor.registerFailure('quota');
  assert.equal(advisor.getPublicStatus().state, 'quota-exhausted');
  manager.upsert({ id: 'health', label: 'Renamed' });
  assert.equal(advisor.getPublicStatus().state, 'quota-exhausted', 'a rename does not clear an exhausted quota');
  assert.equal(advisor.getHealth().provider, 'Renamed', 'the new label still reaches the advisor');
  // A rotated key on the active profile is a connection change: it is tested first, then applied.
  assert.equal((await manager.update({ id: 'health', label: 'Renamed', apiKey: 'rotated-key' })).test.ok, true);
  assert.equal(advisor.getPublicStatus().state, 'healthy', 'a rotated key is a new connection and clears the old state');
});

await Promise.all(pendingChecks);
console.log('AI provider config tests complete');
