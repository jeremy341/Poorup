import { ipv6Words } from './ipAllowlist.js';

// Bounded bucket maps shared by the ingress limiters. A Map keeps insertion order and a bucket is re-inserted when its window
// restarts, so the front always holds the oldest window. Pruning stops at the first live bucket instead of rescanning every entry,
// which matters under reconnect churn when the map sits at its cap. The limiters layer a token allowance on these slots (see
// spendToken); the map still owns eviction, pruning and the legacy `count`/`startedAt` fields.
export const MAX_TRACKED_BUCKETS = 10_000;

// Keys beyond the cap never get a shared bucket: it would hide the spend of the key asking, and a limit reading the map directly
// would see nothing and fail open. Instead the oldest live slot moves to the new key, budget included, so the new key starts spent
// and no budget is ever reset to zero behind an attacker's back.
function dropExpiredBuckets(buckets, now, windowMs) {
  for (const [key, entry] of buckets) {
    if (now - entry.startedAt < windowMs) break;
    buckets.delete(key);
  }
}

// The oldest live slot moves to the new key with the count it already spent.
// The window restarts so the new key gets a full window, but the spend
// travels with the bucket: the limit still fails closed.
function moveOldestBucket(buckets, key, now) {
  const oldest = buckets.keys().next().value;
  const entry = buckets.get(oldest);
  buckets.delete(oldest);
  entry.startedAt = now;
  // The recycled slot carries the old key's spend, including any token state.
  // Reset its refill clock so the new key cannot regain tokens for time the old
  // key spent somewhere else; it starts exactly as spent as the slot it took.
  if (entry.tokens !== undefined) entry.lastRefill = now;
  buckets.set(key, entry);
  return entry;
}

export function windowBucket(buckets, key, now, windowMs, cap = MAX_TRACKED_BUCKETS) {
  const current = buckets.get(key);
  if (current && now - current.startedAt < windowMs) return current;
  if (!current && buckets.size >= cap) {
    dropExpiredBuckets(buckets, now, windowMs);
    if (buckets.size >= cap) return moveOldestBucket(buckets, key, now);
  }
  const bucket = { startedAt: now, count: 0 };
  // A token allowance layered on this map must survive a fixed-window rollover,
  // otherwise the whole budget would come back at the boundary. Only the legacy
  // count restarts; the tokens and their refill clock carry over unchanged.
  if (current && current.tokens !== undefined) {
    bucket.tokens = current.tokens;
    bucket.lastRefill = current.lastRefill;
  }
  buckets.delete(key);
  buckets.set(key, bucket);
  return bucket;
}

export function pruneWindowBuckets(buckets, now, windowMs, cap = MAX_TRACKED_BUCKETS) {
  if (buckets.size <= cap) return;
  dropExpiredBuckets(buckets, now, windowMs);
}

// Stable wire contract for every refusal caused by a rate limit. Clients match on `code`; `error` is human text only.
export const RATE_LIMITED_CODE = 'RATE_LIMITED';
export const RATE_LIMITED_MESSAGE = 'Too many requests. Try again shortly.';

// Token-bucket allowance for one bounded-map slot. The bucket refills continuously at `limit / windowMs` tokens per millisecond,
// capped at `limit`, and each allowed action spends one token. Because the bucket is empty immediately after a full burst, a client
// cannot spend a full allowance just before a window rollover and another just after it. State is O(1) per key (a float and a
// timestamp), so memory stays bounded by the map cap. Returns null when allowed, or the milliseconds until a token is free when not.
export function spendToken(bucket, limit, now, windowMs) {
  const max = Math.max(1, Math.floor(Number(limit) || 0));
  const window = Math.max(1, Number(windowMs) || 1);
  if (bucket.tokens === undefined) {
    // A recycled slot carries the spend of the key it belonged to. Start from
    // that spend so a new key cannot reset a budget behind the limiter's back.
    bucket.tokens = Math.max(0, max - Math.min(max, Number(bucket.count) || 0));
    bucket.lastRefill = now;
  }
  const elapsed = Math.max(0, now - bucket.lastRefill);
  if (elapsed > 0) {
    bucket.tokens = Math.min(max, bucket.tokens + elapsed * (max / window));
    bucket.lastRefill = now;
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    bucket.count = (Number(bucket.count) || 0) + 1;
    return null;
  }
  return Math.max(1, Math.ceil((1 - bucket.tokens) * window / max));
}

// A token-bucket budget for one identity (an account, a peer address or a socket). It shares the bounded bucket map, so rotating keys
// can never grow it past MAX_TRACKED_BUCKETS. A limit of 0 disables the budget. take() returns null when the action is allowed, or
// the milliseconds until the next token is free when it is not.
export function createActionBudget({ limit, windowMs, cap = MAX_TRACKED_BUCKETS, now = () => Date.now() } = {}) {
  const max = Math.max(0, Math.floor(Number(limit) || 0));
  const window = Math.max(1, Math.floor(Number(windowMs) || 60_000));
  const buckets = new Map();
  return {
    limit: max,
    windowMs: window,
    take(key, at = now()) {
      if (!max) return null;
      const identity = String(key ?? '').slice(0, 120) || 'unknown';
      const bucket = windowBucket(buckets, identity, at, window, cap);
      const wait = spendToken(bucket, max, at, window);
      if (wait === null) pruneWindowBuckets(buckets, at, window, cap);
      return wait;
    },
    size: () => buckets.size,
  };
}

// The key a peer address is limited under. An IPv4-mapped IPv6 address is its
// IPv4, and any other IPv6 address collapses to its /64 prefix (the smallest
// normal allocation), so one client cannot mint a fresh budget per address.
export function peerBucketKey(address) {
  const raw = String(address ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!raw.includes(':')) return raw.slice(0, 80);
  const words = ipv6Words(raw);
  if (!words || words.some(Number.isNaN)) return raw.slice(0, 80);
  const mapped = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  if (mapped) return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.');
  return `${words.slice(0, 4).map(word => word.toString(16)).join(':')}::/64`;
}
