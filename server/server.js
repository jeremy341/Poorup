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
import { assertProductionCors, createCorsOrigin } from './serverConfig.js';
import { createSocketRateLimiter } from './socketRateLimiter.js';
import { createHttpRateLimiter } from './httpRateLimiter.js';
import { backupJsonStores } from './backupStore.js';
import { assertPersistenceMode } from './persistenceMode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
assertPersistenceMode(process.env);
assertProductionCors(process.env);

const app = express();
const server = http.createServer(app);
const trustedProxyHops = Math.max(0, Math.floor(Number(process.env.POORUP_TRUST_PROXY_HOPS) || 0));
if (trustedProxyHops > 0) app.set('trust proxy', trustedProxyHops);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  next();
});
app.use(createHttpRateLimiter({ max: process.env.POORUP_HTTP_RATE_LIMIT, windowMs: process.env.POORUP_HTTP_RATE_WINDOW_MS, trustProxy: trustedProxyHops > 0 }));
const socketRateLimiter = createSocketRateLimiter({
  max: process.env.POORUP_SOCKET_RATE_LIMIT,
  windowMs: process.env.POORUP_SOCKET_RATE_WINDOW_MS
});
if (process.env.NODE_ENV === 'production' && !String(process.env.POORUP_ALLOWED_ORIGINS || '').trim()) {
  console.warn('POORUP_ALLOWED_ORIGINS is unset; browser-origin Socket.IO requests are blocked until an allow-list is configured.');
}
const io = new Server(server, {
  cors: { origin: createCorsOrigin(process.env) },
  // All game payloads are compact (an avatar is at most 8×8 cells). Keep
  // oversized Socket.IO packets from consuming memory before the per-event
  // rate limiter gets a chance to reject them.
  maxHttpBufferSize: 100_000
});

// The supplied plain-client project is the production static UI. Keep the
// protected SVG references in public/assets and serve the HTML/CSS/JS directly.
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(publicPath, 'index.html'), err => {
    if (err) next(err);
  });
});
app.use((_req, res) => res.status(404).type('text').send('Not found.'));
app.use((error, _req, res, _next) => {
  console.error('HTTP request failed:', error?.message || 'unknown error');
  res.status(500).type('text').send('The parlor is temporarily unavailable.');
});

const roomManager = new RoomManager();
const storePaths = resolveStorePaths(process.env);
const auxiliaryStorePaths = resolveAuxiliaryStorePaths(process.env);
const allStorePaths = { ...storePaths, ...auxiliaryStorePaths };
const accountStore = new AccountStore(storePaths.accounts);
const socialStore = new SocialStore(storePaths.social);
const matchStore = new MatchStore(storePaths.matches);
const achievementStore = new AchievementStore(storePaths.achievements);
const seasonStore = new SeasonStore(auxiliaryStorePaths.seasons);
const cosmeticStore = new CosmeticStore(auxiliaryStorePaths.cosmetics);
const telemetryStore = new TelemetryStore(auxiliaryStorePaths.telemetry);
const backupDirectory = String(process.env.POORUP_BACKUP_DIR || '').trim();
if (backupDirectory) {
  const intervalMs = Math.max(60_000, Number(process.env.POORUP_BACKUP_INTERVAL_MS) || 15 * 60 * 1000);
  const runBackup = () => {
    try { backupJsonStores(allStorePaths, backupDirectory); } catch (error) { console.error('Backup rotation failed:', error); }
  };
  runBackup();
  const backupTimer = setInterval(runBackup, intervalMs);
  backupTimer.unref?.();
}
const botAdvisor = createBotAdvisor();

const social = createSocialApi({ io, accountStore, socialStore, matchStore, achievementStore });
const runtime = createRuntime({ io, roomManager, accountStore, socialStore, matchStore, achievementStore, seasonStore, cosmeticStore, telemetryStore, botAdvisor, social });

io.on('connection', (socket) => {
  console.log('A socket connected:', socket.id);

  const on = createSafeEmitter(socket, { allow: socketId => socketRateLimiter.allow(socketId) });

  registerAccountSocketHandlers(on, socket, runtime);
  registerGameSocketHandlers(on, socket, runtime);
  registerSocialSocketHandlers(on, socket, runtime);

  socket.on('disconnect', () => {
    socketRateLimiter.forget(socket.id);
    runtime.handleSocketDisconnect(socket);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log('✅ Server is running!');
  console.log('👉 Visit http://localhost:' + PORT);
});

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
