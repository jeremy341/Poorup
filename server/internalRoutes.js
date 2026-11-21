// Token-guarded routes for the deploy tooling: drain/maintenance mode changes and the retention job trigger. No account is involved.
import express from 'express';
import { asyncRoute } from './httpErrors.js';
import { resolveRetentionToken, tokensMatch } from './serverConfig.js';

export function registerInternalRoutes(app, { maintenance, adminAuditLog, retentionJob }) {
  const maintenanceToken = String(process.env.POORUP_MAINTENANCE_TOKEN || '').trim();
  // The token is checked before the body is parsed, so the route answers 404 when
  // it is not configured and 403 to a stranger whatever they send.
  function requireMaintenanceToken(req, res, next) {
    if (!maintenanceToken) return res.status(404).json({ success: false, error: 'Not found.' });
    if (!tokensMatch(req.get('x-poorup-maintenance-token'), maintenanceToken)) {
      return res.status(403).json({ success: false, error: 'Forbidden.' });
    }
    return next();
  }
  const unsavedNote = () => (maintenance.lastPersistFailed() ? { persisted: false } : {});
  // The internal route has no account behind it, so the audit entry carries a
  // stable internal actor: the same label for every token-held change, so the
  // log shows one actor and not a crowd of anonymous ones.
  const INTERNAL_MAINTENANCE_ACTOR = 'internal-maintenance';
  // Records one release-mode or lockout change. The log is best effort for the
  // change itself, but a change that was not recorded is reported: the operator
  // must know the trail has a hole in it.
  function auditMaintenance(action, target, outcome) {
    try {
      const entry = adminAuditLog?.record({ area: 'release', action, target, accountId: INTERNAL_MAINTENANCE_ACTOR, outcome });
      if (!entry) {
        console.error('Maintenance audit entry was rejected.');
        return { auditPersisted: false };
      }
      if (entry.persisted === false) {
        console.error('Maintenance audit entry could not be saved.');
        return { auditPersisted: false };
      }
      return {};
    } catch (error) {
      console.error('Maintenance audit failed:', error?.message || 'unknown error');
      return { auditPersisted: false };
    }
  }
  app.post('/internal/maintenance', requireMaintenanceToken, express.json({ limit: '4kb' }), (req, res) => {
    const mode = String(req.body?.mode || '').trim().toLowerCase();
    if (mode === 'draining') {
      const snapshot = maintenance.beginDrain({
        releaseId: req.body?.releaseId,
        deadline: req.body?.deadline,
        message: req.body?.message
      });
      // A drain asked for while the table is in maintenance changes nothing.
      const outcome = snapshot.mode === 'draining' ? 'ok' : 'failed';
      return res.status(200).json({ success: true, maintenance: snapshot, ...unsavedNote(), ...auditMaintenance('mode', 'draining', outcome) });
    }
    if (mode === 'maintenance') {
      // lockout: true|false turns the public "under maintenance" panel on or
      // off; absent, an existing lockout is kept.
      const wantedLockout = typeof req.body?.lockout === 'boolean' ? req.body.lockout : null;
      const snapshot = maintenance.enterMaintenance({
        releaseId: req.body?.releaseId,
        message: req.body?.message,
        lockout: wantedLockout === null ? undefined : wantedLockout
      });
      const action = wantedLockout === null ? 'mode' : 'lockout';
      const target = wantedLockout === null ? 'maintenance' : (wantedLockout ? 'on' : 'off');
      const outcome = wantedLockout === null
        ? (snapshot.mode === 'maintenance' ? 'ok' : 'failed')
        : (snapshot.lockout === wantedLockout ? 'ok' : 'failed');
      return res.status(200).json({ success: true, maintenance: snapshot, ...unsavedNote(), ...auditMaintenance(action, target, outcome) });
    }
    if (mode === 'normal') {
      const snapshot = maintenance.finishMaintenance();
      const outcome = snapshot.mode === 'normal' ? 'ok' : 'failed';
      return res.status(200).json({ success: true, maintenance: snapshot, ...unsavedNote(), ...auditMaintenance('mode', 'normal', outcome) });
    }
    return res.status(400).json({ success: false, error: 'Choose normal, draining, or maintenance.', ...auditMaintenance('mode', 'invalid', 'failed') });
  });

  function isRetentionAuthorized(req, token) {
    if (!token) return { authorized: false, status: 404, error: 'Not found.' };
    if (!tokensMatch(req.get('x-poorup-retention-token'), token)) return { authorized: false, status: 403, error: 'Forbidden.' };
    return { authorized: true };
  }

  app.post('/internal/retention/run', asyncRoute(async (req, res) => {
    const token = resolveRetentionToken(process.env);
    const auth = isRetentionAuthorized(req, token);
    if (!auth.authorized) return res.status(auth.status).json({ success: false, error: auth.error });
    const result = await retentionJob.runOnce();
    return res.status(200).json({ success: true, result: result || null });
  }));
}
