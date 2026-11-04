import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadJson, writeJson } from './storeIO.js';

export const SESSION_COOKIE_NAME = 'poorup_session';
export const DEFAULT_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOUCH_PERSIST_INTERVAL_MS = 5 * 60 * 1000;
// Expired records are otherwise kept until someone presents their cookie, so
// they accumulate and every issue rewrites them to disk.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function rawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function finiteTimestamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cleanClass(value, fallback = 'unknown') {
  const text = typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f]/gu, '').slice(0, 40) : '';
  return text || fallback;
}

function cleanRecord(value) {
  if (!value || typeof value !== 'object' || typeof value.tokenHash !== 'string' || typeof value.accountId !== 'string') return null;
  const createdAt = finiteTimestamp(value.createdAt);
  const lastSeenAt = finiteTimestamp(value.lastSeenAt, createdAt);
  const expiresAt = finiteTimestamp(value.expiresAt);
  const absoluteExpiresAt = finiteTimestamp(value.absoluteExpiresAt);
  if (!createdAt || !expiresAt || !absoluteExpiresAt) return null;
  return {
    sessionId: cleanClass(value.sessionId, value.tokenHash.slice(0, 16)),
    tokenHash: value.tokenHash.slice(0, 128),
    ...(typeof value.legacyTokenHash === 'string' && /^[a-f0-9]{64}$/i.test(value.legacyTokenHash)
      ? { legacyTokenHash: value.legacyTokenHash.toLowerCase() }
      : {}),
    accountId: value.accountId.slice(0, 160),
    createdAt,
    lastSeenAt,
    expiresAt,
    absoluteExpiresAt,
    userAgentClass: cleanClass(value.userAgentClass),
    ipClass: cleanClass(value.ipClass)
  };
}

export function parseCookieHeader(header = '') {
  const result = {};
  if (typeof header !== 'string') return result;
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 1) return;
    const name = part.slice(0, index).trim();
    if (!name || Object.prototype.hasOwnProperty.call(result, name)) return;
    const value = part.slice(index + 1).trim();
    try { result[name] = decodeURIComponent(value); } catch { result[name] = value; }
  });
  return result;
}

function serializeCookie(name, value, options = {}) {
  const pieces = [`${name}=${encodeURIComponent(value)}`];
  pieces.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) pieces.push(`Max-Age=${Math.max(0, Math.floor(Number(options.maxAge) || 0))}`);
  if (options.httpOnly !== false) pieces.push('HttpOnly');
  if (options.secure !== false) pieces.push('Secure');
  pieces.push(`SameSite=${options.sameSite || 'Lax'}`);
  return pieces.join('; ');
}

function safeSnapshot(record) {
  if (!record) return null;
  const safe = { ...record };
  delete safe.tokenHash;
  delete safe.legacyTokenHash;
  return safe;
}

