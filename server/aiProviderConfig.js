import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { loadJson, writeJson } from './storeIO.js';
import { isNonPublicIpv4, isNonPublicIpv6 } from './ipAllowlist.js';

export const PROVIDER_PROTOCOLS = Object.freeze(['auto', 'chat', 'responses']);
export const PROVIDER_CONFIG_VERSION = 1;
const MAX_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 80;
const MAX_MODEL_LENGTH = 120;
const MAX_URL_LENGTH = 400;
const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_DECISION_BUDGET = 120;
const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576;
const PRIVATE_HOSTS = new Set(['localhost', 'metadata.google.internal']);

export class ProviderConfigError extends Error {
  constructor(message, code = 'INVALID_PROVIDER_CONFIG') {
    super(message);
    this.name = 'ProviderConfigError';
    this.code = code;
  }
}

function text(value, fallback = '', max = 200) {
  return String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function providerId(value, fallback = '') {
  const normalized = text(value, fallback, MAX_ID_LENGTH).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  if (!normalized) throw new ProviderConfigError('A provider profile id is required.', 'PROFILE_ID_REQUIRED');
  return normalized.slice(0, MAX_ID_LENGTH);
}

function slugFromLabel(label) {
  return providerId(label || 'provider').replace(/^-+|-+$/g, '').slice(0, MAX_ID_LENGTH) || 'provider';
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (PRIVATE_HOSTS.has(host) || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return isNonPublicIpv4(host);
  if (ipVersion === 6) return isNonPublicIpv6(host);
  return false;
}

async function validateProviderResolution(value, { resolveHost = dns.lookup, allowPrivateEndpoints = false } = {}) {
  const url = new URL(String(value));
  const hostname = providerHostname(url.hostname);
  if (!allowPrivateEndpoints && isPrivateHost(hostname)) {
    throw new ProviderConfigError('Private or link-local provider endpoints require explicit opt-in.', 'BASE_URL_PRIVATE_HOST');
  }
  if (net.isIP(hostname)) return { hostname, addresses: [hostname] };
  const records = await resolveHost(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || records.length === 0) throw new Error('Provider hostname did not resolve.');
  const addresses = records.map(record => providerResolvedAddress(record, allowPrivateEndpoints));
  return { hostname, addresses };
}

function providerHostname(hostname) {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
}

function providerResolvedAddress(record, allowPrivateEndpoints) {
  const address = typeof record === 'string' ? record : record?.address;
  const error = resolvedAddressError(address, record, allowPrivateEndpoints);
  if (error) throw error;
  return address;
}

function resolvedAddressError(address, record, allowPrivateEndpoints) {
  const family = net.isIP(address);
  if (!family) return invalidResolvedAddressError();
  if (declaredAddressFamilyMismatch(record, family)) return invalidResolvedAddressError();
  if (!allowPrivateEndpoints && isPrivateHost(address)) return invalidResolvedAddressError();
  return null;
}

function declaredAddressFamilyMismatch(record, family) {
  return Boolean(record?.family) && record.family !== family;
}

function invalidResolvedAddressError() {
  return new ProviderConfigError('Provider hostname resolves to a private or invalid address.', 'BASE_URL_PRIVATE_HOST');
}

function pinnedLookup(addresses) {
  const results = addresses.map(address => ({ address, family: net.isIP(address) }));
  return (_hostname, options, callback) => {
    const lookupOptions = typeof options === 'function' ? {} : options || {};
    const done = typeof options === 'function' ? options : callback;
    queueMicrotask(() => {
      if (lookupOptions.all) done(null, results);
      else done(null, results[0].address, results[0].family);
    });
  };
}

function pinnedProviderRequest(input, options = {}, destination) {
  const url = new URL(String(input));
  const transport = pinnedTransport(url);
  const setupError = pinnedRequestError(transport, options, destination);
  if (setupError) return Promise.reject(setupError);
  const headers = pinnedRequestHeaders(options.headers);

  return new Promise((resolve, reject) => {
    let request;
    const destroy = reason => request.destroy(reason);
    try {
      request = transport.request(url, {
        method: options.method || 'GET',
        headers,
        signal: options.signal,
        lookup: pinnedLookup(destination.addresses),
        maxHeaderSize: 16 * 1024,
      }, response => consumeProviderResponse(response, resolve, reject, destroy));
    } catch (error) {
      reject(error);
      return;
    }
    request.on('error', reject);
    if (options.body !== undefined && options.body !== null) request.write(options.body);
    request.end();
  });
}

function pinnedTransport(url) {
  if (url.protocol === 'https:') return https;
  if (url.protocol === 'http:') return http;
  return null;
}

function pinnedRequestError(transport, options, destination) {
  if (!transport) return new ProviderConfigError('Provider request destination is invalid.', 'BASE_URL_INVALID');
  if (!destination?.addresses?.length) return new ProviderConfigError('Provider request destination is invalid.', 'BASE_URL_INVALID');
  if (unsupportedRequestBody(options.body)) return new ProviderConfigError('Provider request body is unsupported.', 'REQUEST_BODY_INVALID');
  return null;
}

function unsupportedRequestBody(body) {
  if (typeof body === 'function') return true;
  if (!body) return false;
  if (typeof body === 'string') return false;
  if (Buffer.isBuffer(body)) return false;
  return !(body instanceof Uint8Array);
}

function pinnedRequestHeaders(headers) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return headers;
}

function consumeProviderResponse(response, resolve, reject, destroy) {
  const declaredSize = Number(response.headers['content-length']);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_PROVIDER_RESPONSE_BYTES) {
    destroy(new Error('Provider response exceeded the size limit.'));
    return;
  }
  const chunks = [];
  let receivedBytes = 0;
  response.on('data', chunk => {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_PROVIDER_RESPONSE_BYTES) {
      destroy(new Error('Provider response exceeded the size limit.'));
      return;
    }
    chunks.push(chunk);
  });
  response.on('aborted', () => destroy(new Error('Provider response ended prematurely.')));
  response.on('end', () => finishProviderResponse(response, chunks, resolve, reject));
}

