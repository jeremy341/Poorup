// Operator sign-in for the maintenance lockout. POORUP_MAINTENANCE_PASSWORD unlocks the site for one browser while the lockout is on.
// Unset, the feature does not exist: the unlock route answers 404 and nothing verifies (admin accounts still bypass, see socketRuntime.js).
//
// Kept: the SHA-256 digest of the password (compared in constant time) and an HMAC key derived from it. Never kept, logged or echoed:
// the password itself. A sign-in sets an HttpOnly, SameSite=Strict cookie holding "<expiry>.<id>.<signature>". The signature covers
// the expiry and a random id, so tokens cannot be extended or forged, and rotating the password invalidates all of them. Logout revokes
// the id. The key is random per process unless POORUP_MAINTENANCE_COOKIE_SECRET is set, so a restart signs everyone out.
import crypto from 'node:crypto';
import express from 'express';
import { createHttpRateLimiter } from './httpRateLimiter.js';
import { sameOrigin } from './adminOpsGuard.js';
import { rateLimitAddressKey } from './ipAllowlist.js';
import { parseCookieHeader } from './sessionStore.js';
import { pruneWindowBuckets, windowBucket } from './rateBuckets.js';

export const MAINTENANCE_ACCESS_COOKIE = 'poorup_operator';
export const DEFAULT_ACCESS_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_ACCESS_TTL_MS = 5 * 60 * 1000;
const MAX_ACCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_REVOKED = 10_000;
const TOKEN_PATTERN = /^([0-9a-z]{1,11})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const SIGNING_CONTEXT = 'poorup-maintenance-access-v1|';
const FAILED = Object.freeze({ success: false, error: 'Sign-in failed.' });

export function resolveAccessTtlMs(value) {
  const parsed = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ACCESS_TTL_MS;
  return Math.min(MAX_ACCESS_TTL_MS, Math.max(MIN_ACCESS_TTL_MS, Math.floor(parsed)));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time password check. Every candidate, whatever its type or length,
 * is reduced to a 32-byte digest and compared once against the 32-byte digest
 * of the configured password, so timing says nothing about length or prefix.
 */
export function passwordMatches(candidate, expectedDigest, compare = crypto.timingSafeEqual) {
  const usable = typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_PASSWORD_LENGTH;
  const matched = compare(sha256(usable ? candidate : ''), expectedDigest);
  return usable && matched === true;
}

export function createMaintenanceAccess({
  password = '',
  cookieSecret = '',
  ttlMs = DEFAULT_ACCESS_TTL_MS,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  compare = crypto.timingSafeEqual,
  failureLimit = 5,
  failureWindowMs = 15 * 60 * 1000,
  baseDelayMs = 250,
  maxDelayMs = 4_000,
} = {}) {
  const configured = typeof password === 'string' ? password.trim() : '';
  const enabled = configured.length > 0;
  const lifetime = resolveAccessTtlMs(ttlMs);
  const expectedDigest = sha256(configured);
  const secret = String(cookieSecret || '').trim() || randomBytes(32);
  const signingKey = crypto.createHmac('sha256', secret).update(SIGNING_CONTEXT).update(expectedDigest).digest();
  const revoked = new Map();
  const failures = new Map();
  // Only grants produced by verify() count, so socket data cannot be forged
  // into a bypass by any other code path.
  const grants = new WeakSet();

  function sign(expiry, id) {
    return crypto.createHmac('sha256', signingKey).update(`v1|${expiry}|${id}`).digest();
  }

  function pruneRevoked(current) {
    for (const [id, expiresAt] of revoked) if (expiresAt <= current) revoked.delete(id);
    while (revoked.size > MAX_REVOKED) revoked.delete(revoked.keys().next().value);
  }

  function issue() {
    const expiresAt = now() + lifetime;
    const expiry = expiresAt.toString(36);
    const id = randomBytes(16).toString('base64url');
    return { token: `${expiry}.${id}.${sign(expiry, id).toString('base64url')}`, expiresAt };
  }

  function verify(token) {
    if (!enabled || typeof token !== 'string' || token.length > 128) return null;
    const match = TOKEN_PATTERN.exec(token);
    if (!match) return null;
    const [, expiry, id, signature] = match;
    const provided = Buffer.from(signature, 'base64url');
    if (provided.length !== 32 || !crypto.timingSafeEqual(provided, sign(expiry, id))) return null;
    const expiresAt = Number.parseInt(expiry, 36);
    const current = now();
    if (!Number.isFinite(expiresAt) || expiresAt <= current || expiresAt > current + lifetime) return null;
    if (revoked.has(id)) return null;
    const grant = Object.freeze({ jti: id, expiresAt });
    grants.add(grant);
    return grant;
  }

  function grantFromCookieHeader(header) {
    return verify(parseCookieHeader(typeof header === 'string' ? header : '')[MAINTENANCE_ACCESS_COOKIE]);
  }

  function isGrantActive(grant) {
    if (!enabled || !grant || typeof grant !== 'object' || !grants.has(grant)) return false;
    return grant.expiresAt > now() && !revoked.has(grant.jti);
  }

  function revoke(grant) {
    if (!grant?.jti || !grants.has(grant)) return;
    revoked.set(grant.jti, grant.expiresAt);
    pruneRevoked(now());
  }

  function serialize(value, maxAge, secure) {
    return [`${MAINTENANCE_ACCESS_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`, ...(secure ? ['Secure'] : [])].join('; ');
  }

  const cookie = (token, { secure = false } = {}) => serialize(token, Math.floor(lifetime / 1000), secure);
  const clearCookie = ({ secure = false } = {}) => serialize('', 0, secure);

  function retryAfterSeconds(bucket, current) {
    return Math.max(1, Math.ceil((bucket.startedAt + failureWindowMs - current) / 1000));
  }

  // One attempt from one client address. The attempt is counted before the
  // comparison so parallel guesses cannot all slip in under the limit; a
  // locked-out address is refused without any comparison at all.
  async function attempt(address, candidate) {
    const current = now();
    // One client holds a whole IPv6 /64, so every address in it shares this
    // budget: a client cannot mint a fresh budget by rotating its address.
    const key = String(rateLimitAddressKey(String(address || 'unknown')).trim() || 'unknown');
    const bucket = windowBucket(failures, key, current, failureWindowMs);
    if (bucket.count >= failureLimit) return { ok: false, status: 429, retryAfterSeconds: retryAfterSeconds(bucket, current) };
    bucket.count += 1;
    pruneWindowBuckets(failures, current, failureWindowMs);
    if (passwordMatches(candidate, expectedDigest, compare)) {
      failures.delete(key);
      return { ok: true, ...issue() };
    }
    await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** (bucket.count - 1)));
    return { ok: false, status: 401 };
  }

  return Object.freeze({ enabled, ttlMs: lifetime, issue, verify, grantFromCookieHeader, isGrantActive, revoke, cookie, clearCookie, attempt });
}

