// Small in-process IP limiter used as the second line behind an edge/WAF.
// Configure POORUP_HTTP_RATE_LIMIT and POORUP_HTTP_RATE_WINDOW_MS in hosted
// environments; local development remains unlimited by default.
export function createHttpRateLimiter({ max = 0, windowMs = 60_000, trustProxy = false } = {}) {
  const limit = Math.max(0, Math.floor(Number(max) || 0));
  const window = Math.max(1_000, Math.floor(Number(windowMs) || 60_000));
  const buckets = new Map();
  return function httpRateLimit(req, res, next) {
    if (!limit) return next();
    // Express has already applied the configured trusted-proxy hop count to
    // req.ip. Never trust a raw client-supplied X-Forwarded-For value: it
    // lets an attacker mint a fresh bucket for every request.
    const ip = String((trustProxy ? req.ip : null) || req.socket?.remoteAddress || 'unknown').trim().slice(0, 80);
    const now = Date.now();
    const current = buckets.get(ip);
    const bucket = !current || now - current.startedAt >= window ? { startedAt: now, count: 0 } : current;
    bucket.count += 1;
    buckets.set(ip, bucket);
    if (buckets.size > 10000) {
      for (const [key, entry] of buckets) if (now - entry.startedAt >= window) buckets.delete(key);
    }
    if (bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.startedAt + window - now) / 1000)));
      res.status(429).type('text').send('Too many requests. Try again shortly.');
      return;
    }
    next();
  };
}