function finishProviderResponse(response, chunks, resolve, reject) {
  try {
    const status = Number(response.statusCode);
    const body = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
    resolve(new Response(body, { status, headers: response.headers }));
  } catch (error) {
    reject(error);
  }
}

async function safePinnedProviderFetch(input, options, { resolveHost, allowPrivateEndpoints, requestImpl }) {
  const destination = await validateProviderResolution(input, { resolveHost, allowPrivateEndpoints });
  return requestImpl(input, { ...options, redirect: 'error' }, destination);
}

export function detectProtocolFromUrl(value) {
  try {
    const pathname = new URL(String(value || '')).pathname.toLowerCase().replace(/\/+$/, '');
    if (pathname.endsWith('/chat/completions')) return 'chat';
    if (pathname.endsWith('/responses')) return 'responses';
    return null;
  } catch {
    return null;
  }
}

export function normalizeProviderUrl(value, { production = false, allowPrivateEndpoints = !production } = {}) {
  const raw = text(value, '', MAX_URL_LENGTH);
  if (!raw) throw new ProviderConfigError('A provider base URL is required.', 'BASE_URL_REQUIRED');
  const url = parseProviderUrl(raw);
  assertProviderUrlShape(url, production);
  if (!allowPrivateEndpoints && isPrivateHost(url.hostname)) throw new ProviderConfigError('Private or link-local provider endpoints require explicit opt-in.', 'BASE_URL_PRIVATE_HOST');
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function parseProviderUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    throw new ProviderConfigError('Enter a valid HTTP or HTTPS provider URL.', 'BASE_URL_INVALID');
  }
}

