// Small in-process IP limiter used as the second line behind an edge/WAF.
// Configure POORUP_HTTP_RATE_LIMIT and POORUP_HTTP_RATE_WINDOW_MS in hosted
// environments; local development remains unlimited by default.
import { MAX_TRACKED_BUCKETS, spendToken, windowBucket } from './rateBuckets.js';
import { rateLimitAddressKey } from './ipAllowlist.js';

// Where new keys count once the table is full of live buckets. Evicting a live
// bucket would hand its owner a fresh budget, so this fails closed instead.
const OVERFLOW_KEY = 'overflow';

function normalizedLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100_000, Math.max(0, Math.floor(parsed)));
}

// A hosted deployment gets a safe in-process budget without an env file; local
// development stays unlimited. An explicit POORUP_HTTP_RATE_LIMIT always wins.
export const DEFAULT_HTTP_RATE_LIMIT = 600;
export function effectiveHttpLimit(env = process.env) {
  const raw = env?.POORUP_HTTP_RATE_LIMIT;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return String(env?.NODE_ENV || '').trim().toLowerCase() === 'production' ? DEFAULT_HTTP_RATE_LIMIT : 0;
  }
  return normalizedLimit(raw);
}

// A blank or zero window is unset, not a 1 s floor: Number('') is 0, and a
// collapsed window lets a client through far more often than configured.
function normalizedWindow(value) {
  if (value === undefined || value === null) return 60_000;
  const text = String(value).trim();
  if (!text) return 60_000;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return 60_000;
  return Math.min(86_400_000, Math.max(1_000, Math.floor(parsed)));
}

export function assertRateLimitConfig(env = process.env) {
  const development = String(env?.NODE_ENV || '').trim().toLowerCase() !== 'production';
  const httpLimit = effectiveHttpLimit(env);
  const socketRaw = env?.POORUP_SOCKET_RATE_LIMIT;
  const socketConfigured = socketRaw !== undefined && socketRaw !== null && String(socketRaw).trim() !== '';
  const socketLimit = socketConfigured ? normalizedLimit(socketRaw) : 240;
  // A zero socket budget would refuse every event, not disable the budget. The per-identity budgets read 0 as "off"; this global
  // guard does not, so reject the value instead of leaving an operator with a server that answers RATE_LIMITED to everything.
  if (socketConfigured && socketLimit <= 0) {
    throw new Error('POORUP_SOCKET_RATE_LIMIT must be a positive number: 0 would refuse every socket event. Unset it for the 240 per 10 s default, or set a positive limit.');
  }
  if (!development && (!httpLimit || !socketLimit)) {
    throw new Error('Production HTTP and socket rate limits must be positive.');
  }
  return { development, httpLimit, socketLimit };
}

function requestIp(req, trustProxy) {
  const forwardedIp = trustProxy ? req.ip : null;
  return rateLimitAddressKey(String(forwardedIp || req.socket?.remoteAddress || 'unknown').trim().slice(0, 80));
}

// Buckets sit in the map in the order their windows started, so expired ones
// are all at the front. Only those are dropped; a live bucket is never evicted.
function bucketKey(buckets, key, now, window) {
  if (buckets.has(key) || buckets.size < MAX_TRACKED_BUCKETS) return key;
  for (const [candidate, entry] of buckets) {
    if (now - entry.startedAt < window) break;
    buckets.delete(candidate);
  }
  return buckets.size < MAX_TRACKED_BUCKETS ? key : OVERFLOW_KEY;
}

function rejectLimitedRequest({ res, retryAfterMs }) {
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  // Express responses offer status/type/send. Engine.IO's raw request and upgrade responses do not, so answer those directly with
  // the same status, body and Retry-After header (an upgrade response is dropped by Engine.IO).
  if (typeof res.status === 'function' && typeof res.type === 'function' && typeof res.send === 'function') {
    res.status(429).type('text').send('Too many requests. Try again shortly.');
    return true;
  }
  res.statusCode = 429;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Too many requests. Try again shortly.');
  return true;
}

function consumeRequest({ req, res, limit, window, buckets, trustProxy, now }) {
  // Express has already applied the configured trusted-proxy hop count to
  // req.ip. Never trust a raw client-supplied X-Forwarded-For value: it
  // lets an attacker mint a fresh bucket for every request.
  const bucket = windowBucket(buckets, bucketKey(buckets, requestIp(req, trustProxy), now, window), now, window);
  const retryAfterMs = spendToken(bucket, limit, now, window);
  if (retryAfterMs === null) return false;
  rejectLimitedRequest({ res, retryAfterMs });
  return true;
}

export function createHttpRateLimiter({ max = 0, windowMs = 60_000, trustProxy = false, now = () => Date.now() } = {}) {
  const limit = normalizedLimit(max);
  const window = normalizedWindow(windowMs);
  const buckets = new Map();
  return function httpRateLimit(req, res, next) {
    if (!limit) return next();
    const observed = Number(now());
    const current = Number.isFinite(observed) ? observed : Date.now();
    if (consumeRequest({ req, res, limit, window, buckets, trustProxy, now: current })) return;
    next();
  };
}
