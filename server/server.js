// Server bootstrap: builds the HTTP+socket.io shell, the stores, and the
// shared socket runtime, then delegates every wire handler to the domain
// registration modules (account/room lifecycle, in-game verbs, social).
// Static UI serving, PORT binding, and the crash guards live here only.
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
import { resolveAuxiliaryStorePaths, resolveStorePaths } from './serverStorePaths.js';
import { SeasonStore } from './seasonModule.js';
import { CosmeticStore } from './cosmeticCatalog.js';
import { TelemetryStore } from './telemetryModule.js';
import { assertProductionCors, createCorsOrigin, isAllowedSocketOrigin, parseAllowedOrigins, resolveClientAddress } from './serverConfig.js';
import { createSocketAdmission, createSocketRateLimiter } from './socketRateLimiter.js';
import { assertRateLimitConfig, createHttpRateLimiter } from './httpRateLimiter.js';
import { backupJsonStores } from './backupStore.js';
import { assertPersistenceMode } from './persistenceMode.js';
import { createDrainController } from './drainController.js';
import { createMetricsRegistry } from './metricsRegistry.js';
import { buildAnalyticsBalance, buildAnalyticsDrilldown, buildAnalyticsSummary, normalizeAdminIds, setAnalyticsNoStoreHeaders } from './analyticsApi.js';
import { createPseudonymizer } from './analyticsPrivacy.js';
import { createAnalyticsRollupStore } from './analyticsRollupStore.js';
import { createLegalRouter } from './legalRoutes.js';
import { createMetadataRouter, metadataConfig } from './metadata.js';
import { loadJson, writeJson } from './storeIO.js';
import { createAuthoritativeStore } from './authoritativeStore.js';
import { createPubSubAdapter } from './pubsubAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
assertPersistenceMode(process.env);
assertProductionCors(process.env);