function assertProviderUrlShape(url, production) {
  assertProviderUrlProtocol(url);
  assertProviderUrlCredentials(url);
  assertProviderUrlQuery(url);
  if (production && url.protocol !== 'https:') throw new ProviderConfigError('HTTPS is required for provider URLs in production.', 'BASE_URL_HTTPS_REQUIRED');
}

function assertProviderUrlProtocol(url) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new ProviderConfigError('Provider URL must use HTTP or HTTPS.', 'BASE_URL_PROTOCOL');
}

function assertProviderUrlCredentials(url) {
  if (url.username || url.password) throw new ProviderConfigError('Provider URL must not include embedded credentials.', 'BASE_URL_CREDENTIALS');
}

function assertProviderUrlQuery(url) {
  if (url.search || url.hash) throw new ProviderConfigError('Provider URL must not include a query string or fragment.', 'BASE_URL_QUERY');
}

export function deriveProviderEndpoint(baseUrl, protocol = 'chat') {
  const safeProtocol = protocol === 'responses' ? 'responses' : 'chat';
  const url = new URL(String(baseUrl));
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/chat/completions') || pathname.endsWith('/responses')) return url.toString();
  url.pathname = `${pathname || ''}/${safeProtocol === 'responses' ? 'responses' : 'chat/completions'}`.replace(/\/{2,}/g, '/');
  return url.toString();
}

