// Small process-local ingress guard. Game actions remain server-authoritative;
// this only rejects abusive event volume before handlers do work.
export function createSocketRateLimiter({ max = 240, windowMs = 10_000, now = () => Date.now() } = {}) {
  const buckets = new Map();
  const parsedMax = Number(max);
  const limit = Number.isFinite(parsedMax) ? Math.min(100_000, Math.max(0, Math.floor(parsedMax))) : 240;
  const parsedWindow = Number(windowMs);
  const window = Number.isFinite(parsedWindow) ? Math.min(86_400_000, Math.max(100, Math.floor(parsedWindow))) : 10_000;

  function allow(socketId) {
    if (!socketId) return false;
    if (!limit) return false;
    const current = now();
    const bucket = buckets.get(socketId);
    if (!bucket || current - bucket.startedAt >= window) {
      buckets.set(socketId, { startedAt: current, count: 1 });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }

  function forget(socketId) {
    if (socketId) buckets.delete(socketId);
  }

  return { allow, forget };
}

// Connection admission is a separate, pre-socket guard. The per-socket
// limiter above protects event volume after a connection exists; this seam
// prevents a client from creating unlimited fresh sockets to reset that
// counter. Active connection count is supplied by Socket.IO's Engine.IO
// server, while handshakes are bounded per peer over a short rolling window.
export function createSocketAdmission({ maxConnections = 2_000, maxHandshakes = 120, windowMs = 10_000, now = () => Date.now() } = {}) {
  const connectionLimit = Math.max(1, Math.min(100_000, Math.floor(Number(maxConnections) || 2_000)));
  const handshakeLimit = Math.max(1, Math.min(100_000, Math.floor(Number(maxHandshakes) || 120)));
  const window = Math.max(100, Math.min(86_400_000, Math.floor(Number(windowMs) || 10_000)));
  const buckets = new Map();

  function prune(current) {
    if (buckets.size <= 10_000) return;
    for (const [key, entry] of buckets) {
      if (current - entry.startedAt >= window) buckets.delete(key);
    }
  }

  function allow(peerKey, activeConnections = 0) {
    if (Number.isFinite(Number(activeConnections)) && Number(activeConnections) >= connectionLimit) return false;
    const key = String(peerKey || 'unknown').trim().slice(0, 80) || 'unknown';
    const observed = Number(now());
    const current = Number.isFinite(observed) ? observed : Date.now();
    const existing = buckets.get(key);
    const bucket = existing && current - existing.startedAt < window
      ? existing
      : { startedAt: current, count: 0 };
    if (bucket.count >= handshakeLimit) return false;
    bucket.count += 1;
    buckets.set(key, bucket);
    prune(current);
    return true;
  }

  return { allow, size: () => buckets.size };
}