/**
 *   GET  /maintenance/unlock   404 when no password is set; else { success, available: true, bypass }
 *   POST /maintenance/unlock   { password }: 200 + cookie | 401 | 429 | 403 | 400 | 413 | 404
 *   POST /maintenance/logout   always 200, clears the cookie and revokes its token
 */
export function registerMaintenanceAccessRoutes(app, {
  access,
  publicOrigin = '',
  forceSecure = false,
  trustProxy = false,
  unlockRateLimit = { max: 10, windowMs: 60_000 },
} = {}) {
  const router = express.Router();
  const limiter = createHttpRateLimiter({ max: unlockRateLimit.max, windowMs: unlockRateLimit.windowMs, trustProxy });
  const secureFor = req => forceSecure === true || req.secure === true;
  const notFound = res => res.status(404).json({ success: false, error: 'Not found.' });

  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  router.get('/unlock', (req, res) => {
    if (!access.enabled) return notFound(res);
    const bypass = access.isGrantActive(access.grantFromCookieHeader(req.headers.cookie));
    return res.json({ success: true, available: true, bypass });
  });

  router.post('/unlock',
    (req, res, next) => (access.enabled ? next() : notFound(res)),
    (req, res, next) => (sameOrigin(req, publicOrigin) ? next() : res.status(403).json({ success: false, error: 'Origin is not allowed.' })),
    limiter,
    express.json({ limit: '2kb' }),
    async (req, res, next) => {
      try {
        const candidate = req.body && typeof req.body === 'object' ? req.body.password : undefined;
        const result = await access.attempt(req.ip || req.socket?.remoteAddress, candidate);
        if (result.ok) {
          res.setHeader('Set-Cookie', access.cookie(result.token, { secure: secureFor(req) }));
          return res.json({ success: true, expiresAt: new Date(result.expiresAt).toISOString() });
        }
        if (result.status === 429) {
          res.setHeader('Retry-After', String(result.retryAfterSeconds));
          return res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
        }
        return res.status(401).json(FAILED);
      } catch {
        // Never forward to the app's error handler: it logs error messages.
        return next(new Error('maintenance unlock failed'));
      }
    });

  router.post('/logout',
    (req, res, next) => (sameOrigin(req, publicOrigin) ? next() : res.status(403).json({ success: false, error: 'Origin is not allowed.' })),
    (req, res) => {
      access.revoke(access.grantFromCookieHeader(req.headers.cookie));
      res.setHeader('Set-Cookie', access.clearCookie({ secure: secureFor(req) }));
      return res.json({ success: true });
    });

  // Body-parser failures carry a message that can quote the raw body (and so
  // the password). They are answered here and never logged.
  router.use((error, _req, res, next) => {
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
      return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ success: false, error: 'The request body is not valid JSON.' });
    }
    if (error?.type) return res.status(400).json({ success: false, error: 'The request body is not valid JSON.' });
    return next(error);
  });

  app.use('/maintenance', router);
  return router;
}