function normalizeProtocol(value) {
  const normalized = text(value, 'auto', 16).toLowerCase().replace(/[_ -]+/g, '-');
  if (normalized === 'chat-completions' || normalized === 'chatcompletion') return 'chat';
  if (normalized === 'response' || normalized === 'response-api') return 'responses';
  return PROVIDER_PROTOCOLS.includes(normalized) ? normalized : 'auto';
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

export function normalizeProviderConfig(input = {}, options = {}) {
  const production = options.production ?? input.production === true;
  const allowPrivateEndpoints = options.allowPrivateEndpoints ?? (input.allowPrivateEndpoints === true || !production);
  const label = text(input.label || input.name, '', MAX_LABEL_LENGTH);
  if (!label) throw new ProviderConfigError('A provider profile name is required.', 'PROFILE_LABEL_REQUIRED');
  const id = providerId(input.id, slugFromLabel(label));
  const baseUrl = normalizeProviderUrl(input.baseUrl || input.endpoint, { production, allowPrivateEndpoints });
  const model = text(input.model, '', MAX_MODEL_LENGTH);
  if (!model) throw new ProviderConfigError('A model name is required.', 'MODEL_REQUIRED');
  return {
    id,
    label,
    baseUrl,
    allowPrivateEndpoints,
    model,
    protocol: normalizeProtocol(input.protocol),
    timeoutMs: boundedNumber(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000),
    maxDecisionsPerGame: boundedNumber(input.maxDecisionsPerGame, DEFAULT_DECISION_BUDGET, 1, 10_000),
    enabled: input.enabled !== false,
  };
}

function deriveCipherKey(masterKey) {
  const value = text(masterKey, '', 512);
  if (value.length < 32) return null;
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function encryptApiKey(apiKey, masterKey) {
  const value = text(apiKey, '', 2_000);
  if (!value) throw new ProviderConfigError('An API key is required.', 'API_KEY_REQUIRED');
  const key = deriveCipherKey(masterKey);
  if (!key) throw new ProviderConfigError('POORUP_AI_CONFIG_KEY is required before storing API keys.', 'CONFIG_KEY_REQUIRED');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptApiKey(payload, masterKey) {
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new ProviderConfigError('Stored provider key is invalid.', 'API_KEY_CIPHERTEXT_INVALID');
  const key = deriveCipherKey(masterKey);
  if (!key) throw new ProviderConfigError('POORUP_AI_CONFIG_KEY is required to decrypt provider keys.', 'CONFIG_KEY_REQUIRED');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new ProviderConfigError('Stored provider key could not be decrypted.', 'API_KEY_DECRYPT_FAILED');
  }
}

function safeTestResult(value) {
  if (!value || typeof value !== 'object') return null;
  const reason = ['auth', 'quota', 'timeout', 'network', 'invalid-response', 'unsupported', 'provider'].includes(value.reason) ? value.reason : null;
  return {
    ok: value.ok === true,
    protocol: PROVIDER_PROTOCOLS.includes(value.protocol) ? value.protocol : null,
    latencyMs: boundedNumber(value.latencyMs, 0, 0, 120_000),
    testedAt: typeof value.testedAt === 'string' ? value.testedAt.slice(0, 40) : null,
    reason,
  };
}

export function redactProviderConfig(config = {}) {
  const test = safeTestResult(config.lastTest);
  return {
    id: text(config.id, '', MAX_ID_LENGTH),
    label: text(config.label, '', MAX_LABEL_LENGTH),
    baseUrl: text(config.baseUrl, '', MAX_URL_LENGTH),
    model: text(config.model, '', MAX_MODEL_LENGTH),
    protocol: normalizeProtocol(config.protocol),
    detectedProtocol: PROVIDER_PROTOCOLS.includes(config.detectedProtocol) && config.detectedProtocol !== 'auto' ? config.detectedProtocol : null,
    timeoutMs: boundedNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000),
    maxDecisionsPerGame: boundedNumber(config.maxDecisionsPerGame, DEFAULT_DECISION_BUDGET, 1, 10_000),
    enabled: config.enabled !== false,
    keyConfigured: Boolean(config.apiKey || config.keyCipher || config.keyConfigured),
    lastTest: test,
    source: config.source === 'environment' ? 'environment' : 'profile',
    readOnly: config.readOnly === true,
    createdAt: typeof config.createdAt === 'string' ? config.createdAt.slice(0, 40) : null,
    updatedAt: typeof config.updatedAt === 'string' ? config.updatedAt.slice(0, 40) : null,
  };
}

function storedShape(value) {
  return Boolean(value && typeof value === 'object' && value.version === PROVIDER_CONFIG_VERSION && value.profiles && typeof value.profiles === 'object');
}

export function createAiProviderStore({ filePath = '', masterKey = '', production = false, allowPrivateEndpoints = !production } = {}) {
  let data = { version: PROVIDER_CONFIG_VERSION, activeId: null, profiles: {} };
  const cipherKey = deriveCipherKey(masterKey);
  const durable = Boolean(String(filePath || '').trim());

  function persist() {
    if (durable) {
      if (!cipherKey) throw new ProviderConfigError('POORUP_AI_CONFIG_KEY is required before storing provider profiles.', 'CONFIG_KEY_REQUIRED');
      writeJson(filePath, data);
    }
  }

  if (durable) {
    const loaded = loadJson(filePath, storedShape);
    if (loaded.value && storedShape(loaded.value)) data = loaded.value;
  }

  function internal(id) {
    const record = data.profiles[providerId(id)];
    if (!record) return null;
    const apiKey = record.keyCipher ? decryptApiKey(record.keyCipher, masterKey) : text(record.apiKey, '', 2_000);
    return { ...record, apiKey };
  }

  function list() {
    return Object.values(data.profiles).map(redactProviderConfig).sort((a, b) => a.label.localeCompare(b.label));
  }

  function upsert(input = {}) {
    const existing = input.id ? data.profiles[providerId(input.id)] : null;
    const normalized = normalizeProviderConfig({ ...existing, ...input }, { production, allowPrivateEndpoints });
    const apiKey = resolveUpsertApiKey(input, existing);
    const changed = profileConnectionChanged(existing, normalized);
    const record = buildProfileRecord(existing, normalized, apiKey, changed);
    data.profiles[normalized.id] = record;
    persist();
    return redactProviderConfig(record);
  }

  function resolveUpsertApiKey(input, existing) {
    const suppliedKey = text(input.apiKey, '', 2_000);
    const previous = existing ? internal(existing.id) : null;
    const apiKey = suppliedKey || previous?.apiKey || '';
    if (!apiKey) throw new ProviderConfigError('An API key is required for a provider profile.', 'API_KEY_REQUIRED');
    return apiKey;
  }

  function profileConnectionChanged(existing, normalized) {
    if (!existing) return true;
    if (existing.baseUrl !== normalized.baseUrl) return true;
    if (existing.model !== normalized.model) return true;
    return existing.protocol !== normalized.protocol;
  }

  function buildProfileRecord(existing, normalized, apiKey, changed) {
    const now = new Date().toISOString();
    const record = {
      ...normalized,
      keyCipher: durable ? encryptApiKey(apiKey, masterKey) : null,
      apiKey: durable ? undefined : apiKey,
      ...profileTestState(existing, changed),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (!durable) delete record.keyCipher;
    return record;
  }

  function profileTestState(existing, changed) {
    if (changed) return { detectedProtocol: null, lastTest: null };
    return {
      detectedProtocol: existing.detectedProtocol || null,
      lastTest: safeTestResult(existing.lastTest),
    };
  }

  function activate(id) {
    const record = data.profiles[providerId(id)];
    if (!record) throw new ProviderConfigError('Provider profile not found.', 'PROFILE_NOT_FOUND');
    if (record.lastTest?.ok !== true) throw new ProviderConfigError('Test the provider successfully before activating it.', 'PROFILE_NOT_TESTED');
    data.activeId = record.id;
    persist();
    return redactProviderConfig(record);
  }

  function markTest(id, result) {
    const record = data.profiles[providerId(id)];
    if (!record) throw new ProviderConfigError('Provider profile not found.', 'PROFILE_NOT_FOUND');
    const safe = safeTestResult({ ...result, testedAt: result?.testedAt || new Date().toISOString() });
    record.lastTest = safe;
    record.detectedProtocol = safe.ok ? safe.protocol : null;
    record.updatedAt = new Date().toISOString();
    persist();
    return redactProviderConfig(record);
  }

  function remove(id) {
    const safeId = providerId(id);
    if (safeId === data.activeId) throw new ProviderConfigError('Deactivate the active provider before deleting it.', 'ACTIVE_PROFILE');
    if (!data.profiles[safeId]) throw new ProviderConfigError('Provider profile not found.', 'PROFILE_NOT_FOUND');
    delete data.profiles[safeId];
    persist();
    return true;
  }

  return Object.freeze({
    activate,
    active: () => data.activeId ? internal(data.activeId) : null,
    activePublic: () => data.activeId ? redactProviderConfig(data.profiles[data.activeId]) : null,
    get: id => internal(id),
    list,
    markTest,
    remove,
    snapshot: () => ({ version: data.version, activeId: data.activeId, profiles: list(), persistent: durable, encrypted: durable && Boolean(cipherKey) }),
    upsert,
    get writable() { return !durable || Boolean(cipherKey); },
  });
}

function probeSystemPrompt() {
  return 'You are a connectivity probe. Return JSON only with exactly this shape: {"ok":true}. Do not mention secrets, tools, or game state.';
}

function probePayload(protocol, model) {
  if (protocol === 'responses') {
    return {
      model,
      store: false,
      max_output_tokens: 24,
      text: { format: { type: 'json_object' } },
      input: [
        { role: 'system', content: [{ type: 'input_text', text: probeSystemPrompt() }] },
        { role: 'user', content: [{ type: 'input_text', text: 'Return {"ok":true}.' }] },
      ],
    };
  }
  return {
    model,
    temperature: 0,
    max_tokens: 24,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: probeSystemPrompt() },
      { role: 'user', content: 'Return {"ok":true}.' },
    ],
  };
}

