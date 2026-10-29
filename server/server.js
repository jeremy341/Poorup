// Server bootstrap: builds the HTTP and socket.io shell, the stores, and the shared socket runtime, then delegates every wire handler
// to the domain registration modules (account and room lifecycle, in-game verbs, social). Static UI serving, PORT binding and crash guards live here only.
import express from 'express';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { RoomManager } from './gameLogic.js';
import { AccountStore } from './accountStore.js';
import { SocialStore } from './socialStore.js';
import { MatchStore } from './matchStore.js';
import { AchievementStore } from './achievementStore.js';
import { createBotAdvisor } from './botAdvisor.js';
import { createSafeEmitter } from './socketHandlerSupport.js';
import { createSocialApi } from './socketSocialApi.js';
import { createRuntime } from './socketRuntime.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';
import { registerSocialSocketHandlers } from './serverSocketSocial.js';
import { assertProductionStoragePaths, resolveAuxiliaryStorePaths, resolveBackupDirectory, resolveDataDirectory, resolveRetiredStorePaths, resolveStorePaths } from './serverStorePaths.js';
import { TelemetryStore } from './telemetryModule.js';
import { assertProductionCors, createCorsOrigin, isAllowedSocketOrigin, parseAllowedOrigins, resolveClientAddress, resolveHandshakeSession, resolveRetentionToken, tokensMatch } from './serverConfig.js';
import { createSocketAdmission, createSocketRateLimiter } from './socketRateLimiter.js';
import { assertRateLimitConfig, createHttpRateLimiter } from './httpRateLimiter.js';
import { backupJsonStores, isBackupStoreCandidate } from './backupStore.js';
import { assertPersistenceMode } from './persistenceMode.js';
import { bootMaintenanceMode, bootMaintenanceRecord, corruptMaintenanceMarker, createDrainController, SHUTDOWN_RELEASE_ID, shutdownDrainMessage } from './drainController.js';
import { createMaintenanceAccess, registerMaintenanceAccessRoutes } from './maintenanceAccess.js';
import { createMetricsRegistry, instrumentHandler } from './metricsRegistry.js';
import { createAdminAuditLog } from './adminAuditLog.js';
import { registerAdminOpsRoutes } from './adminOpsRoutes.js';
import { createRoomActivityTracker } from './adminOpsReports.js';
import { buildAnalyticsBalance, buildAnalyticsDrilldown, buildAnalyticsSummary, normalizeAdminIds, setAnalyticsNoStoreHeaders, withAdminFlag } from './analyticsApi.js';
import { createPseudonymizer } from './analyticsPrivacy.js';
import { createAnalyticsRollupStore } from './analyticsRollupStore.js';
import { createMetadataRouter, gateIndexEnv, indexingApproved as isIndexingApproved, metadataConfig } from './metadata.js';
import { createStaticAssets } from './staticAssets.js';
import { asyncRoute, createHttpErrorHandler } from './httpErrors.js';
import { renderAboutPage } from './aboutPage.js';
import { renderErrorPage as errorPage } from './errorPage.js';
import { isQuarantinedStore, loadJson, writeJson } from './storeIO.js';
import { createAuthoritativeStore } from './authoritativeStore.js';
import { createPubSubAdapter } from './pubsubAdapter.js';
import { allowPrivateEndpointsFromEnv, createAiProviderManager, createAiProviderStore } from './aiProviderConfig.js';
import { registerAiProviderRoutes } from './aiProviderRoutes.js';
import { createSessionStore, parseCookieHeader, SESSION_COOKIE_NAME } from './sessionStore.js';
import { createMailAdapter } from './mailAdapter.js';
import { createAccountRecovery } from './accountRecovery.js';
import { createAccountDeletionCoordinator } from './accountDeletion.js';
import { buildAccountExport } from './accountExport.js';
import { RetiredAccountStore } from './retiredAccountStore.js';
import { createRetentionJob } from './retentionJob.js';
import { createBackupRetentionAdapter } from './backupStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Production must name absolute data and backup directories outside the
// release directory before any store is opened.
assertProductionStoragePaths(process.env);
assertPersistenceMode(process.env);
assertProductionCors(process.env);

const app = express();
const server = http.createServer(app);
let httpAccountResolver = () => null;
let httpAccountRights = null;
let httpAccountRecovery = null;
let httpRetentionJob = null;
const trustedProxyHops = Math.max(0, Math.floor(Number(process.env.POORUP_TRUST_PROXY_HOPS) || 0));
if (trustedProxyHops > 0) app.set('trust proxy', trustedProxyHops);
app.disable('x-powered-by');
const configuredSocketOrigins = parseAllowedOrigins(process.env);
const productionRuntime = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const configuredPublicOrigin = metadataConfig({ env: process.env, path: '/' }).origin;
const connectSources = configuredPublicOrigin
  ? ["'self'", configuredPublicOrigin]
  : (productionRuntime ? ["'self'"] : ["'self'", 'ws:', 'wss:']);
