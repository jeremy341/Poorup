import { ipv6Words } from './ipAllowlist.js';

// Fixed-window bucket maps shared by the ingress limiters. A Map keeps insertion order and a bucket is re-inserted when its window
// restarts, so the front always holds the oldest window. Pruning stops at the first live bucket instead of rescanning every entry,
// which matters under reconnect churn when the map sits at its cap.
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
  buckets.delete(key);
  buckets.set(key, bucket);
  return bucket;
}

export function pruneWindowBuckets(buckets, now, windowMs, cap = MAX_TRACKED_BUCKETS) {
  if (buckets.size <= cap) return;
  dropExpiredBuckets(buckets, now, windowMs);
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
