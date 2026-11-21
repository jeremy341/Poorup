import { RATE_LIMITED_CODE, peerBucketKey, pruneWindowBuckets, spendToken, windowBucket } from './rateBuckets.js';

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

function positiveSetting(value, fallback, max) {
  if (isUnset(value)) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(max, Math.floor(parsed)) : fallback;
}

const DEFAULT_BLOCK_THRESHOLD = 300;
const DEFAULT_BLOCK_MS = 60_000;
const MAX_BLOCKED_PEERS = 10_000;

// Small process-local ingress guard. Game actions stay server-authoritative; this only rejects abusive event volume before handlers run.
// Two budgets apply to every event: one per socket, and one per resolved peer address. The socket budget resets on every reconnect
// (new socket id), so the peer budget is what actually bounds a client that reconnects in a loop.
// A peer that keeps hitting the budget is escalated: after `blockThreshold` refusals inside one window its events are refused for
// `blockMs`. Refused events get a RATE_LIMITED answer and the socket stays connected, so a legitimate player sharing that address is
// slowed rather than dropped.
export function createSocketRateLimiter({ max = 240, peerMax, windowMs = 10_000, blockThreshold, blockMs, now = () => Date.now() } = {}) {
  const buckets = new Map();
  const peerBuckets = new Map();
  const refusals = new Map();
  const blocked = new Map();
  const limit = normalizedLimit(max, 240);
  const peerLimit = normalizedLimit(peerMax, Math.min(100_000, limit * 4));
  const parsedWindow = isUnset(windowMs) ? Number.NaN : Number(windowMs);
  const window = Number.isFinite(parsedWindow) ? Math.min(86_400_000, Math.max(100, Math.floor(parsedWindow))) : 10_000;
  const threshold = positiveSetting(blockThreshold, DEFAULT_BLOCK_THRESHOLD, 1_000_000);
  const blockWindow = positiveSetting(blockMs, DEFAULT_BLOCK_MS, 86_400_000);

  // Returns the milliseconds to wait when the budget is spent, or 0 after spending one unit. A token bucket refills between events,
  // so a peer cannot spend a full allowance on each side of a window rollover by timing its events around the boundary.
  function spend(map, key, cap, current) {
    const bucket = windowBucket(map, key, current, window);
    return spendToken(bucket, cap, current, window) ?? 0;
  }

  function refusal(retryAfterMs, blockedPeer = false) {
    return blockedPeer
      ? { code: RATE_LIMITED_CODE, retryAfterMs, blocked: true }
      : { code: RATE_LIMITED_CODE, retryAfterMs };
  }

  // Blocks expire in insertion order, so expired entries sit at the front and are dropped first. At the cap the oldest live block goes:
  // it would have expired first anyway.
  function remember(peer, current) {
    if (!blocked.has(peer)) {
      while (blocked.size >= MAX_BLOCKED_PEERS) {
        const oldest = blocked.keys().next().value;
        blocked.delete(oldest);
      }
    }
    blocked.delete(peer);
    blocked.set(peer, current + blockWindow);
  }

  function refuse(peer, retryAfterMs, current) {
    if (!peer) return refusal(retryAfterMs);
    const strikes = windowBucket(refusals, peer, current, window);
    strikes.count += 1;
    if (strikes.count < threshold) return refusal(retryAfterMs);
    refusals.delete(peer);
    remember(peer, current);
    return refusal(blockWindow, true);
  }

  function activeBlock(peer, current) {
    if (!peer) return 0;
    const until = blocked.get(peer);
    if (until === undefined) return 0;
    if (until > current) return until - current;
    blocked.delete(peer);
    return 0;
  }

  // Returns null when the event may run, or { code, retryAfterMs, blocked? } when it must be refused.
  function check(socketId, peerKey = '') {
    if (!socketId || !limit || !peerLimit) return refusal(window);
    const current = now();
    pruneWindowBuckets(buckets, current, window);
    pruneWindowBuckets(peerBuckets, current, window);
    const peer = peerKey ? peerBucketKey(peerKey) : '';
    const blockedFor = activeBlock(peer, current);
    if (blockedFor) return refusal(blockedFor, true);
    const socketWait = spend(buckets, socketId, limit, current);
    if (socketWait) return refuse(peer, socketWait, current);
    if (!peer) return null;
    const peerWait = spend(peerBuckets, peer, peerLimit, current);
    return peerWait ? refuse(peer, peerWait, current) : null;
  }

  function allow(socketId, peerKey = '') {
    return check(socketId, peerKey) === null;
  }

  function forget(socketId) {
    if (socketId) buckets.delete(socketId);
  }

  return { allow, check, forget, size: () => buckets.size + peerBuckets.size, blockedPeers: () => blocked.size };
}

// Connection admission is a separate, pre-socket guard. The per-socket limiter protects event volume after a connection exists; this
// seam stops a client creating unlimited fresh sockets to reset that counter. Active connections come from Engine.IO, handshakes
// are bounded per peer over a short rolling window, and a single peer holds at most `maxPerPeer` concurrent sockets so it cannot
// occupy every global slot.
const DEFAULT_MAX_PER_PEER = 5;
// Keep a slice of the global cap for every other peer, even if maxPerPeer is configured above it.
const MAX_RESERVED_CONNECTIONS = 100;

function positiveCount(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(100_000, Math.floor(parsed)) : fallback;
}

export function createSocketAdmission({ maxConnections = 2_000, maxPerPeer = DEFAULT_MAX_PER_PEER, maxHandshakes = 120, windowMs = 10_000, now = () => Date.now() } = {}) {
  const connectionLimit = Math.max(1, Math.min(100_000, Math.floor(Number(maxConnections) || 2_000)));
  const perPeerLimit = positiveCount(maxPerPeer, DEFAULT_MAX_PER_PEER);
  const reservedConnections = Math.max(1, Math.min(MAX_RESERVED_CONNECTIONS, Math.floor(connectionLimit * 0.05)));
  const perPeerCeiling = Math.max(1, connectionLimit - reservedConnections);
  const handshakeLimit = Math.max(1, Math.min(100_000, Math.floor(Number(maxHandshakes) || 120)));
  const window = Math.max(100, Math.min(86_400_000, Math.floor(Number(windowMs) || 10_000)));
  const buckets = new Map();

  // peerConnections is the caller's live count for this peer. It is a separate argument so existing callers that pass only the
  // global count keep the handshake and global checks they had before.
  function allow(peerKey, activeConnections = 0, peerConnections = 0) {
    const active = Number(activeConnections);
    if (Number.isFinite(active) && active >= connectionLimit) return false;
    const peerActive = Number(peerConnections);
    if (Number.isFinite(peerActive) && peerActive >= Math.min(perPeerLimit, perPeerCeiling)) return false;
    const key = peerBucketKey(peerKey || 'unknown') || 'unknown';
    const observed = Number(now());
    const current = Number.isFinite(observed) ? observed : Date.now();
    // Unresolvable peers share one bucket: rate-limit them harder so one
    // abusive direct-connect client can neither hide in nor DoS the crowd.
    const effective = key === 'unknown' ? Math.max(1, Math.floor(handshakeLimit / 10)) : handshakeLimit;
    const bucket = windowBucket(buckets, key, current, window);
    if (spendToken(bucket, effective, current, window) !== null) return false;
    pruneWindowBuckets(buckets, current, window);
    return true;
  }

  return { allow, size: () => buckets.size, maxPerPeer: perPeerLimit };
}
