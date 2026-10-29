import crypto from 'node:crypto';
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

// Resolve a socket peer only through an explicitly trusted proxy hop count. Otherwise attacker-controlled forwarding headers
// could mint fresh limiter identities on every reconnect. The result is the limiter key: an IPv6 /64 is one peer (see rateLimitAddressKey).
export function resolveClientAddress(handshake = {}, trustedProxyHops = 0) {
  return rateLimitAddressKey(resolveRawClientAddress(handshake, trustedProxyHops));
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

function resolveRawClientAddress(handshake, trustedProxyHops) {
  const direct = String(handshake.address || handshake.request?.socket?.remoteAddress || handshake.socket?.remoteAddress || 'unknown').trim();
  const hops = Math.max(0, Math.floor(Number(trustedProxyHops) || 0));
  if (!hops) return direct.slice(0, 80);
  const forwarded = handshake.headers?.['x-forwarded-for']
    || handshake.request?.headers?.['x-forwarded-for']
    || handshake.request?.headers?.['X-Forwarded-For'];
  const chain = String(forwarded || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!chain.length) return direct.slice(0, 80);
  // Match Express/proxy-addr: with N trusted hops the client is the Nth entry
  // from the right (the one the nearest trusted proxy appended).
  const index = Math.max(0, chain.length - hops);
  return String(chain[index] || direct).slice(0, 80);
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
