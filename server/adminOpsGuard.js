// One admin guard for every operator route (/admin/ai/* and /admin/ops/*).
// It is the guard aiProviderRoutes.js uses, shared here so the
// two route families cannot drift apart:
//   401  no account session
//   403  signed in but not on the admin allow-list
//   403  a browser Origin header that is not this site (same-origin check)
//   429  more than ADMIN_WRITE_LIMIT writes per account per minute
import { isAdminAccount } from './analyticsApi.js';

export const ADMIN_WRITE_WINDOW_MS = 60_000;
export const ADMIN_WRITE_LIMIT = 12;

export function sameOrigin(req, configuredOrigin = '') {
  const origin = String(req.get?.('origin') || '').trim();
  if (!origin) return true;
  if (configuredOrigin && origin === configuredOrigin) return true;
  const protocol = String(req.get?.('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return origin === `${protocol}://${req.get?.('host')}`;
}

// Router-level error handler for express.json. A 4xx from the body parser (bad JSON, too large,
// unsupported encoding, aborted upload) is the caller's fault: answer it as JSON with that status
// and do not count it as a server error. Anything else goes to the app's own handler.
export function jsonBodyErrorHandler(error, _req, res, next) {
  const status = Number(error?.status || error?.statusCode);
  if (res.headersSent || !(status >= 400 && status < 500)) return next(error);
  const message = status === 415 ? 'The request encoding is not supported.' : 'The request body is not valid JSON.';
  return res.status(status).json({ success: false, error: message });
}

// The write budget belongs to the operator, not to a route family. /admin/ai/* and /admin/ops/*
// are two guards over the same accounts, so a per-guard map would double the allowed writes.
// The map is module scope so every guard instance shares the same windows.
const writeBudgets = new Map();
// Two guards can be handed different clocks (a family may run on its own
// clock). A window that starts more than half a window ahead of ours belongs
// to another clock, so it is not ours to extend: the caller opens a fresh one.
const CLOCK_SKEW_TOLERANCE_MS = ADMIN_WRITE_WINDOW_MS / 2;

export function createAdminGuard({
  accountStore = null,
  accountResolver = null,
  adminIds = [],
  publicOrigin = '',
  writeLimitMessage = 'Too many changes. Try again shortly.',
  now = () => Date.now(),
} = {}) {
  function requireAdmin(req, res, next) {
    const token = String(req.get?.('x-poorup-session-token') || '');
    const account = accountResolver?.(req) || accountStore?.sessionAccount?.(token);
    if (!account?.id) return res.status(401).json({ success: false, error: 'Account session required.' });
    // A legacy bearer token was just traded for a cookie session (and revoked).
    // The cookie is handed over before every refusal: the operator must not be
    // left with neither the old token nor its replacement.
    if (req.sessionCookie) res.setHeader('Set-Cookie', req.sessionCookie);
    if (!isAdminAccount(account?.id, adminIds)) return res.status(403).json({ success: false, error: 'Forbidden.' });
    if (!sameOrigin(req, publicOrigin)) return res.status(403).json({ success: false, error: 'Origin is not allowed.' });
    req.adminAccountId = account.id;
    next();
  }

  function writeGuard(req, res, next) {
    const current = now();
    const accountId = String(req.adminAccountId || '');
    const existing = writeBudgets.get(accountId);
    const elapsed = existing ? current - existing.startedAt : Infinity;
    const ahead = existing ? existing.startedAt - current : 0;
    const usable = existing && elapsed < ADMIN_WRITE_WINDOW_MS && ahead <= CLOCK_SKEW_TOLERANCE_MS;
    const bucket = usable ? existing : { startedAt: current, count: 0 };
    bucket.count += 1;
    writeBudgets.set(accountId, bucket);
    // Keep the shared map from growing without end: only admins write, and a
    // window that is long gone is worth nothing.
    if (writeBudgets.size > 64) {
      for (const [id, old] of writeBudgets) {
        if (current - old.startedAt >= ADMIN_WRITE_WINDOW_MS) writeBudgets.delete(id);
      }
    }
    if (bucket.count > ADMIN_WRITE_LIMIT) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.startedAt + ADMIN_WRITE_WINDOW_MS - current) / 1000)));
      return res.status(429).json({ success: false, error: writeLimitMessage });
    }
    return next();
  }

  return Object.freeze({ requireAdmin, writeGuard });
}
