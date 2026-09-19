import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadJson, writeJson } from './storeIO.js';

export const SESSION_COOKIE_NAME = 'poorup_session';
export const DEFAULT_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOUCH_PERSIST_INTERVAL_MS = 5 * 60 * 1000;

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
  const { tokenHash: _tokenHash, ...safe } = record;
  return { ...safe };
}

export function createSessionStore({
  filePath = '',
  now = Date.now,
  idleTtlMs = DEFAULT_IDLE_TTL_MS,
  absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS,
  persist: persistOverride = null,
  cookieName = SESSION_COOKIE_NAME,
  secure = true
} = {}) {
  const records = new Map();
  const byHash = new Map();
  const idleTtl = Math.max(60_000, Number(idleTtlMs) || DEFAULT_IDLE_TTL_MS);
  const absoluteTtl = Math.max(idleTtl, Number(absoluteTtlMs) || DEFAULT_ABSOLUTE_TTL_MS);

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
  }

  function remove(record) {
    if (!record) return false;
    records.delete(record.sessionId);
    byHash.delete(record.tokenHash);
    return true;
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
      persist();
      return null;
    }
    if (touch) {
      const previousExpiry = record.expiresAt;
      record.lastSeenAt = timestamp;
      record.expiresAt = Math.min(record.createdAt + absoluteTtl, timestamp + idleTtl);
      if (record.expiresAt - previousExpiry >= TOUCH_PERSIST_INTERVAL_MS) persist();
    }
    return record;
  }

  function issue(accountId, metadata = {}) {
    if (typeof accountId !== 'string' || !accountId.trim()) throw new TypeError('accountId is required.');
    const timestamp = Number(now()) || Date.now();
    const token = rawToken();
    const hash = tokenHash(token);
    const record = {
      sessionId: `sess_${crypto.randomUUID()}`,
      tokenHash: hash,
      accountId: accountId.trim().slice(0, 160),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: Math.min(timestamp + absoluteTtl, timestamp + idleTtl),
      absoluteExpiresAt: timestamp + absoluteTtl,
      userAgentClass: cleanClass(metadata.userAgentClass),
      ipClass: cleanClass(metadata.ipClass)
    };
    records.set(record.sessionId, record);
    byHash.set(hash, record.sessionId);
    persist();
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
    const changed = remove(record);
    if (changed) persist();
    return changed;
  }

  function revokeOthers(value) {
    const current = records.get(value) || resolveRecord(value, false);
    if (!current) return 0;
    let removed = 0;
    for (const record of [...records.values()]) {
      if (record.accountId !== current.accountId || record.sessionId === current.sessionId) continue;
      remove(record);
      removed += 1;
    }
    if (removed) persist();
    return removed;
  }

  function revokeAllForAccount(accountId) {
    if (typeof accountId !== 'string' || !accountId) return 0;
    let removed = 0;
    for (const record of [...records.values()]) {
      if (record.accountId !== accountId) continue;
      remove(record);
      removed += 1;
    }
    if (removed) persist();
    return removed;
  }

  function exchangeLegacy(legacyToken, resolver) {
    if (typeof resolver !== 'function' || typeof legacyToken !== 'string' || !legacyToken) return null;
    const accountId = resolver(legacyToken);
    if (typeof accountId !== 'string' || !accountId) return null;
    return issue(accountId, { userAgentClass: 'legacy-exchange' });
  }

  function cookie(value, options = {}) {
    const record = resolveRecord(value, false);
    const maxAge = record ? Math.max(0, Math.ceil((record.expiresAt - (Number(now()) || Date.now())) / 1000)) : 0;
    return serializeCookie(cookieName, record ? value : '', { ...options, maxAge, secure });
  }

  function clearCookie(options = {}) {
    return serializeCookie(cookieName, '', { ...options, maxAge: 0, secure });
  }

  function snapshot() {
    return [...records.values()].map(safeSnapshot);
  }

  load();
  return { issue, resolve, touch, revoke, revokeOthers, revokeAllForAccount, exchangeLegacy, cookie, clearCookie, snapshot, close() {}, size: () => records.size };
}

export { tokenHash };