export function extractProviderText(payload, protocol = 'chat') {
  if (protocol === 'responses') return extractResponsesText(payload);
  return extractChatText(payload);
}

function extractResponsesText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return responsesTextParts(payload).join('\n');
}

function responsesTextParts(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output.flatMap(item => responseContentParts(item))
    .map(part => responsePartText(part))
    .filter(Boolean);
}

function responseContentParts(item) {
  if (Array.isArray(item?.content)) return item.content;
  return [];
}

function responsePartText(part) {
  if (typeof part?.text !== 'string') return '';
  return part.text;
}

function extractChatText(payload) {
  const content = chatMessageContent(payload);
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => responsePartText(part)).filter(Boolean).join('\n');
}

function chatMessageContent(payload) {
  return payload?.choices?.[0]?.message?.content;
}

function classifyProbeFailure(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || status === 429) return 'quota';
  if (status === 408 || status === 504) return 'timeout';
  return 'provider';
}

function probeProtocols(config) {
  if (config.protocol !== 'auto') return [config.protocol];
  const inferred = detectProtocolFromUrl(config.baseUrl);
  return inferred ? [inferred, inferred === 'chat' ? 'responses' : 'chat'] : ['chat', 'responses'];
}

export async function probeProvider(config, fetchImpl = globalThis.fetch, now = () => Date.now(), { resolveHost = dns.lookup, allowPrivateEndpoints = false, requestImpl } = {}) {
  const startedAt = now();
  if (!config?.apiKey) return { ok: false, protocol: null, reason: 'auth', latencyMs: 0, testedAt: new Date().toISOString() };
  if (typeof fetchImpl !== 'function' && typeof requestImpl !== 'function') return { ok: false, protocol: null, reason: 'network', latencyMs: 0, testedAt: new Date().toISOString() };
  for (const protocol of probeProtocols(config)) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), config.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const requestUrl = deriveProviderEndpoint(config.baseUrl, protocol);
      const requestOptions = {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        signal: controller?.signal,
        redirect: 'error',
        body: JSON.stringify(probePayload(protocol, config.model)),
      };
      const response = typeof requestImpl === 'function'
        ? await safePinnedProviderFetch(requestUrl, requestOptions, { resolveHost, allowPrivateEndpoints, requestImpl })
        : await (async () => {
          await validateProviderResolution(requestUrl, { resolveHost, allowPrivateEndpoints });
          return fetchImpl(requestUrl, requestOptions);
        })();
      if (!response?.ok) {
        const reason = classifyProbeFailure(response?.status);
        if (config.protocol === 'auto' && [404, 405].includes(Number(response?.status))) continue;
        return { ok: false, protocol: null, reason, latencyMs: Math.max(0, now() - startedAt), testedAt: new Date().toISOString() };
      }
      let payload;
      try { payload = await response.json(); } catch { return { ok: false, protocol: null, reason: 'invalid-response', latencyMs: Math.max(0, now() - startedAt), testedAt: new Date().toISOString() }; }
      const textValue = extractProviderText(payload, protocol).trim();
      try {
        const parsed = JSON.parse(textValue);
        if (parsed?.ok !== true) throw new Error('probe response shape');
      } catch {
        if (config.protocol === 'auto') continue;
        return { ok: false, protocol: null, reason: 'invalid-response', latencyMs: Math.max(0, now() - startedAt), testedAt: new Date().toISOString() };
      }
      return { ok: true, protocol, reason: null, latencyMs: Math.max(0, now() - startedAt), testedAt: new Date().toISOString() };
    } catch (error) {
      if (config.protocol === 'auto' && error?.name !== 'AbortError') continue;
      return { ok: false, protocol: null, reason: error?.name === 'AbortError' ? 'timeout' : 'network', latencyMs: Math.max(0, now() - startedAt), testedAt: new Date().toISOString() };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, protocol: null, reason: 'unsupported', latencyMs: Math.max(0, now() - startedAt), testedAt: new Date().toISOString() };
}

