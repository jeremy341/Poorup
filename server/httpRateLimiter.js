// Small in-process IP limiter used as the second line behind an edge/WAF.
// Configure POORUP_HTTP_RATE_LIMIT and POORUP_HTTP_RATE_WINDOW_MS in hosted
// environments; local development remains unlimited by default.
function normalizedLimit(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function normalizedWindow(value) {
  return Math.max(1_000, Math.floor(Number(value) || 60_000));
}

function requestIp(req, trustProxy) {
  const forwardedIp = trustProxy ? req.ip : null;
  return String(forwardedIp || req.socket?.remoteAddress || 'unknown').trim().slice(0, 80);
}

function bucketFor(buckets, ip, now, window) {
  const current = buckets.get(ip);
  const active = current && now - current.startedAt < window;
  const bucket = active ? current : { startedAt: now, count: 0 };
  bucket.count += 1;
  buckets.set(ip, bucket);
  return bucket;
}

function pruneBuckets(buckets, now, window) {
  if (buckets.size <= 10_000) return;
  for (const [key, entry] of buckets) {
    if (now - entry.startedAt >= window) buckets.delete(key);
  }
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
  const bucket = bucketFor(buckets, requestIp(req, trustProxy), now, window);
  pruneBuckets(buckets, now, window);
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
