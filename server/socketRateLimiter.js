// Small process-local ingress guard. Game actions remain server-authoritative;
// this only rejects abusive event volume before handlers do work.
export function createSocketRateLimiter({ max = 240, windowMs = 10_000, now = () => Date.now() } = {}) {
  const buckets = new Map();
  const limit = Math.max(1, Math.floor(Number(max) || 240));
  const window = Math.max(100, Math.floor(Number(windowMs) || 10_000));

  function allow(socketId) {
    if (!socketId) return false;
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