assertRateLimitConfig(process.env);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src ${connectSources.join(' ')}; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`);
  next();
});
// Static files are served before the HTTP rate limiter: one cold load is over a
// hundred requests, so counting them would 429 a third page load in a minute.
// A path that is not a file falls through and is counted like any other.
const publicPath = path.join(__dirname, '../public');
const staticAssets = createStaticAssets({ root: publicPath });
app.use(staticAssets.compressHtml);
app.use(staticAssets.compressedText);
app.use(express.static(publicPath, {
  etag: true,
  maxAge: '1h',
  // The metadata router below serves "/" so its per-route tags are not skipped.
  index: false,
  setHeaders: (response, filePath, stat) => staticAssets.setStaticHeaders(response, filePath, stat)
}));
const httpRateLimit = createHttpRateLimiter({ max: process.env.POORUP_HTTP_RATE_LIMIT, windowMs: process.env.POORUP_HTTP_RATE_WINDOW_MS, trustProxy: trustedProxyHops > 0 });
app.use((req, res, next) => {
  // Health probes bypass the limiter: a traffic burst must never make the
  // orchestrator restart a healthy pod with 429s.
  if (req.path === '/healthz' || req.path === '/readyz') return next();
  return httpRateLimit(req, res, next);
});
const socketRateLimiter = createSocketRateLimiter({
  max: process.env.POORUP_SOCKET_RATE_LIMIT,
  windowMs: process.env.POORUP_SOCKET_RATE_WINDOW_MS
});
const socketAdmission = createSocketAdmission({
  maxConnections: process.env.POORUP_SOCKET_MAX_CONNECTIONS,
  maxHandshakes: process.env.POORUP_SOCKET_HANDSHAKE_RATE,
  windowMs: process.env.POORUP_SOCKET_HANDSHAKE_WINDOW_MS
});
if (process.env.NODE_ENV === 'production' && !String(process.env.POORUP_ALLOWED_ORIGINS || '').trim()) {
  console.warn('POORUP_ALLOWED_ORIGINS is unset; browser-origin Socket.IO requests are blocked until an allow-list is configured.');
}
function isOriginAllowedForSocket(origin) {
  if (configuredSocketOrigins.length) return isAllowedSocketOrigin(origin, configuredSocketOrigins);
  if (!productionRuntime) return true;
  return !origin;
}

function isPeerAllowedForSocket(request) {
  const peerKey = resolveClientAddress({ request }, trustedProxyHops);
  return socketAdmission.allow(peerKey, io?.engine?.clientsCount || 0);
}

const io = new Server(server, {
  cors: { origin: createCorsOrigin(process.env) },
  allowRequest: (request, callback) => {
    const allowedOrigin = isOriginAllowedForSocket(request?.headers?.origin);
    const allowed = allowedOrigin && isPeerAllowedForSocket(request);
    if (!allowed) metrics?.incrementMetric('socket-admission-rejections', { scope: 'handshake' });
    callback(null, allowed);
  },
  // All game payloads are compact (an avatar is at most 8×8 cells). Keep
  // oversized Socket.IO packets from consuming memory before the per-event
  // rate limiter gets a chance to reject them.
  maxHttpBufferSize: 100_000
});

// The supplied plain-client project is the production static UI. Keep the
// protected SVG references in public/assets and serve the HTML/CSS/JS directly.
const roomManager = new RoomManager();
const metrics = createMetricsRegistry();
metrics.initializeCounter('restore-failures', { source: 'room-session' });
const adminAccountIds = normalizeAdminIds(process.env.POORUP_ADMIN_ACCOUNT_IDS);
const dataDirectory = resolveDataDirectory(process.env);
const maintenanceFile = dataDirectory ? path.join(dataDirectory, 'maintenance.json') : null;
// The whole store envelope is kept, not only its value: a corrupt file must
// reach the controller as corrupt, so it can fail closed instead of arriving
// as "no file at all" and booting the table wide open.
const persistedMaintenanceStore = maintenanceFile
  ? loadJson(maintenanceFile, value => value && typeof value === 'object' && typeof value.mode === 'string')
  : null;
// A corrupt maintenance file is quarantined, which leaves no valid record behind: the next boot would find no file and fall back
// to the environment default with the site open. A durable closed marker replaces the corrupt bytes, so corruption fails closed on
// every restart. If the marker cannot be made durable, the server refuses to start rather than serve an open table.
const corruptMaintenance = persistedMaintenanceStore?.corrupt === true ? corruptMaintenanceMarker() : null;
if (corruptMaintenance) {
  try {
    writeJson(maintenanceFile, corruptMaintenance);
  } catch (error) {
    console.error('Maintenance state was corrupt and the closed marker could not be saved; refusing to start.');
    throw new Error('Maintenance state could not be recovered; refusing to start.', { cause: error });
  }
  console.error('Maintenance state was corrupt; the table stays closed until an operator reopens it.');
}
const persistedMaintenance = corruptMaintenance ?? bootMaintenanceRecord(persistedMaintenanceStore);
// Operator sign-in for the maintenance lockout (see maintenanceAccess.js).
// The password is read once here and only its digest is kept.
const maintenanceAccess = createMaintenanceAccess({
  password: process.env.POORUP_MAINTENANCE_PASSWORD,
  cookieSecret: process.env.POORUP_MAINTENANCE_COOKIE_SECRET,
  ttlMs: process.env.POORUP_MAINTENANCE_ACCESS_TTL_MS,
});
if (maintenanceAccess.enabled && String(process.env.POORUP_MAINTENANCE_PASSWORD).trim().length < 12) {
  console.warn('POORUP_MAINTENANCE_PASSWORD is shorter than 12 characters; choose a longer one.');
}
const bootMode = bootMaintenanceMode(persistedMaintenanceStore, process.env.POORUP_MAINTENANCE_MODE);
// Each socket gets its own copy of the state with its own bypass flag, so the
// broadcast is per socket. Until the runtime exists nobody has a bypass.
let publishMaintenanceState = snapshot => io.emit('maintenance-state', { ...snapshot, bypass: false });
const maintenance = createDrainController({
  initialMode: bootMode,
  // The operator's release id, message and deadline come back with the mode, and
  // a drain deadline that is still pending is re-armed.
  initialState: persistedMaintenance,
  // A persisted lockout survives a restart with the maintenance window it belongs to.
  initialLockout: bootMode === 'maintenance' && persistedMaintenance?.mode === 'maintenance' && persistedMaintenance?.lockout === true,
  getActiveRounds: () => [...roomManager.rooms.values()].filter(room => room.game.started && !room.destroyed).length,
  onChange: (snapshot, { persist = true } = {}) => {
    metrics.incrementMetric('maintenance-transitions', { state: snapshot.mode });
    let persisted = true;
    if (maintenanceFile && persist) {
      try { writeJson(maintenanceFile, snapshot); } catch (error) { persisted = false; console.error('Maintenance state persist failed:', error?.message || 'unknown error'); }
    }
    publishMaintenanceState(snapshot);
    // false tells the controller (and so the operator console) the change is
    // live but would not survive a restart.
    return persisted;
  }
});
// Provider-neutral seams are inert in the current single-process runtime. They make the PostgreSQL and Redis migration explicit
// without changing any socket payload or introducing a second room authority.
const authoritativeStore = createAuthoritativeStore({
  filePath: dataDirectory ? path.join(dataDirectory, 'rooms.json') : ''
});
const pubsubAdapter = createPubSubAdapter();
const analyticsPseudonymKey = String(process.env.POORUP_ANALYTICS_PSEUDONYM_KEY || '').trim();
const analyticsRollupStore = createAnalyticsRollupStore({
  filePath: dataDirectory ? path.join(dataDirectory, 'analytics-rollup.json') : null,
  pseudonymizer: createPseudonymizer({ key: analyticsPseudonymKey })
});
// Operator change log (provider profiles, release mode). Persisted beside the
// other stores when a data directory exists; the actor is a keyed pseudonym.
const adminAuditLog = createAdminAuditLog({
  filePath: dataDirectory ? path.join(dataDirectory, 'admin-audit.json') : '',
  key: analyticsPseudonymKey
});
// Rooms carry no creation time, so a short timer stamps first sight and the
// last visible progress for the Rooms tab (see adminOpsReports.js).
const roomActivity = createRoomActivityTracker();
const roomActivityTimer = setInterval(() => roomActivity.observe(roomManager.rooms.values()), 5_000);
roomActivityTimer.unref?.();
let storesLoaded = false;
let backupHealth = { configured: false, fresh: true, lastRunAt: null, failures: 0 };
let backupIntervalMs = null;
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
// GET/POST /maintenance/unlock and POST /maintenance/logout. Mounted before the
// metadata router and static files so the 404 for an unset password is JSON.
registerMaintenanceAccessRoutes(app, {
  access: maintenanceAccess,
  publicOrigin: configuredPublicOrigin,
  forceSecure: productionRuntime || String(process.env.POORUP_COOKIE_SECURE || '').toLowerCase() === 'true',
  trustProxy: trustedProxyHops > 0
});
// An analytics call can be the first to trade a legacy bearer token for a cookie
// session; the cookie must reach the caller or the token is spent for nothing.
function analyticsAccount(req, res) {
  const account = httpAccountResolver(req) || accountStore.sessionAccount(req.get('x-poorup-session-token') || '');
  if (req.sessionCookie) res.setHeader('Set-Cookie', req.sessionCookie);
  return account;
}
app.get('/admin/analytics/summary', (req, res) => {
  const account = analyticsAccount(req, res);
  const result = buildAnalyticsSummary(metrics, account?.id, adminAccountIds, req.query?.range);
  setAnalyticsNoStoreHeaders(res);
  return res.status(result.success ? 200 : result.status).json(result);
});
app.get('/admin/analytics/balance', (req, res) => {
  const account = analyticsAccount(req, res);
  const result = buildAnalyticsBalance({
    rollup: analyticsRollupStore,
    registry: metrics,
    accountId: account?.id,
    adminIds: adminAccountIds,
    query: req.query
  });
  setAnalyticsNoStoreHeaders(res);
  return res.status(result.success ? 200 : result.status).json(result);
});
app.get('/admin/analytics/drilldown', (req, res) => {
  const account = analyticsAccount(req, res);
  const result = buildAnalyticsDrilldown({
    rollup: analyticsRollupStore,
    accountId: account?.id,
    adminIds: adminAccountIds,
    query: req.query
  });
  setAnalyticsNoStoreHeaders(res);
  return res.status(result.success ? 200 : result.status).json(result);
});

// Metadata is mounted before static serving so per-route tags cannot be
// swallowed by express.static's index fallback.
// Page tags follow the same two-key gate as robots.txt (see gateIndexEnv).
const pageEnv = gateIndexEnv(process.env);
app.use(createMetadataRouter({ env: pageEnv, indexFile: path.join(publicPath, 'index.html') }));

// A plain, crawlable page that explains the game in words (also feeds the FAQ rich result).
app.get('/about', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderAboutPage({ env: pageEnv }));
});

const metadataOrigin = metadataConfig({ env: process.env, path: '/' }).origin;
const indexingApproved = isIndexingApproved(process.env);
app.get('/sitemap.xml', (_req, res, next) => {
  if (!indexingApproved) return next();
  const publicRoutes = ['/', '/about', '/rules'];
  const escapeXml = value => String(value).replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]));
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicRoutes.map(route => `<url><loc>${escapeXml(`${metadataOrigin}${route}`)}</loc></url>`).join('')}</urlset>`;
  return res.type('application/xml').send(body);
});
app.get('/account/session', (req, res) => {
  const account = httpAccountResolver(req);
  if (!account) return res.status(401).json({ success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in again.' });
  if (req.sessionCookie) res.setHeader('Set-Cookie', req.sessionCookie);
  return res.json({ success: true, account: withAdminFlag(accountStore.getAccountSnapshot(account.id), adminAccountIds) });
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
  const result = await httpRetentionJob?.runOnce?.();
  return res.status(200).json({ success: true, result: result || null });
}));
app.get('/account/export', (req, res) => {
  const account = httpAccountResolver(req);
  if (!account || !httpAccountRights?.export) return res.status(401).json({ success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to download your account data.' });
  try {
    const result = httpAccountRights.export({ account, req });
    if (req.sessionCookie) res.setHeader('Set-Cookie', req.sessionCookie);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.type('application/json').status(200).send(JSON.stringify(result.document));
  } catch {
    return res.status(500).json({ success: false, code: 'ACCOUNT_EXPORT_FAILED', error: 'Account export is temporarily unavailable.' });
  }
});
// Saves the signed-in player's face and colour. The sign-in token is exchanged for a cookie session (which revokes the token), so a
// socket opened before sign-in can no longer prove who it is; this endpoint authenticates with the cookie. Only the two appearance
// fields are accepted, and the JSON content type keeps it out of reach of cross-site form posts.
app.post('/account/profile', express.json({ limit: '8kb' }), (req, res) => {
  const account = httpAccountResolver(req);
  if (!account) return res.status(401).json({ success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in again.' });
  if (account.accountDeactivated === true) return res.status(403).json({ success: false, error: 'This account is restricted.' });
  if (req.sessionCookie) res.setHeader('Set-Cookie', req.sessionCookie);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const patch = {};
  if (typeof body.color === 'string') patch.color = body.color;
  if (Array.isArray(body.avatarGrid)) patch.avatarGrid = body.avatarGrid;
  if (!Object.keys(patch).length) return res.status(400).json({ success: false, error: 'Nothing to save.' });
  const result = accountStore.updateProfileForAccount(account, patch);
  res.setHeader('Cache-Control', 'no-store');
  if (!result?.success) return res.status(400).json({ success: false, error: result?.error || 'Could not save.' });
  return res.json({ success: true, account: withAdminFlag(accountStore.getAccountSnapshot(result.account.id), adminAccountIds) });
});
app.post('/account/logout', (req, res) => {
  const cookies = parseCookieHeader(req.headers.cookie || '');
  const legacyToken = req.get('x-poorup-session-token') || '';
  try {
    // Revoke the bearer first so any exchange started after this request cannot
    // mint a new cookie. The cookie lineage covers exchanges that completed
    // just before logout but whose Set-Cookie response has not arrived yet.
    if (legacyToken) accountStore.logout(legacyToken);
    sessionStore.revoke(cookies[SESSION_COOKIE_NAME]);
    if (legacyToken) {
      if (typeof sessionStore.revokeLegacyTokenSessions !== 'function') throw new Error('Legacy session lineage is unavailable.');
      sessionStore.revokeLegacyTokenSessions(legacyToken);
    }
  } catch {
    return res.status(503).json({ success: false, code: 'ACCOUNT_LOGOUT_FAILED', error: 'Sign out could not be completed.' });
  }
  res.setHeader('Set-Cookie', sessionStore.clearCookie());
  return res.json({ success: true });
});
// Mail links land on a confirmation page first. Only the POST consumes the
// single-use token, so a mail scanner that prefetches the link cannot burn it.
const recoveryFormParsers = [express.urlencoded({ extended: false, limit: '8kb' }), express.json({ limit: '8kb' })];
function recoveryToken(req) {
  const source = req.method === 'GET' ? req.query : req.body;
  return typeof source?.token === 'string' ? source.token : '';
}
app.get('/account/recovery/verify', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = recoveryToken(req);
  return res.type('html').send(errorPage('Confirm recovery email', 'Confirm this address to use it for password recovery.', `<form method="post" action="/account/recovery/verify"><input type="hidden" name="token" value="${escapeHtmlText(token)}"><button type="submit">CONFIRM RECOVERY EMAIL</button></form>`));
});
app.post('/account/recovery/verify', ...recoveryFormParsers, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const verified = await httpAccountRecovery?.consumeEmailVerification?.(recoveryToken(req));
  return res.status(verified ? 200 : 400).type('html').send(errorPage(verified ? 'Recovery email verified' : 'Recovery link expired', verified ? 'Your recovery email is now active. Return to the parlor.' : 'That single-use link is invalid or expired.'));
}));
app.post('/account/recovery/request', express.json({ limit: '8kb' }), asyncRoute(async (req, res) => {
  const result = await httpAccountRecovery?.requestPasswordReset?.({ username: req.body?.username, email: req.body?.email });
  // Uniform response: the sent flag would otherwise oracle valid
  // username+email pairs to enumerators.
  void result;
  return res.status(200).json({ success: true, sent: true });
}));
app.get('/account/recovery/reset', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = recoveryToken(req);
  return res.type('html').send(errorPage('Set a new password', 'Choose a new password. This link works once.', `<form method="post" action="/account/recovery/reset"><input type="hidden" name="token" value="${escapeHtmlText(token)}"><label>New password <input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></label><button type="submit">SET NEW PASSWORD</button></form>`));
});
app.post('/account/recovery/reset', ...recoveryFormParsers, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const reset = await httpAccountRecovery?.consumePasswordReset?.(recoveryToken(req), req.body?.newPassword);
  if (req.is('application/x-www-form-urlencoded')) {
    return res.status(reset ? 200 : 400).type('html').send(errorPage(reset ? 'Password updated' : 'Reset link expired', reset ? 'Your password is updated. Sign in from the parlor.' : 'That single-use link is invalid or expired.'));
  }
  return res.status(reset ? 200 : 400).json(reset ? { success: true } : { success: false, code: 'RECOVERY_TOKEN_INVALID', error: 'That reset link is invalid or expired.' });
}));
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'poorup', releaseId: process.env.POORUP_RELEASE_ID || 'local' });
});
function isBackupReady() {
  return !backupHealth.configured || backupHealth.fresh;
}