export function createSessionStore({
  filePath = '',
  now = Date.now,
  idleTtlMs = DEFAULT_IDLE_TTL_MS,
  absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS,
  persist: persistOverride = null,
  cookieName = SESSION_COOKIE_NAME,
  secure = true,
  sweepIntervalMs = SWEEP_INTERVAL_MS
} = {}) {
  const records = new Map();
  const byHash = new Map();
  const idleTtl = Math.max(60_000, Number(idleTtlMs) || DEFAULT_IDLE_TTL_MS);
  const absoluteTtl = Math.max(idleTtl, Number(absoluteTtlMs) || DEFAULT_ABSOLUTE_TTL_MS);
  let sweepTimer = null;

  function persist() {
    const value = [...records.values()].map(record => ({ ...record }));
    if (typeof persistOverride === 'function') return persistOverride(value);
    if (!filePath) return;
    writeJson(filePath, value);
  }

  function load() {
    if (!filePath || !fs.existsSync(filePath)) return;
    const { value } = loadJson(filePath, loaded => Array.isArray(loaded));
    (value || []).map(cleanRecord).filter(Boolean).forEach((record) => {
      records.set(record.sessionId, record);
      byHash.set(record.tokenHash, record.sessionId);
    });
    // A session that expired while the server was down is dropped at once. A
    // failed write is retried by the next write; memory is already swept.
    if (removeExpired(Number(now()) || Date.now())) {
      try { persist(); } catch { /* best effort, see above */ }
    }
  }

  function remove(record) {
    if (!record) return false;
    records.delete(record.sessionId);
    byHash.delete(record.tokenHash);
    return true;
  }

  // A revocation must never be visible in memory only: a failed write leaves
  // the session on disk, so it comes back after a restart. Both maps are
  // captured before the change and restored when the write fails.
  function captureState() {
    return { records: new Map(records), byHash: new Map(byHash) };
  }

  function restoreState(state) {
    if (!state) return;
    records.clear();
    byHash.clear();
    state.records.forEach((record, sessionId) => records.set(sessionId, record));
    state.byHash.forEach((sessionId, hash) => byHash.set(hash, sessionId));
  }

  function persistOrRestore(state) {
    try {
      persist();
    } catch (error) {
      restoreState(state);
      throw error;
    }
  }

  function removeExpired(timestamp) {
    let removed = 0;
    for (const record of [...records.values()]) {
      if (record.expiresAt > timestamp && record.absoluteExpiresAt > timestamp) continue;
      remove(record);
      removed += 1;
    }
    return removed;
  }

  function sweepExpired() {
    const removed = removeExpired(Number(now()) || Date.now());
    if (removed) persist();
    return removed;
  }

  function resolveRecord(value, touch = true) {
    if (typeof value !== 'string' || !value) return null;
    const hash = tokenHash(value);
    const sessionId = byHash.get(hash);
    const record = sessionId ? records.get(sessionId) : null;
    if (!record) return null;
    const timestamp = Number(now()) || Date.now();
    if (record.expiresAt <= timestamp || record.absoluteExpiresAt <= timestamp) {
      remove(record);
      persistBestEffort();
      return null;
    }
    if (touch) {
      const previousExpiry = record.expiresAt;
      record.lastSeenAt = timestamp;
      record.expiresAt = Math.min(record.createdAt + absoluteTtl, timestamp + idleTtl);
      if (record.expiresAt - previousExpiry >= TOUCH_PERSIST_INTERVAL_MS) persistBestEffort();
    }
    return record;
  }

  // resolve() is a read, called from the socket handshake. Memory is
  // authoritative and the next write retries, so a failed write here must not
  // escape and end the process.
  function persistBestEffort() {
    try { persist(); } catch (error) { console.error('Session persist failed:', error?.message); }
  }

  function issue(accountId, metadata = {}) {
    if (typeof accountId !== 'string' || !accountId.trim()) throw new TypeError('accountId is required.');
    const timestamp = Number(now()) || Date.now();
    const token = rawToken();
    const hash = tokenHash(token);
    const record = {
      sessionId: `sess_${crypto.randomUUID()}`,
      tokenHash: hash,
      ...(typeof metadata.legacyTokenHash === 'string' && /^[a-f0-9]{64}$/i.test(metadata.legacyTokenHash)
        ? { legacyTokenHash: metadata.legacyTokenHash.toLowerCase() }
        : {}),
      accountId: accountId.trim().slice(0, 160),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: Math.min(timestamp + absoluteTtl, timestamp + idleTtl),
      absoluteExpiresAt: timestamp + absoluteTtl,
      userAgentClass: cleanClass(metadata.userAgentClass),
      ipClass: cleanClass(metadata.ipClass)
    };
    const before = captureState();
    records.set(record.sessionId, record);
    byHash.set(hash, record.sessionId);
    persistOrRestore(before);
    return { sessionId: record.sessionId, cookieValue: token, expiresAt: record.expiresAt, absoluteExpiresAt: record.absoluteExpiresAt };
  }

  function resolve(value) {
    const record = resolveRecord(value, true);
    return safeSnapshot(record);
  }

  function touch(value) {
    const record = resolveRecord(value, true);
    return safeSnapshot(record);
  }

  function revoke(value) {
    const record = records.get(value) || resolveRecord(value, false);
    if (!record) return false;
    const before = captureState();
    const changed = remove(record);
    if (!changed) return false;
    persistOrRestore(before);
    return true;
  }

  function revokeOthers(value) {
    const current = records.get(value) || resolveRecord(value, false);
    if (!current) return 0;
    const before = captureState();
    let removed = 0;
    for (const record of [...records.values()]) {
      if (record.accountId !== current.accountId || record.sessionId === current.sessionId) continue;
      remove(record);
      removed += 1;
    }
    if (!removed) return 0;
    persistOrRestore(before);
    return removed;
  }

  // Every cookie session of the account except the caller's own. A caller
  // without a cookie session (bearer-only socket) passes null and keeps none.
  function revokeAccountSessionsExcept(accountId, keepSessionId = null) {
    if (typeof accountId !== 'string' || !accountId) return 0;
    const before = captureState();
    let removed = 0;
    for (const record of [...records.values()]) {
      if (record.accountId !== accountId || record.sessionId === keepSessionId) continue;
      remove(record);
      removed += 1;
    }
    if (!removed) return 0;
    persistOrRestore(before);
    return removed;
  }

  function revokeAllForAccount(accountId) {
    if (typeof accountId !== 'string' || !accountId) return 0;
    const before = captureState();
    let removed = 0;
    for (const record of [...records.values()]) {
      if (record.accountId !== accountId) continue;
      remove(record);
      removed += 1;
    }
    if (!removed) return 0;
    persistOrRestore(before);
    return removed;
  }

  // A legacy token may already have been consumed when logout arrives. Keep
  // only its hash on exchanged sessions, so logout can revoke those
  // sessions without signing out every device on the account.
  function revokeLegacyTokenSessions(legacyToken) {
    if (typeof legacyToken !== 'string' || !legacyToken) return 0;
    const legacyHash = tokenHash(legacyToken);
    const before = captureState();
    let removed = 0;
    for (const record of [...records.values()]) {
      if (record.legacyTokenHash !== legacyHash) continue;
      remove(record);
      removed += 1;
    }
    if (!removed) return 0;
    persistOrRestore(before);
    return removed;
  }

  function exchangeLegacy(legacyToken, resolver) {
    if (typeof resolver !== 'function' || typeof legacyToken !== 'string' || !legacyToken) return null;
    const accountId = resolver(legacyToken);
    if (typeof accountId !== 'string' || !accountId) return null;
    return issue(accountId, { userAgentClass: 'legacy-exchange', legacyTokenHash: tokenHash(legacyToken) });
  }

  function cookie(value, options = {}) {
    const record = resolveRecord(value, false);
    const maxAge = record ? Math.max(0, Math.ceil((record.expiresAt - (Number(now()) || Date.now())) / 1000)) : 0;
    return serializeCookie(cookieName, record ? value : '', { ...options, maxAge, secure });
  }

  function clearCookie(options = {}) {
    return serializeCookie(cookieName, '', { ...options, maxAge: 0, secure });
  }

  // Is this session id still a live session of the account? A read that never
  // touches the record, so a socket can be re-checked on every private push.
  function hasSession(sessionId, accountId) {
    const record = typeof sessionId === 'string' ? records.get(sessionId) : null;
    if (!record) return false;
    if (accountId && record.accountId !== accountId) return false;
    const timestamp = Number(now()) || Date.now();
    return record.expiresAt > timestamp && record.absoluteExpiresAt > timestamp;
  }

  function snapshot() {
    return [...records.values()].map(safeSnapshot);
  }

  load();
  sweepTimer = setInterval(() => {
    try { sweepExpired(); } catch (error) { console.error('Session sweep failed:', error?.message || 'unknown error'); }
  }, Math.max(1000, Number(sweepIntervalMs) || SWEEP_INTERVAL_MS));
  // The sweep must not keep the process alive on its own.
  sweepTimer.unref?.();
  return {
    issue, resolve, touch, revoke, revokeOthers, revokeAccountSessionsExcept, revokeAllForAccount, revokeLegacyTokenSessions, exchangeLegacy, cookie, clearCookie, snapshot, hasSession,
    sweepExpired,
    close() { clearInterval(sweepTimer); sweepTimer = null; },
    size: () => records.size
  };
}

export { tokenHash };