const app = express();
const server = http.createServer(app);
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
app.use(createHttpRateLimiter({ max: process.env.POORUP_HTTP_RATE_LIMIT, windowMs: process.env.POORUP_HTTP_RATE_WINDOW_MS, trustProxy: trustedProxyHops > 0 }));
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
const io = new Server(server, {
  cors: { origin: createCorsOrigin(process.env) },
  allowRequest: (request, callback) => {
    const origin = request?.headers?.origin;
    const allowedOrigin = configuredSocketOrigins.length
      ? isAllowedSocketOrigin(origin, configuredSocketOrigins)
      : (!productionRuntime || !origin);
    const peerKey = resolveClientAddress({ request }, trustedProxyHops);
    const allowed = allowedOrigin && socketAdmission.allow(peerKey, io.engine?.clientsCount || 0);
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
const publicPath = path.join(__dirname, '../public');
const roomManager = new RoomManager();
const metrics = createMetricsRegistry();
const adminAccountIds = normalizeAdminIds(process.env.POORUP_ADMIN_ACCOUNT_IDS);
const dataDirectory = typeof process.env.POORUP_DATA_DIR === 'string' ? process.env.POORUP_DATA_DIR.trim() : '';
const maintenanceFile = dataDirectory ? path.join(dataDirectory, 'maintenance.json') : null;
const persistedMaintenance = maintenanceFile
  ? loadJson(maintenanceFile, value => value && typeof value === 'object' && typeof value.mode === 'string').value
  : null;
const maintenance = createDrainController({
  initialMode: persistedMaintenance?.mode || process.env.POORUP_MAINTENANCE_MODE,
  getActiveRounds: () => [...roomManager.rooms.values()].filter(room => room.game.started && !room.destroyed).length,
  onChange: snapshot => {
    metrics.incrementMetric('maintenance-transitions', { state: snapshot.mode });
    if (maintenanceFile) {
      try { writeJson(maintenanceFile, snapshot); } catch (error) { console.error('Maintenance state persist failed:', error?.message || 'unknown error'); }
    }
    io.emit('maintenance-state', snapshot);
  }
});
// Provider-neutral seams are intentionally inert for the current single
// process runtime. They make the PostgreSQL/Redis migration explicit without
// changing any socket payload or introducing a second room authority.
const authoritativeStore = createAuthoritativeStore({
  filePath: dataDirectory ? path.join(dataDirectory, 'rooms.json') : ''
});
const pubsubAdapter = createPubSubAdapter();
const analyticsPseudonymKey = String(process.env.POORUP_ANALYTICS_PSEUDONYM_KEY || '').trim();
const analyticsRollupStore = createAnalyticsRollupStore({
  filePath: dataDirectory ? path.join(dataDirectory, 'analytics-rollup.json') : null,
  pseudonymizer: createPseudonymizer({ key: analyticsPseudonymKey })
});
let storesLoaded = false;
let backupHealth = { configured: false, fresh: true, lastRunAt: null, failures: 0 };
const maintenanceToken = String(process.env.POORUP_MAINTENANCE_TOKEN || '').trim();
app.post('/internal/maintenance', express.json({ limit: '4kb' }), (req, res) => {
  if (!maintenanceToken) return res.status(404).json({ success: false, error: 'Not found.' });
  if (req.get('x-poorup-maintenance-token') !== maintenanceToken) {
    return res.status(403).json({ success: false, error: 'Forbidden.' });
  }
  const mode = String(req.body?.mode || '').trim().toLowerCase();
  if (mode === 'draining') {
    const snapshot = maintenance.beginDrain({
      releaseId: req.body?.releaseId,
      deadline: req.body?.deadline,
      message: req.body?.message
    });
    return res.status(200).json({ success: true, maintenance: snapshot });
  }
  if (mode === 'maintenance') {
    const snapshot = maintenance.enterMaintenance({
      releaseId: req.body?.releaseId,
      message: req.body?.message
    });
    return res.status(200).json({ success: true, maintenance: snapshot });
  }
  if (mode === 'normal') {
    return res.status(200).json({ success: true, maintenance: maintenance.finishMaintenance() });
  }
  return res.status(400).json({ success: false, error: 'Choose normal, draining, or maintenance.' });
});
app.get('/admin/analytics/summary', (req, res) => {
  const sessionToken = req.get('x-poorup-session-token') || '';
  const account = accountStore.sessionAccount(sessionToken);
  const result = buildAnalyticsSummary(metrics, account?.id, adminAccountIds, req.query?.range);
  setAnalyticsNoStoreHeaders(res);
  return res.status(result.success ? 200 : result.status).json(result);
});
app.get('/admin/analytics/balance', (req, res) => {
  const sessionToken = req.get('x-poorup-session-token') || '';
  const account = accountStore.sessionAccount(sessionToken);
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
  const sessionToken = req.get('x-poorup-session-token') || '';
  const account = accountStore.sessionAccount(sessionToken);
  const result = buildAnalyticsDrilldown({
    rollup: analyticsRollupStore,
    accountId: account?.id,
    adminIds: adminAccountIds,
    query: req.query
  });
  setAnalyticsNoStoreHeaders(res);
  return res.status(result.success ? 200 : result.status).json(result);
});

// These routers are mounted before static serving so legal documents and
// per-route metadata cannot be swallowed by express.static's index fallback.
app.use(createLegalRouter({ publicDirectory: publicPath }));
app.use(createMetadataRouter({ env: process.env, indexFile: path.join(publicPath, 'index.html') }));

const metadataOrigin = metadataConfig({ env: process.env, path: '/' }).origin;
const indexingApproved = Boolean(metadataOrigin && String(process.env.POORUP_INDEX_POLICY || '').trim().toLowerCase() === 'index,follow');
app.get('/sitemap.xml', (_req, res, next) => {
  if (!indexingApproved) return next();
  const publicRoutes = ['/', '/rules'];
  const escapeXml = value => String(value).replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]));
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicRoutes.map(route => `<url><loc>${escapeXml(`${metadataOrigin}${route}`)}</loc></url>`).join('')}</urlset>`;
  return res.type('application/xml').send(body);
});
app.use(express.static(publicPath, {
  etag: true,
  maxAge: '1h'
}));
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'poorup', releaseId: process.env.POORUP_RELEASE_ID || 'local' });
});
app.get('/readyz', (_req, res) => {
  const snapshot = maintenance.snapshot();
  const rollupHealth = analyticsRollupStore.health();
  const backupReady = !backupHealth.configured || backupHealth.fresh;
  const ready = snapshot.mode === 'normal' && storesLoaded && backupReady;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : snapshot.mode === 'draining' ? 'draining' : 'unavailable',
    acceptingNewRounds: snapshot.mode === 'normal',
    activeRounds: snapshot.activeRounds,
    storeLoaded: storesLoaded,
    backupConfigured: backupHealth.configured,
    backupFresh: backupHealth.configured ? backupHealth.fresh : null,
    analyticsRollup: { loaded: rollupHealth.loaded, fresh: rollupHealth.fresh, lagSeconds: rollupHealth.lagSeconds, pendingWrites: rollupHealth.pendingWrites },
    releaseId: snapshot.releaseId || process.env.POORUP_RELEASE_ID || 'local'
  });
});
app.get('/robots.txt', (_req, res) => {
  if (!indexingApproved) return res.type('text').send('User-agent: *\nDisallow: /\n');
  return res.type('text').send('User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /game/\n');
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
function errorPage(title, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Poorup</title><style>body{margin:0;background:#01070a;color:#f0d9ac;font:16px monospace;display:grid;place-items:center;min-height:100vh}main{border:1px solid #c88f2e;padding:32px;max-width:560px}a{color:#f0d9ac}</style></head><body><main><p>POORUP · AFTER-HOURS PARLOR</p><h1>${title}</h1><p>${message}</p><a href="/">Return to the parlor</a></main></body></html>`;
}
app.use((_req, res) => res.status(404).type('html').send(errorPage('404 · Table not found', 'That route is not part of this parlor.')));
app.use((error, _req, res, _next) => {
  console.error('HTTP request failed:', error?.message || 'unknown error');
  res.status(500).type('html').send(errorPage('500 · Parlor unavailable', 'The table is temporarily offline. Try again shortly.'));
});

