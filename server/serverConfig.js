import crypto from 'node:crypto';
import net from 'node:net';
import { rateLimitAddressKey } from './ipAllowlist.js';

// Deployment-only server configuration. Runtime defaults stay permissive for
// local play, while a hosted instance can restrict browser origins explicitly.

// Operator tokens (maintenance, retention) are compared in constant time. Both
// sides are digested first so the comparison length does not depend on input.
export function tokensMatch(provided, expected) {
  if (typeof expected !== 'string' || !expected) return false;
  if (typeof provided !== 'string' || !provided) return false;
  const digest = value => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

let retentionFallbackWarned = false;

// The retention job has its own token. Falling back to the maintenance token
// lets one leaked secret run both operations, so the fallback warns once.
export function resolveRetentionToken(env = process.env, warn = console.warn) {
  const dedicated = String(env?.POORUP_RETENTION_TOKEN || '').trim();
  if (dedicated) return dedicated;
  const fallback = String(env?.POORUP_MAINTENANCE_TOKEN || '').trim();
  if (fallback && !retentionFallbackWarned) {
    retentionFallbackWarned = true;
    warn('POORUP_RETENTION_TOKEN is unset; POORUP_MAINTENANCE_TOKEN also authorizes retention runs. Set a dedicated retention token.');
  }
  return fallback;
}

export function parseAllowedOrigins(env = process.env) {
  return String(env?.POORUP_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .map(normalizeOrigin)
    .filter(Boolean);
}

function normalizeOrigin(value) {
  if (value === '*') return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function hasMalformedOriginList(env = process.env) {
  const raw = String(env?.POORUP_ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
  return raw.some(origin => !normalizeOrigin(origin));
}

export function isOriginAllowed(origin, configuredOrigins = []) {
  if (!origin) return true;
  if (!configuredOrigins.length) return true;
  return configuredOrigins.includes('*') || configuredOrigins.includes(origin);
}

// Socket.IO's allowRequest applies the same exact-origin policy to every transport, including direct WebSocket upgrades.
// Wildcards are excluded from this admission seam.
export function isAllowedSocketOrigin(origin, allowedOrigins = []) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized || !Array.isArray(allowedOrigins) || !allowedOrigins.length) return false;
  return allowedOrigins.filter(candidate => candidate !== '*').includes(normalized);
}

// Trusted proxies. POORUP_TRUST_PROXY_HOPS=N trusts the last N entries of X-Forwarded-For (the same rule Express uses for req.ip).
// POORUP_TRUSTED_PROXY_ADDRESSES lists the proxy peers themselves; forwarding headers are honoured only when the socket peer is on that
// list. Use the list whenever the app port can be reached without the proxy: a direct client could otherwise choose any bucket it likes.
export function readTrustedProxy(env = process.env) {
  const hops = Math.max(0, Math.floor(Number(env?.POORUP_TRUST_PROXY_HOPS) || 0));
  const addresses = [...new Set(String(env?.POORUP_TRUSTED_PROXY_ADDRESSES || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(rateLimitAddressKey))];
  return { hops, addresses, enabled: hops > 0 || addresses.length > 0 };
}

// Fails at boot rather than silently trusting nothing: a CIDR or a typo in the list would otherwise disable the proxy address check.
export function assertTrustedProxyConfig(env = process.env) {
  const entries = String(env?.POORUP_TRUSTED_PROXY_ADDRESSES || '').split(',').map(value => value.trim()).filter(Boolean);
  const invalid = entries.find(entry => !net.isIP(entry.replace(/^\[|\]$/g, '').split('%')[0]));
  if (invalid) throw new Error(`POORUP_TRUSTED_PROXY_ADDRESSES must list plain IP addresses; "${invalid.slice(0, 60)}" is not one.`);
  return true;
}

// The value for Express's `trust proxy` setting, so req.ip and the socket resolver agree on one client address.
export function expressTrustProxy(proxy = readTrustedProxy({})) {
  if (!proxy.addresses.length) return proxy.hops;
  const trusted = new Set(proxy.addresses);
  return address => trusted.has(rateLimitAddressKey(String(address ?? '')));
}

// Resolve a socket peer only through an explicitly trusted proxy. Otherwise attacker-controlled forwarding headers could mint fresh limiter
// identities on every reconnect. The result is the limiter key: an IPv6 /64 is one peer (see rateLimitAddressKey). The second argument is
// either a hop count (legacy) or the object readTrustedProxy returns.
export function resolveClientAddress(handshake = {}, proxy = 0) {
  return rateLimitAddressKey(resolveRawClientAddress(handshake, proxy));
}

// A handshake middleware must never throw: socket.io runs it from an async
// path nobody catches, so a failed session-file write would surface as an
// unhandledRejection and exit the process. Deny cleanly instead (anonymous).
export function resolveHandshakeSession(resolve, cookieValue) {
  try {
    return resolve(cookieValue) || null;
  } catch (error) {
    console.error('Socket session resolution failed:', error?.message || 'unknown error');
    return null;
  }
}

function resolveRawClientAddress(handshake, proxy) {
  const direct = String(handshake.address || handshake.request?.socket?.remoteAddress || handshake.socket?.remoteAddress || 'unknown').trim();
  const config = typeof proxy === 'object' && proxy !== null
    ? { hops: proxy.hops, addresses: proxy.addresses || [] }
    : { hops: proxy, addresses: [] };
  const hops = Math.max(0, Math.floor(Number(config.hops) || 0));
  if (!hops && !config.addresses.length) return direct.slice(0, 80);
  const forwarded = handshake.headers?.['x-forwarded-for']
    || handshake.request?.headers?.['x-forwarded-for']
    || handshake.request?.headers?.['X-Forwarded-For'];
  const chain = String(forwarded || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!chain.length) return direct.slice(0, 80);
  if (config.addresses.length) return forwardedClientFromTrustedPeers(direct, chain, new Set(config.addresses));
  // Match Express/proxy-addr: with N trusted hops the client is the Nth entry
  // from the right (the one the nearest trusted proxy appended).
  const index = Math.max(0, chain.length - hops);
  return String(chain[index] || direct).slice(0, 80);
}

// Walks from the socket peer back through the forwarded chain while each hop is a listed proxy. The first entry that is not a listed
// proxy is the client. A direct peer that is not listed is the client itself, whatever its headers say.
function forwardedClientFromTrustedPeers(direct, chain, trusted) {
  let current = direct;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!trusted.has(rateLimitAddressKey(current))) break;
    current = chain[index];
  }
  return String(current).slice(0, 80);
}

// Every abuse budget the server enforces, with its env prefix and code default. A budget is overridable with <PREFIX>_LIMIT and
// <PREFIX>_WINDOW_MS. A blank value means the default, and an explicit 0 disables that one budget (use it only for a known trusted load test).
export const ABUSE_BUDGET_SPEC = Object.freeze({
  authAttempt: { env: 'POORUP_AUTH_ATTEMPT', limit: 8, windowMs: 60_000 },
  usernameCheck: { env: 'POORUP_USERNAME_CHECK', limit: 30, windowMs: 60_000 },
  joinFailure: { env: 'POORUP_JOIN_FAILURE', limit: 30, windowMs: 600_000 },
  roomCreate: { env: 'POORUP_ROOM_CREATE', limit: 60, windowMs: 60_000 },
  accountWrite: { env: 'POORUP_ACCOUNT_WRITE', limit: 60, windowMs: 60_000 },
  accountExport: { env: 'POORUP_ACCOUNT_EXPORT', limit: 5, windowMs: 600_000 },
  recoveryRequest: { env: 'POORUP_RECOVERY_REQUEST', limit: 5, windowMs: 900_000 },
  recoveryVerify: { env: 'POORUP_RECOVERY_VERIFY', limit: 20, windowMs: 900_000 },
  profileWrite: { env: 'POORUP_PROFILE_WRITE', limit: 60, windowMs: 60_000 },
  internalToken: { env: 'POORUP_INTERNAL_TOKEN', limit: 30, windowMs: 60_000 },
  analytics: { env: 'POORUP_ANALYTICS', limit: 120, windowMs: 60_000 },
});

function budgetNumber(raw, fallback, min, max) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function readAbuseLimits(env = process.env) {
  return Object.fromEntries(Object.entries(ABUSE_BUDGET_SPEC).map(([name, spec]) => [name, {
    limit: budgetNumber(env?.[`${spec.env}_LIMIT`], spec.limit, 0, 100_000),
    windowMs: budgetNumber(env?.[`${spec.env}_WINDOW_MS`], spec.windowMs, 1_000, 86_400_000),
  }]));
}

// Socket event limiter settings. Blank values are unset (see socketRateLimiter.js). POORUP_SOCKET_BLOCK_THRESHOLD counts refused events
// from one peer within a window; reaching it blocks that peer's events for POORUP_SOCKET_BLOCK_MS. The socket stays connected throughout.
export function readSocketEventLimits(env = process.env) {
  return {
    max: env?.POORUP_SOCKET_RATE_LIMIT,
    windowMs: env?.POORUP_SOCKET_RATE_WINDOW_MS,
    peerMax: env?.POORUP_SOCKET_PEER_RATE_LIMIT,
    blockThreshold: env?.POORUP_SOCKET_BLOCK_THRESHOLD,
    blockMs: env?.POORUP_SOCKET_BLOCK_MS,
  };
}

export function createCorsOrigin(env = process.env) {
  const configuredOrigins = parseAllowedOrigins(env);
  const production = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
  return (origin, callback) => {
    const allowed = configuredOrigins.length
      ? isAllowedSocketOrigin(origin, configuredOrigins)
      : (!production || !origin);
    callback(null, allowed);
  };
}

export function assertProductionCors(env = process.env) {
  const production = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
  const origins = parseAllowedOrigins(env);
  if (production && (!origins.length || origins.includes('*') || hasMalformedOriginList(env))) throw new Error('POORUP_ALLOWED_ORIGINS must be configured with valid origins in production.');
  return true;
}
