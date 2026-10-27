// /admin/ops/*: the operator console's server surface. Same guard as
// /admin/ai/* (session, admin allow-list, same-origin, write rate limit) and
// every response is no-store, including the 401/403 refusals.
import express from 'express';
import { setAnalyticsNoStoreHeaders } from './analyticsApi.js';
import { createAdminGuard, jsonBodyErrorHandler } from './adminOpsGuard.js';
import { buildOpsBots, buildOpsRooms, buildOpsStatus } from './adminOpsReports.js';
import { summarizeRuntimeMetrics } from './metricsRegistry.js';
import { normalizeAnalyticsQuery } from './analyticsProjection.js';
import { cleanText, MAX_MESSAGE_LENGTH } from './maintenanceState.js';

const MODES = Object.freeze(['normal', 'draining', 'maintenance']);

// A drain deadline is armed with setTimeout, which treats a delay beyond about
// 24.8 days as 1 ms and would end the drain at once. Two weeks is far longer
// than any real drain and safely inside that limit.
export const MAX_DEADLINE_MS = 14 * 24 * 60 * 60 * 1000;

function parseDeadline(value, nowMs) {
  if (value === undefined || value === null || value === '') return { deadline: null };
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) return { error: 'The deadline is not a valid date.' };
  if (parsed <= nowMs) return { error: 'The deadline must be in the future.' };
  if (parsed - nowMs > MAX_DEADLINE_MS) return { error: 'The deadline must be within the next 14 days.' };
  return { deadline: new Date(parsed).toISOString() };
}

// The drain controller would quietly strip anything else out of a release id;
// the operator is told instead, so the id they typed is the id that is stored.
const RELEASE_ID = /^[A-Za-z0-9._-]{1,80}$/;

function parseReleaseId(value) {
  if (value === undefined || value === null || value === '') return { releaseId: undefined };
  if (typeof value !== 'string' || !RELEASE_ID.test(value.trim())) {
    return { error: 'The release ID may use letters, digits, dots, dashes and underscores, up to 80 characters.' };
  }
  return { releaseId: value.trim() };
}