const storePaths = resolveStorePaths(process.env);
const auxiliaryStorePaths = resolveAuxiliaryStorePaths(process.env);
const allStorePaths = { ...storePaths, ...auxiliaryStorePaths };
const accountStore = new AccountStore(storePaths.accounts);
const socialStore = new SocialStore(storePaths.social);
const matchStore = new MatchStore(storePaths.matches);
const achievementStore = new AchievementStore(storePaths.achievements);
const seasonStore = new SeasonStore(auxiliaryStorePaths.seasons);
const cosmeticStore = new CosmeticStore(auxiliaryStorePaths.cosmetics);
const telemetryStore = new TelemetryStore(auxiliaryStorePaths.telemetry, { rollupStore: analyticsRollupStore });
storesLoaded = true;
const backupDirectory = String(process.env.POORUP_BACKUP_DIR || '').trim();
if (backupDirectory) {
  backupHealth = { configured: true, fresh: false, lastRunAt: null, failures: 0 };
  const intervalMs = Math.max(60_000, Number(process.env.POORUP_BACKUP_INTERVAL_MS) || 15 * 60 * 1000);
  const runBackup = () => {
    try {
      const result = backupJsonStores(allStorePaths, backupDirectory);
      backupHealth = { ...backupHealth, fresh: result.success, lastRunAt: new Date().toISOString(), failures: result.success ? backupHealth.failures : backupHealth.failures + 1 };
      if (!result.success) console.error('Backup rotation failed: one or more stores could not be copied.');
    } catch (error) {
      backupHealth = { ...backupHealth, fresh: false, lastRunAt: new Date().toISOString(), failures: backupHealth.failures + 1 };
      console.error('Backup rotation failed:', error);
    }
  };
  runBackup();
  const backupTimer = setInterval(runBackup, intervalMs);
  backupTimer.unref?.();
}
const botAdvisor = createBotAdvisor();

const social = createSocialApi({ io, accountStore, socialStore, matchStore, achievementStore });
const runtime = createRuntime({ io, roomManager, accountStore, socialStore, matchStore, achievementStore, seasonStore, cosmeticStore, telemetryStore, botAdvisor, social, maintenance, metrics, authoritativeStore, pubsubAdapter });

io.on('connection', (socket) => {
  console.log('A socket connected:', socket.id);

  const on = createSafeEmitter(socket, { allow: socketId => socketRateLimiter.allow(socketId) });

  registerAccountSocketHandlers(on, socket, runtime);
  registerGameSocketHandlers(on, socket, runtime);
  registerSocialSocketHandlers(on, socket, runtime);
  socket.emit('maintenance-state', maintenance.snapshot());
  metrics.setMetric('active-sockets', io.sockets.sockets.size, { scope: 'all' });
  metrics.setMetric('active-rooms', roomManager.rooms.size, { scope: 'all' });
  metrics.setMetric('active-rounds', maintenance.activeRoundCount(), { scope: 'all' });

  socket.on('disconnect', () => {
    socketRateLimiter.forget(socket.id);
    runtime.handleSocketDisconnect(socket);
    metrics.setMetric('active-sockets', io.sockets.sockets.size, { scope: 'all' });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log('✅ Server is running!');
  console.log('👉 Visit http://localhost:' + PORT);
});

let shutdownStarted = false;
function shutdownDeadline() {
  const drainMs = Math.max(1_000, Math.min(15 * 60_000, Number(process.env.POORUP_SHUTDOWN_DRAIN_MS) || 30_000));
  return Date.now() + drainMs;
}

async function closeServerResources() {
  maintenance.dispose();
  pubsubAdapter.close?.();
  try { await telemetryStore.close?.(); } catch (error) { console.error('Telemetry flush failed:', error?.message || 'unknown error'); }
  try { await analyticsRollupStore.close?.(); } catch (error) { console.error('Analytics rollup flush failed:', error?.message || 'unknown error'); }
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 2_000).unref?.();
}

function waitForDrain(deadline) {
  const check = setInterval(() => {
    const drained = maintenance.activeRoundCount() === 0;
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
  maintenance.beginDrain({
    releaseId: process.env.POORUP_RELEASE_ID || 'shutdown',
    deadline,
    message: `${signal} · SERVER RESTARTING`
  });
  waitForDrain(deadline);
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

// Last-resort crash guards. Every known throw site is caught at its seam
// (handler scaffold, bot timer try/catch). If an unknown exception still
// escapes, log it loudly and terminate so the process supervisor can restart
// from a clean state instead of serving corrupted room state.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
