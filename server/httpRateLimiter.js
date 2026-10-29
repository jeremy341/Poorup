// Small in-process IP limiter used as the second line behind an edge/WAF.
// Configure POORUP_HTTP_RATE_LIMIT and POORUP_HTTP_RATE_WINDOW_MS in hosted
// environments; local development remains unlimited by default.
import { MAX_TRACKED_BUCKETS, windowBucket } from './rateBuckets.js';
import { rateLimitAddressKey } from './ipAllowlist.js';

// Where new keys count once the table is full of live buckets. Evicting a live
// bucket would hand its owner a fresh budget, so this fails closed instead.
const OVERFLOW_KEY = 'overflow';

function normalizedLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100_000, Math.max(0, Math.floor(parsed)));
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
  const httpLimit = normalizedLimit(env?.POORUP_HTTP_RATE_LIMIT);
  const socketLimit = normalizedLimit(env?.POORUP_SOCKET_RATE_LIMIT);
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

function rejectLimitedRequest({ res, bucket, limit, window, now }) {
  if (bucket.count <= limit) return false;
  res.setHeader('Retry-After', String(Math.ceil((bucket.startedAt + window - now) / 1000)));
  res.status(429).type('text').send('Too many requests. Try again shortly.');
  return true;
}

function consumeRequest({ req, res, limit, window, buckets, trustProxy }) {
  // Express has already applied the configured trusted-proxy hop count to
  // req.ip. Never trust a raw client-supplied X-Forwarded-For value: it
  // lets an attacker mint a fresh bucket for every request.
  const now = Date.now();
  const bucket = windowBucket(buckets, bucketKey(buckets, requestIp(req, trustProxy), now, window), now, window);
  bucket.count += 1;
  return rejectLimitedRequest({ res, bucket, limit, window, now });
}

export function createHttpRateLimiter({ max = 0, windowMs = 60_000, trustProxy = false } = {}) {
  const limit = normalizedLimit(max);
  const window = normalizedWindow(windowMs);
  const buckets = new Map();
  return function httpRateLimit(req, res, next) {
    if (!limit) return next();
    if (consumeRequest({ req, res, limit, window, buckets, trustProxy })) return;
    next();
  };
}
