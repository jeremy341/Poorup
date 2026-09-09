// Small in-process IP limiter used as the second line behind an edge/WAF.
// Configure POORUP_HTTP_RATE_LIMIT and POORUP_HTTP_RATE_WINDOW_MS in hosted
// environments; local development remains unlimited by default.
export function createHttpRateLimiter({ max = 0, windowMs = 60_000, trustProxy = false } = {}) {
  const limit = Math.max(0, Math.floor(Number(max) || 0));
  const window = Math.max(1_000, Math.floor(Number(windowMs) || 60_000));
  const buckets = new Map();
  return function httpRateLimit(req, res, next) {
    if (!limit) return next();
    const forwarded = trustProxy ? req.headers['x-forwarded-for'] : null;
    const ip = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 80);
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
