import express from 'express';
import { isAdminAccount, setAnalyticsNoStoreHeaders } from './analyticsApi.js';
import { ProviderConfigError } from './aiProviderConfig.js';

const WRITE_WINDOW_MS = 60_000;
const WRITE_LIMIT = 12;

function sameOrigin(req, configuredOrigin = '') {
  const origin = String(req.get?.('origin') || '').trim();
  if (!origin) return true;
  if (configuredOrigin && origin === configuredOrigin) return true;
  const protocol = String(req.get?.('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return origin === `${protocol}://${req.get?.('host')}`;
}

function errorPayload(error) {
  if (error instanceof ProviderConfigError) return { success: false, code: error.code, error: error.message };
  return { success: false, code: 'PROVIDER_UNAVAILABLE', error: 'Provider configuration is unavailable.' };
}

export function registerAiProviderRoutes(app, {
  manager,
  accountStore,
  adminIds = [],
  publicOrigin = '',
} = {}) {
  const router = express.Router();
  const writes = new Map();

  function requireAdmin(req, res, next) {
    const token = String(req.get?.('x-poorup-session-token') || '');
    const account = accountStore?.sessionAccount?.(token);
    if (!isAdminAccount(account?.id, adminIds)) return res.status(403).json({ success: false, error: 'Forbidden.' });
    if (!sameOrigin(req, publicOrigin)) return res.status(403).json({ success: false, error: 'Origin is not allowed.' });
    req.adminAccountId = account.id;
    next();
  }

  function writeGuard(req, res, next) {
    const now = Date.now();
    const current = writes.get(req.adminAccountId);
    const bucket = current && now - current.startedAt < WRITE_WINDOW_MS ? current : { startedAt: now, count: 0 };
    bucket.count += 1;
    writes.set(req.adminAccountId, bucket);
    if (bucket.count > WRITE_LIMIT) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.startedAt + WRITE_WINDOW_MS - now) / 1000)));
      return res.status(429).json({ success: false, error: 'Too many provider changes. Try again shortly.' });
    }
    return next();
  }

  router.use(express.json({ limit: '12kb' }));
  router.use(requireAdmin);

  router.get('/status', (_req, res) => {
    setAnalyticsNoStoreHeaders(res);
    return res.json({ success: true, ...manager.status() });
  });

  router.get('/providers', (_req, res) => {
    setAnalyticsNoStoreHeaders(res);
    return res.json({ success: true, active: manager.active(), providers: manager.list(), storage: manager.status().storage });
  });

  router.post('/providers', writeGuard, (req, res) => {
    try {
      const profile = manager.upsert(req.body || {});
      setAnalyticsNoStoreHeaders(res);
      return res.status(201).json({ success: true, profile });
    } catch (error) {
      return res.status(error instanceof ProviderConfigError ? 400 : 500).json(errorPayload(error));
    }
  });

  router.patch('/providers/:id', writeGuard, (req, res) => {
    try {
      const profile = manager.upsert({ ...(req.body || {}), id: req.params.id });
      setAnalyticsNoStoreHeaders(res);
      return res.json({ success: true, profile });
    } catch (error) {
      return res.status(error instanceof ProviderConfigError ? 400 : 500).json(errorPayload(error));
    }
  });

  router.post('/providers/:id/test', writeGuard, async (req, res) => {
    try {
      const result = await manager.test(req.params.id);
      setAnalyticsNoStoreHeaders(res);
      return res.status(result.ok ? 200 : 502).json({ success: result.ok, test: result, profile: manager.list().find(profile => profile.id === req.params.id) || null });
    } catch (error) {
      return res.status(error instanceof ProviderConfigError ? 400 : 500).json(errorPayload(error));
    }
  });

  router.post('/providers/:id/activate', writeGuard, (req, res) => {
    try {
      const profile = manager.activate(req.params.id);
      setAnalyticsNoStoreHeaders(res);
      return res.json({ success: true, active: profile, status: manager.status() });
    } catch (error) {
      return res.status(error instanceof ProviderConfigError ? 409 : 500).json(errorPayload(error));
    }
  });

  router.delete('/providers/:id', writeGuard, (req, res) => {
    try {
      manager.remove(req.params.id);
      setAnalyticsNoStoreHeaders(res);
      return res.json({ success: true });
    } catch (error) {
      return res.status(error instanceof ProviderConfigError ? 409 : 500).json(errorPayload(error));
    }
  });

  app.use('/admin/ai', router);
  return router;
}