function isSystemReady(snapshot) {
  if (snapshot.mode !== 'normal') return false;
  if (!storesLoaded) return false;
  if (!isBackupReady()) return false;
  return true;
}

function readinessStatus(snapshot, ready) {
  if (ready) return 'ready';
  if (snapshot.mode === 'draining') return 'draining';
  return 'unavailable';
}

// A lobby that is not started but holds a human seat is waiting for its round.
// A reload drops it, so the deploy gate waits for these as well as for rounds.
function countWaitingRooms() {
  return [...roomManager.rooms.values()].filter(room => !room.destroyed && !room.game.started && room.game.players.some(player => !player.isBot)).length;
}

function buildReadinessPayload(snapshot, rollupHealth, ready) {
  return {
    status: readinessStatus(snapshot, ready),
    acceptingNewRounds: snapshot.mode === 'normal',
    activeRounds: snapshot.activeRounds,
    waitingRooms: countWaitingRooms(),
    storeLoaded: storesLoaded,
    backupConfigured: backupHealth.configured,
    backupFresh: backupHealth.configured ? backupHealth.fresh : null,
    analyticsRollup: { loaded: rollupHealth.loaded, fresh: rollupHealth.fresh, lagSeconds: rollupHealth.lagSeconds, pendingWrites: rollupHealth.pendingWrites },
    releaseId: snapshot.releaseId || process.env.POORUP_RELEASE_ID || 'local'
  };
}

