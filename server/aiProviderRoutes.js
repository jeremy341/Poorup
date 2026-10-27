import express from 'express';
import { setAnalyticsNoStoreHeaders } from './analyticsApi.js';
import { ProviderConfigError } from './aiProviderConfig.js';
import { createAdminGuard, jsonBodyErrorHandler } from './adminOpsGuard.js';

function errorPayload(error) {
  if (error instanceof ProviderConfigError) return { success: false, code: error.code, error: error.message };
  return { success: false, code: 'PROVIDER_UNAVAILABLE', error: 'Provider configuration is unavailable.' };
}

export function registerAiProviderRoutes(app, {
  manager,
  accountStore,
  accountResolver = null,
  adminIds = [],
  publicOrigin = '',
  auditLog = null,
} = {}) {
  const router = express.Router();
  const { requireAdmin, writeGuard } = createAdminGuard({
    accountStore,
    accountResolver,
    adminIds,
    publicOrigin,
    writeLimitMessage: 'Too many provider changes. Try again shortly.',
  });

  // The change log gets the profile label only (never the key or URL), and a
  // log failure must never turn a successful change into an error response.
  function labelFor(id) {
    try { return manager.list().find(profile => profile.id === id)?.label || 'unknown'; } catch { return 'unknown'; }
  }

  function audit(req, action, target, outcome) {
    // The change stands either way; an entry that was not saved is reported
    // ({ audited: false }) so the operator knows the trail has a hole in it.
    try {
      const entry = auditLog?.record({ area: 'provider', action, target, accountId: req.adminAccountId, outcome });
      if (auditLog && (!entry || entry.persisted === false)) {
        console.error('Provider audit entry could not be saved:', action, target);
        return { audited: false };
      }
    } catch (error) {
      console.error('Provider audit failed:', error?.message || 'unknown error');
      return { audited: false };
    }
    return {};
  }

  function requestedLabel(req) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return typeof body.label === 'string' ? body.label : (typeof body.name === 'string' ? body.name : '');
  }

  // Same order as /admin/ops: no-store on every answer, sign-in checked before
  // the body is parsed, so an anonymous caller gets a 401 and no parsing.
  router.use((_req, res, next) => { setAnalyticsNoStoreHeaders(res); next(); });
  router.use(requireAdmin);
  router.use(express.json({ limit: '12kb' }));

  router.get('/status', (_req, res) => {
    setAnalyticsNoStoreHeaders(res);
    return res.json({ success: true, ...manager.status() });
  });

  router.get('/providers', (_req, res) => {
    setAnalyticsNoStoreHeaders(res);
    const status = manager.status();
    return res.json({ success: true, active: manager.active(), providers: manager.list(), provider: status.provider, storage: status.storage });
  });

  router.post('/providers', writeGuard, (req, res) => {
    try {
      const profile = manager.upsert(req.body || {});
      const note = audit(req, 'create', profile.label, 'ok');
      setAnalyticsNoStoreHeaders(res);
      return res.status(201).json({ success: true, profile, ...note });
    } catch (error) {
      audit(req, 'create', requestedLabel(req), 'failed');
      return res.status(error instanceof ProviderConfigError ? 400 : 500).json(errorPayload(error));
    }
  });

  router.patch('/providers/:id', writeGuard, (req, res) => {
    try {
      const profile = manager.upsert({ ...(req.body || {}), id: req.params.id });
      const note = audit(req, 'update', profile.label, 'ok');
      setAnalyticsNoStoreHeaders(res);
      return res.json({ success: true, profile, ...note });
    } catch (error) {
      audit(req, 'update', labelFor(req.params.id), 'failed');
      return res.status(error instanceof ProviderConfigError ? 400 : 500).json(errorPayload(error));
    }
  });

  router.post('/providers/:id/test', writeGuard, async (req, res) => {
    try {
      const result = await manager.test(req.params.id);
      const note = audit(req, 'test', labelFor(req.params.id), result.ok ? 'ok' : 'failed');
      setAnalyticsNoStoreHeaders(res);
      // The probe finished after the profile was edited, so nothing was stored.
      if (result.stale) return res.status(409).json({ success: false, code: 'PROFILE_CHANGED', error: 'The profile changed while the test ran; run the test again.', test: result, ...note });
      return res.status(result.ok ? 200 : 502).json({ success: result.ok, test: result, profile: manager.list().find(profile => profile.id === req.params.id) || null, ...note });
    } catch (error) {
      audit(req, 'test', labelFor(req.params.id), 'failed');
      return res.status(error instanceof ProviderConfigError ? 400 : 500).json(errorPayload(error));
    }
  });

  router.post('/providers/:id/activate', writeGuard, (req, res) => {
    const label = labelFor(req.params.id);
    try {
      const profile = manager.activate(req.params.id);
      const note = audit(req, 'activate', label, 'ok');
      setAnalyticsNoStoreHeaders(res);
      return res.json({ success: true, active: profile, status: manager.status(), ...note });
    } catch (error) {
      audit(req, 'activate', label, 'failed');
      return res.status(error instanceof ProviderConfigError ? 409 : 500).json(errorPayload(error));
    }
  });

  router.delete('/providers/:id', writeGuard, (req, res) => {
    const label = labelFor(req.params.id);
    try {
      manager.remove(req.params.id);
      const note = audit(req, 'delete', label, 'ok');
      setAnalyticsNoStoreHeaders(res);
      return res.json({ success: true, ...note });
    } catch (error) {
      audit(req, 'delete', label, 'failed');
      return res.status(error instanceof ProviderConfigError ? 409 : 500).json(errorPayload(error));
    }
  });

  router.use(jsonBodyErrorHandler);

  app.use('/admin/ai', router);
  return router;
}