export function registerAdminOpsRoutes(app, {
  accountStore = null,
  accountResolver = null,
  adminIds = [],
  publicOrigin = '',
  maintenance,
  auditLog = null,
  metrics = null,
  rollup = null,
  providerManager = null,
  roomManager = null,
  roomActivity,
  // True when POORUP_MAINTENANCE_PASSWORD is set (the value never comes here).
  operatorPassword = false,
  // () => { uptimeSeconds, sockets, rooms, activeRounds, backup, backupIntervalMs, storesLoaded, dataDirectory }
  readRuntime = () => ({}),
  now = () => Date.now(),
} = {}) {
  const router = express.Router();
  const { requireAdmin, writeGuard } = createAdminGuard({
    accountStore,
    accountResolver,
    adminIds,
    publicOrigin,
    writeLimitMessage: 'Too many changes. Try again shortly.',
    now,
  });

  function audit(req, target, outcome, action = 'mode') {
    // The action stands either way; an entry that was not saved is reported so
    // the operator knows the trail has a hole in it ({ audited: false }).
    try {
      const entry = auditLog?.record({ area: 'release', action, target, accountId: req.adminAccountId, outcome });
      if (auditLog && (!entry || entry.persisted === false)) {
        console.error('Admin audit entry could not be saved:', action, target);
        return { audited: false };
      }
    } catch (error) {
      console.error('Admin audit failed:', error?.message || 'unknown error');
      return { audited: false };
    }
    return {};
  }

  router.use((_req, res, next) => { setAnalyticsNoStoreHeaders(res); next(); });
  // Sign-in is checked before the body is parsed, so an anonymous caller learns
  // nothing from a malformed payload.
  router.use(requireAdmin);
  router.use(express.json({ limit: '4kb' }));

  router.get('/status', (_req, res) => {
    const runtime = readRuntime();
    return res.json(buildOpsStatus({
      now: now(),
      runtime,
      metrics: summarizeRuntimeMetrics(metrics),
      backup: runtime.backup,
      backupIntervalMs: runtime.backupIntervalMs,
      storage: { storesLoaded: runtime.storesLoaded, dataDirectory: runtime.dataDirectory, rollup: rollup?.health?.() },
      maintenance: maintenance?.snapshot?.() || null,
      operatorPassword: operatorPassword === true,
    }));
  });

  // Same transitions as the token-protected /internal/maintenance. Differences,
  // all about telling the operator the truth: a deadline that is unparseable or
  // already past is a 400 (the internal route accepts it and drains at once),
  // and asking for a drain while the table is in maintenance is a 409 because
  // the controller would otherwise answer 200 and change nothing.
  router.post('/maintenance', writeGuard, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const mode = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';
    if (!MODES.includes(mode)) {
      audit(req, 'invalid', 'failed');
      return res.status(400).json({ success: false, error: 'Choose normal, draining, or maintenance.' });
    }
    const parsed = mode === 'draining' ? parseDeadline(body.deadline, now()) : { deadline: null };
    const identified = mode === 'normal' ? {} : parseReleaseId(body.releaseId);
    const refusal = parsed.error || identified.error;
    if (refusal) {
      audit(req, mode, 'failed');
      return res.status(400).json({ success: false, error: refusal });
    }
    let snapshot;
    if (mode === 'draining') snapshot = maintenance.beginDrain({ releaseId: identified.releaseId, deadline: parsed.deadline, message: body.message });
    else if (mode === 'maintenance') snapshot = maintenance.enterMaintenance({ releaseId: identified.releaseId, message: body.message });
    else snapshot = maintenance.finishMaintenance();
    if (snapshot.mode !== mode) {
      audit(req, mode, 'failed');
      return res.status(409).json({ success: false, error: 'The table is in maintenance. Finish it before starting a drain.', maintenance: snapshot });
    }
    // The change is live but a restart would revert it: say so.
    const unsaved = maintenance.lastPersistFailed?.() === true;
    const note = audit(req, mode, unsaved ? 'failed' : 'ok');
    return res.json({ success: true, maintenance: snapshot, ...(unsaved ? { persisted: false } : {}), ...note });
  });

  // The "under maintenance" panel. On: maintenance with the public site closed
  // (sign-in by operator password or admin account). Off: the panel goes, the
  // table stays in maintenance; reopen:true goes straight back to normal.
  // Repeating either state answers 200 with the unchanged snapshot. The audit
  // entry is on/off/reopen only: never the message or the release id.
  router.post('/lockout', writeGuard, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const reopen = body.reopen === undefined ? false : body.reopen;
    if (typeof body.enabled !== 'boolean' || typeof reopen !== 'boolean' || (body.enabled && reopen)) {
      audit(req, 'invalid', 'failed', 'lockout');
      return res.status(400).json({ success: false, error: 'Send enabled: true or false (reopen: true only with enabled: false).' });
    }
    const target = body.enabled ? 'on' : (reopen ? 'reopen' : 'off');
    const identified = body.enabled ? parseReleaseId(body.releaseId) : {};
    if (identified.error) {
      audit(req, target, 'failed', 'lockout');
      return res.status(400).json({ success: false, error: identified.error });
    }
    let snapshot;
    if (body.enabled) snapshot = maintenance.setLockout(true, { releaseId: identified.releaseId, message: cleanText(body.message, MAX_MESSAGE_LENGTH) });
    else if (reopen) snapshot = maintenance.finishMaintenance();
    else snapshot = maintenance.setLockout(false);
    const unsaved = maintenance.lastPersistFailed?.() === true;
    const note = audit(req, target, unsaved ? 'failed' : 'ok', 'lockout');
    return res.json({ success: true, maintenance: snapshot, ...(unsaved ? { persisted: false } : {}), ...note });
  });

  router.get('/rooms', (_req, res) => {
    const rooms = roomManager?.rooms ? [...roomManager.rooms.values()] : [];
    roomActivity.observe(rooms);
    return res.json(buildOpsRooms({ rooms, tracker: roomActivity, now: now(), metrics: summarizeRuntimeMetrics(metrics) }));
  });

  router.get('/bots', (req, res) => {
    if (rollup?.health?.().loaded === false) return res.status(503).json({ success: false, error: 'Rollup unavailable.' });
    const range = normalizeAnalyticsQuery({ range: req.query?.range }).range;
    return res.json(buildOpsBots({ rollup, range, providerStatus: providerManager?.status?.() || null, now: now(), metrics: summarizeRuntimeMetrics(metrics) }));
  });

  router.get('/audit', (_req, res) => res.json({ success: true, entries: auditLog ? auditLog.list() : [] }));

  // Body-parser failures are the caller's fault; anything else goes to the
  // app's own error handler.
  router.use(jsonBodyErrorHandler);

  app.use('/admin/ops', router);
  return router;
}