function envProviderApiKey(env) {
  return text(env.POORUP_AI_API_KEY || env.DEEPSEEK_API_KEY, '', 2_000);
}

function envProviderBaseUrl(env) {
  return text(env.POORUP_AI_BASE_URL || env.DEEPSEEK_API_URL || '', '', MAX_URL_LENGTH);
}

function environmentProviderInput(env, baseUrl, apiKey) {
  return {
    id: 'environment',
    label: 'Environment default',
    baseUrl,
    model: env.POORUP_AI_MODEL || env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    protocol: env.POORUP_AI_PROTOCOL || env.DEEPSEEK_API_FORMAT || 'auto',
    apiKey,
  };
}

function envProfile(env = process.env, production = false) {
  const apiKey = envProviderApiKey(env);
  const baseUrl = envProviderBaseUrl(env);
  if (!apiKey || !baseUrl) return null;
  try {
    return {
      ...normalizeProviderConfig(environmentProviderInput(env, baseUrl, apiKey), { production, allowPrivateEndpoints: !production || env.POORUP_AI_ALLOW_PRIVATE === 'true' }),
      apiKey,
      source: 'environment',
      readOnly: true,
    };
  } catch {
    return null;
  }
}

export function createAiProviderManager({ store, advisor, env = process.env, fetchImpl = globalThis.fetch, resolveHost = dns.lookup, requestImpl = pinnedProviderRequest } = {}) {
  const production = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  let activeAllowsPrivateEndpoints = false;
  const environmentProfile = envProfile(env, production);
  const advisorFetch = advisor?.fetchImpl;
  const safeAdvisorFetch = typeof advisorFetch === 'function'
    ? async (input, options = {}) => safePinnedProviderFetch(input, options, { resolveHost, allowPrivateEndpoints: activeAllowsPrivateEndpoints, requestImpl })
    : null;
  let activeSource = 'environment';

  function apply(config) {
    if (!config || typeof advisor?.configureProvider !== 'function') return false;
    activeAllowsPrivateEndpoints = !production && config.allowPrivateEndpoints === true;
    advisor.configureProvider({
      apiKey: config.apiKey,
      endpoint: config.baseUrl,
      model: config.model,
      protocol: config.detectedProtocol || config.protocol,
      timeoutMs: config.timeoutMs,
      maxDecisionsPerGame: config.maxDecisionsPerGame,
      providerName: config.label,
    });
    if (safeAdvisorFetch) advisor.fetchImpl = safeAdvisorFetch;
    return true;
  }

  function initialize() {
    let persisted;
    try { persisted = store?.active?.(); } catch { /* missing master key fails closed */ }
    if (persisted) {
      activeSource = 'profile';
      apply(persisted);
      return;
    }
    if (environmentProfile) apply(environmentProfile);
  }

  async function test(id) {
    const config = store?.get?.(id);
    if (!config) throw new ProviderConfigError('Provider profile not found.', 'PROFILE_NOT_FOUND');
    const result = await probeProvider(config, fetchImpl, () => Date.now(), {
      resolveHost,
      allowPrivateEndpoints: !production && config.allowPrivateEndpoints === true,
      requestImpl,
    });
    store.markTest(id, result);
    return result;
  }

  function activate(id) {
    const config = store.get(id);
    const result = store.activate(id);
    activeSource = 'profile';
    apply(config);
    return result;
  }

  function upsert(input) { return store.upsert(input); }
  function remove(id) { return store.remove(id); }
  function list() {
    const profiles = store?.list?.() || [];
    if (!store?.active?.() && environmentProfile) profiles.unshift(redactProviderConfig(environmentProfile));
    return profiles;
  }

  function activePublicStatus() {
    const publicActive = store?.activePublic?.();
    if (publicActive) return { ...publicActive, source: activeSource };
    if (environmentProfile) return redactProviderConfig(environmentProfile);
    return null;
  }

  initialize();
  return Object.freeze({
    activate,
    active: activePublicStatus,
    initialize,
    list,
    remove,
    status: () => ({
      active: activePublicStatus(),
      provider: typeof advisor?.getHealth === 'function' ? advisor.getHealth() : null,
      storage: store?.snapshot?.() || null,
    }),
    test,
    upsert,
  });
}
