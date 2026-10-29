import { peerBucketKey, pruneWindowBuckets, windowBucket } from './rateBuckets.js';

// A blank env var (POORUP_SOCKET_RATE_LIMIT=) is unset, not zero: Number('')
// is 0, which would deny every event or collapse the window to its floor.
function isUnset(value) {
  return value === undefined || (typeof value === 'string' && value.trim() === '');
}

function normalizedLimit(value, fallback) {
  if (isUnset(value)) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100_000, Math.max(0, Math.floor(parsed))) : fallback;
}

// Small process-local ingress guard. Game actions stay server-authoritative; this only rejects abusive event volume before handlers run.
// Two budgets apply to every event: one per socket, and one per resolved peer address. The socket budget resets on every reconnect
// (new socket id), so the peer budget is what actually bounds a client that reconnects in a loop.
export function createSocketRateLimiter({ max = 240, peerMax, windowMs = 10_000, now = () => Date.now() } = {}) {
  const buckets = new Map();
  const peerBuckets = new Map();
  const limit = normalizedLimit(max, 240);
  const peerLimit = normalizedLimit(peerMax, Math.min(100_000, limit * 4));
  const parsedWindow = isUnset(windowMs) ? Number.NaN : Number(windowMs);
  const window = Number.isFinite(parsedWindow) ? Math.min(86_400_000, Math.max(100, Math.floor(parsedWindow))) : 10_000;

  function takeFrom(map, key, cap, current) {
    const bucket = windowBucket(map, key, current, window);
    if (bucket.count >= cap) return false;
    bucket.count += 1;
    return true;
  }

  function allow(socketId, peerKey = '') {
    if (!socketId) return false;
    if (!limit || !peerLimit) return false;
    const current = now();
    pruneWindowBuckets(buckets, current, window);
    pruneWindowBuckets(peerBuckets, current, window);
    if (!takeFrom(buckets, socketId, limit, current)) return false;
    if (!peerKey) return true;
    return takeFrom(peerBuckets, peerBucketKey(peerKey), peerLimit, current);
  }

  function forget(socketId) {
    if (socketId) buckets.delete(socketId);
  }

  return { allow, forget, size: () => buckets.size + peerBuckets.size };
}

// Connection admission is a separate, pre-socket guard. The per-socket limiter protects event volume after a connection exists; this
// seam stops a client creating unlimited fresh sockets to reset that counter. Active connections come from Engine.IO, and handshakes
// are bounded per peer over a short rolling window.
export function createSocketAdmission({ maxConnections = 2_000, maxHandshakes = 120, windowMs = 10_000, now = () => Date.now() } = {}) {
  const connectionLimit = Math.max(1, Math.min(100_000, Math.floor(Number(maxConnections) || 2_000)));
  const handshakeLimit = Math.max(1, Math.min(100_000, Math.floor(Number(maxHandshakes) || 120)));
  const window = Math.max(100, Math.min(86_400_000, Math.floor(Number(windowMs) || 10_000)));
  const buckets = new Map();

  function allow(peerKey, activeConnections = 0) {
    if (Number.isFinite(Number(activeConnections)) && Number(activeConnections) >= connectionLimit) return false;
    const key = peerBucketKey(peerKey || 'unknown') || 'unknown';
    const observed = Number(now());
    const current = Number.isFinite(observed) ? observed : Date.now();
    // Unresolvable peers share one bucket: rate-limit them harder so one
    // abusive direct-connect client can neither hide in nor DoS the crowd.
    const effective = key === 'unknown' ? Math.max(1, Math.floor(handshakeLimit / 10)) : handshakeLimit;
    const bucket = windowBucket(buckets, key, current, window);
    if (bucket.count >= effective) return false;
    bucket.count += 1;
    pruneWindowBuckets(buckets, current, window);
    return true;
  }

  return { allow, size: () => buckets.size };
}