app.get('/readyz', (_req, res) => {
  const snapshot = maintenance.snapshot();
  const rollupHealth = analyticsRollupStore.health();
  const ready = isSystemReady(snapshot);
  res.status(ready ? 200 : 503).json(buildReadinessPayload(snapshot, rollupHealth, ready));
});
app.get('/robots.txt', (_req, res) => {
  if (!indexingApproved) return res.type('text').send('User-agent: *\nDisallow: /\n');
  return res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /game/\n\nSitemap: ${metadataOrigin}/sitemap.xml\n`);
});
const SPA_PATHS = new Set(['/', '/play', '/rooms', '/profile', '/rankings', '/social', '/rules', '/admin/analytics']);
function isStaticRequest(requestPath) {
  return requestPath.startsWith('/assets/')
    || requestPath.startsWith('/themes/')
    || requestPath.startsWith('/client')
    || requestPath === '/styles.css'
    || requestPath === '/favicon.svg';
}
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next();
  if (!SPA_PATHS.has(req.path) || isStaticRequest(req.path)) return next();
  res.sendFile(path.join(publicPath, 'index.html'), err => {
    if (err) next(err);
  });
});
function escapeHtmlText(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

const storePaths = resolveStorePaths(process.env);
const auxiliaryStorePaths = resolveAuxiliaryStorePaths(process.env);
const retiredStorePaths = resolveRetiredStorePaths(process.env);
// Every JSON store holding game or account data is backed up from this set, except sessions.json and recovery-tokens.json (restoring them
// would resurrect revoked sessions and consumed single-use tokens), maintenance.json (it would re-impose an ended drain) and rooms.json (no runtime writer yet).
// The operator audit trail is backed up too: without a copy, a lost or corrupt file erases every release, lockout and provider change record.
const allStorePaths = {
  ...storePaths,
  ...auxiliaryStorePaths,
  ...retiredStorePaths,
  ...(dataDirectory ? { adminAudit: path.join(dataDirectory, 'admin-audit.json') } : {}),
};
const accountStore = new AccountStore(storePaths.accounts);
const socialStore = new SocialStore(storePaths.social);
const matchStore = new MatchStore(storePaths.matches);
const achievementStore = new AchievementStore(storePaths.achievements);
const retiredAccountStore = new RetiredAccountStore({
  seasonsPath: retiredStorePaths.seasons,
  cosmeticsPath: retiredStorePaths.cosmetics,
});
const telemetryStore = new TelemetryStore(auxiliaryStorePaths.telemetry, { rollupStore: analyticsRollupStore });
storesLoaded = true;
const sessionStore = createSessionStore({
  filePath: dataDirectory ? path.join(dataDirectory, 'sessions.json') : '',
  secure: productionRuntime || String(process.env.POORUP_COOKIE_SECURE || '').toLowerCase() === 'true'
});
io.use((socket, next) => {
  const cookies = parseCookieHeader(socket.handshake?.headers?.cookie || socket.request?.headers?.cookie || '');
  const session = resolveHandshakeSession(value => sessionStore.resolve(value), cookies[SESSION_COOKIE_NAME]);
  if (session) {
    socket.data.sessionId = session.sessionId;
    socket.data.sessionAccountId = session.accountId;
  }
  // The operator cookie is read once, at the handshake. A socket opened before
  // sign-in must reconnect to pick it up; expiry and logout are checked live.
  socket.data.maintenanceAccess = maintenanceAccess.grantFromCookieHeader(socket.handshake?.headers?.cookie || socket.request?.headers?.cookie || '');
  next();
});
// The provider key is trimmed before use: a whitespace-only key is no key, and the adapter must not report itself configured with one
// (nor send it in an Authorization header). A key with a control character cannot be sent in a header either, so it also counts as no key.
const mailApiKey = (() => {
  const key = String(process.env.POORUP_MAIL_API_KEY || '').trim();
  return /[\u0000-\u001f\u007f]/.test(key) ? '' : key;
})();
const mailAdapter = createMailAdapter({ env: process.env, config: { apiKey: mailApiKey } });
const accountRecovery = createAccountRecovery({
  accountStore,
  mailAdapter,
  sessionStore,
  publicOrigin: configuredPublicOrigin || '',
  filePath: dataDirectory ? path.join(dataDirectory, 'recovery-tokens.json') : ''
});
// Node's timers take their delay as a 32-bit signed integer: anything above 2^31-1 ms silently becomes 1 ms, so an oversized interval
// would run the job on every tick instead of once in a while. Every interval is bounded before it is scheduled.
const MAX_TIMER_DELAY_MS = 2_147_483_647;
// Bounds a delay that comes from the environment. A value the job cannot use
// (not a number, zero or negative) is passed through untouched, so the job
// keeps applying its own default and its own floor.
function boundedTimerDelay(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return value;
  return Math.min(MAX_TIMER_DELAY_MS, Math.floor(number));
}
const backupDirectory = resolveBackupDirectory(process.env);
if (backupDirectory) {
  backupHealth = { configured: true, fresh: false, lastRunAt: null, failures: 0 };
  const intervalMs = Math.min(MAX_TIMER_DELAY_MS, Math.max(60_000, Number(process.env.POORUP_BACKUP_INTERVAL_MS) || 15 * 60 * 1000));
  backupIntervalMs = intervalMs;
  const runBackup = () => {
    try {
      // Fresh volume with no stores yet is vacuously fresh: there is
      // nothing to lose, so readiness must not 503 forever.
      const storeFiles = Object.values(allStorePaths).filter(value => typeof value === 'string');
      const existingFiles = new Set(storeFiles.filter(file => { try { return isBackupStoreCandidate(file); } catch { return isQuarantinedStore(file); } }));
      if (!existingFiles.size) {
        backupHealth = { ...backupHealth, fresh: true, lastRunAt: new Date().toISOString() };
        return;
      }
      // Back up only stores that exist yet. A store that has never been
      // written (e.g. cosmetics before the first purchase) must not fail
      // the whole rotation or wedge readiness on an otherwise healthy host.
      const presentPaths = Object.fromEntries(
        Object.entries(allStorePaths).filter(([, filePath]) => existingFiles.has(filePath))
      );
      const result = backupJsonStores(presentPaths, backupDirectory);
      backupHealth = { ...backupHealth, fresh: result.success, lastRunAt: new Date().toISOString(), failures: result.success ? backupHealth.failures : backupHealth.failures + 1 };
      if (!result.success) {
        metrics.incrementMetric('backup-failures', { scope: 'all' });
        console.error('Backup rotation failed: one or more stores could not be copied.');
      }
    } catch (error) {
      metrics.incrementMetric('backup-failures', { scope: 'all' });
      backupHealth = { ...backupHealth, fresh: false, lastRunAt: new Date().toISOString(), failures: backupHealth.failures + 1 };
      console.error('Backup rotation failed:', error);
    }
  };
  runBackup();
  const backupTimer = setInterval(runBackup, intervalMs);
  backupTimer.unref?.();
}
const botAdvisor = createBotAdvisor();
const aiProviderStore = createAiProviderStore({
  filePath: auxiliaryStorePaths.aiProviders || '',
  masterKey: process.env.POORUP_AI_CONFIG_KEY,
  production: productionRuntime,
  allowPrivateEndpoints: !productionRuntime || allowPrivateEndpointsFromEnv(process.env)
});
const aiProviderManager = createAiProviderManager({ store: aiProviderStore, advisor: botAdvisor, env: process.env });
registerAiProviderRoutes(app, { manager: aiProviderManager, accountStore, accountResolver: requestAccount, adminIds: adminAccountIds, publicOrigin: configuredPublicOrigin, auditLog: adminAuditLog });
registerAdminOpsRoutes(app, {
  accountStore,
  accountResolver: requestAccount,
  adminIds: adminAccountIds,
  publicOrigin: configuredPublicOrigin,
  maintenance,
  auditLog: adminAuditLog,
  metrics,
  rollup: analyticsRollupStore,
  providerManager: aiProviderManager,
  roomManager,
  roomActivity,
  operatorPassword: maintenanceAccess.enabled,
  readRuntime: () => ({
    uptimeSeconds: process.uptime(),
    sockets: io.sockets.sockets.size,
    rooms: roomManager.rooms.size,
    activeRounds: maintenance.activeRoundCount(),
    backup: backupHealth,
    backupIntervalMs,
    storesLoaded,
    dataDirectory: Boolean(dataDirectory)
  })
});

app.use((_req, res) => res.status(404).type('html').send(errorPage('404 · Table not found', 'That route is not part of this parlor.')));
app.use(createHttpErrorHandler({ metrics, errorPage }));

const social = createSocialApi({ io, accountStore, socialStore, matchStore, achievementStore, sessionStore });
const achievementMirrorReconciliation = social.reconcileAchievementMirrors();
if (achievementMirrorReconciliation.failed) {
  console.error(`Achievement mirror reconciliation incomplete: ${achievementMirrorReconciliation.failed} record(s) could not be repaired.`);
}
social.startAchievementReconciliation();
const runtime = createRuntime({ io, roomManager, accountStore, socialStore, matchStore, achievementStore, telemetryStore, botAdvisor, social, maintenance, maintenanceAccess, metrics, authoritativeStore, pubsubAdapter });
runtime.sessionStore = sessionStore;
runtime.adminIds = adminAccountIds;
publishMaintenanceState = snapshot => runtime.broadcastMaintenanceState(snapshot);
// Erasure reaches backup copies and the .corrupt-* copies written beside the
// live stores, so it exists even when no backup directory is configured.
const erasureBackups = createBackupRetentionAdapter(backupDirectory, { storeFiles: Object.values(allStorePaths).filter(value => typeof value === 'string') });
const accountDeletion = createAccountDeletionCoordinator({
  accountStore,
  sessionStore,
  roomManager,
  // Recovery tokens hold the account's address, so they go with the account.
  stores: [accountRecovery],
  socialStore,
  matchStore,
  achievementStore,
  retiredStore: retiredAccountStore,
  telemetryStore,
  analyticsRollupStore,
  backupStore: erasureBackups,
  mailAdapter,
  onLifecycle: event => io.sockets.sockets.forEach(candidate => { if (candidate.data?.accountId === event.accountId) candidate.emit('account-lifecycle', { state: event.state }); })
});
const retentionJob = createRetentionJob({
  deletionCoordinator: accountDeletion,
  recovery: accountRecovery,
  analyticsRollupStore,
  telemetryStore,
  backupStore: backupDirectory ? createBackupRetentionAdapter(backupDirectory) : null,
  intervalMs: boundedTimerDelay(process.env.POORUP_RETENTION_INTERVAL_MS),
  analyticsRetentionMs: process.env.POORUP_RETENTION_ANALYTICS_MS,
  backupRetentionMs: process.env.POORUP_RETENTION_BACKUPS_MS
});
runtime.accountRights = {
  export: ({ account }) => {
    const document = buildAccountExport({
      account,
      social: socialStore.listFor(account.id),
      retiredData: retiredAccountStore.exportForAccount(account.id),
      matches: matchStore.listForAccount(account.id)
    });
    return { success: true, filename: `poorup-account-export-${account.username}.json`, contentType: 'application/json', document };
  },
  // Keeps only the caller's own sessions. A socket without a cookie session
  // (bearer-only) keeps none, so every cookie session of the account is revoked.
  revokeSessions: ({ account, payload, socket }) => ({ success: true, revoked: accountStore.revokeSessionsForAccount(account.id, true, payload?.sessionToken || null) + sessionStore.revokeAccountSessionsExcept(account.id, socket?.data?.sessionId || null) }),
  requestDeletion: async input => {
    const result = await accountDeletion.request(input);
    if (result?.success) {
      io.sockets.sockets.forEach(candidate => { if (candidate.data?.accountId === input.accountId) candidate.emit('account-lifecycle', { state: 'deletion-pending', dueAt: result.dueAt || null, requestId: result.requestId || null }); });
    }
    return result;
  },
  cancelDeletion: async input => {
    const result = await accountDeletion.cancel(input);
    if (result?.success) {
      io.sockets.sockets.forEach(candidate => { if (candidate.data?.accountId === input.accountId) candidate.emit('account-lifecycle', { state: 'deletion-cancelled' }); });
    }
    return result;
  },
  requestRecoveryEmail: input => accountRecovery.requestEmailVerification(input),
  verifyRecoveryEmail: input => accountRecovery.consumeEmailVerification(input.token, { accountId: input.accountId })
};
function accountFromCookie(req) {
  const cookies = parseCookieHeader(req.headers.cookie || '');
  const session = sessionStore.resolve(cookies[SESSION_COOKIE_NAME]);
  if (!session?.accountId) return null;
  return accountStore.getAccountById(session.accountId);
}

function accountFromLegacyToken(req) {
  const legacy = req.get('x-poorup-session-token') || '';
  if (!legacy) return null;
  const account = accountStore.sessionAccount(legacy);
  if (!account) return null;
  return { legacy, account };
}

function maybeExchangeLegacy(req, legacy, account) {
  const exchanged = sessionStore.exchangeLegacy(legacy, token => accountStore.sessionAccount(token)?.id || null);
  if (!exchanged) return;
  req.sessionCookie = sessionStore.cookie(exchanged.cookieValue);
  accountStore.revokeSessionToken?.(legacy);
}

function requestAccount(req) {
  const cookieAccount = accountFromCookie(req);
  if (cookieAccount) return cookieAccount;
  const legacyResult = accountFromLegacyToken(req);
  if (!legacyResult) return null;
  maybeExchangeLegacy(req, legacyResult.legacy, legacyResult.account);
  return legacyResult.account;
}
httpAccountResolver = requestAccount;
httpAccountRights = runtime.accountRights;
httpAccountRecovery = accountRecovery;
httpRetentionJob = retentionJob;
retentionJob.runOnce().catch(error => console.error('Retention job failed:', error?.message || 'unknown error'));
retentionJob.start();

io.on('connection', (socket) => {
  console.log('A socket connected:', socket.id);

  // The peer key outlives the socket: a reconnect gets a new socket id but the
  // same address, so the peer budget keeps counting across reconnects.
  const peerKey = resolveClientAddress({ address: socket.handshake?.address, headers: socket.handshake?.headers, request: socket.request }, trustedProxyHops);
  const safeOn = createSafeEmitter(socket, {
    allow: socketId => socketRateLimiter.allow(socketId, peerKey),
    onAccepted: (socketId, eventName) => runtime.noteSocketEvent(socketId, eventName),
  });
  // Times every handler for the admin status (P95 latency) and counts the ones
  // that throw (error rate) without changing what the handler does or returns.
  const on = (event, handler) => safeOn(event, instrumentHandler(metrics, handler));
  registerAccountSocketHandlers(on, socket, runtime);
  registerGameSocketHandlers(on, socket, runtime);
  registerSocialSocketHandlers(on, socket, runtime);
  socket.emit('bot-provider-status', runtime.botProviderStatus?.() || { state: 'unconfigured', revision: 0, reason: 'missing-credentials' });
  socket.emit('maintenance-state', runtime.maintenanceStateFor(socket));
  metrics.setMetric('active-sockets', io.sockets.sockets.size, { scope: 'all' });
  metrics.setMetric('active-rooms', roomManager.rooms.size, { scope: 'all' });
  metrics.setMetric('active-rounds', maintenance.activeRoundCount(), { scope: 'all' });

  socket.on('disconnect', () => {
    // No limiter.forget(): the per-peer event budget must survive reconnects for the rest of its window. The per-socket bucket dies with
    // the socket, which is why the peer budget exists; handshake admission bounds how fast new sockets can be created.
    runtime.handleSocketDisconnect(socket);
    metrics.setMetric('active-sockets', io.sockets.sockets.size, { scope: 'all' });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log('Server is running!');
  console.log('Visit http://localhost:' + PORT);
});

let shutdownStarted = false;
function shutdownDeadline() {
  const drainMs = Math.max(1_000, Math.min(15 * 60_000, Number(process.env.POORUP_SHUTDOWN_DRAIN_MS) || 30_000));
  return Date.now() + drainMs;
}

function disposeRuntimeResources() {
  clearInterval(roomActivityTimer);
  social.dispose?.();
  maintenance.dispose();
  retentionJob.stop();
  runtime.unsubscribeBotProviderStatus?.();
  runtime.stopAuctionWatchdog?.();
  pubsubAdapter.close?.();
}

async function flushTelemetryStore() {
  try { await telemetryStore.close?.(); } catch (error) { console.error('Telemetry flush failed:', error?.message || 'unknown error'); }
}

async function flushAnalyticsRollupStore() {
  try { await analyticsRollupStore.close?.(); } catch (error) { console.error('Analytics rollup flush failed:', error?.message || 'unknown error'); }
}

const SHUTDOWN_FLUSH_LIMIT_MS = 8_000;

function closeNetworkAndExit() {
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 2_000).unref?.();
}

async function closeServerResources() {
  // Never let a flush that does not settle keep the process alive past the
  // forced exit: the timer starts before the flushes, not after.
  setTimeout(() => process.exit(0), SHUTDOWN_FLUSH_LIMIT_MS).unref?.();
  disposeRuntimeResources();
  await flushTelemetryStore();
  await flushAnalyticsRollupStore();
  closeNetworkAndExit();
}

function waitForDrain(deadline) {
  const check = setInterval(() => {
    // A lobby that has not started yet still holds seats: a deploy that dropped
    // it would take those players away, so the drain waits for it as well.
    const drained = maintenance.activeRoundCount() === 0 && countWaitingRooms() === 0;
    if (!drained && Date.now() < deadline) return;
    clearInterval(check);
    closeServerResources();
  }, 250);
  check.unref?.();
}

function gracefulShutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const deadline = shutdownDeadline();
  // persist:false keeps this restart drain out of maintenance.json. Only an
  // operator drain may survive a restart; a plain SIGTERM must not close the
  // table on the next boot.
  maintenance.beginDrain({
    releaseId: process.env.POORUP_RELEASE_ID || SHUTDOWN_RELEASE_ID,
    deadline,
    message: shutdownDrainMessage(signal),
    persist: false
  });
  waitForDrain(deadline);
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

// Last-resort crash guards. Every known throw site is caught at its seam (handler scaffold, bot timer try/catch). An unknown exception
// is logged loudly and the process terminates, so the supervisor restarts it from a clean state instead of serving corrupted room state.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(1);
});
