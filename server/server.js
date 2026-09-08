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
import { resolveStorePaths } from './serverStorePaths.js';
import { createCorsOrigin } from './serverConfig.js';
import { createSocketRateLimiter } from './socketRateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const socketRateLimiter = createSocketRateLimiter({
  max: process.env.POORUP_SOCKET_RATE_LIMIT,
  windowMs: process.env.POORUP_SOCKET_RATE_WINDOW_MS
});
if (process.env.NODE_ENV === 'production' && !String(process.env.POORUP_ALLOWED_ORIGINS || '').trim()) {
  console.warn('POORUP_ALLOWED_ORIGINS is unset; Socket.IO CORS remains permissive for this deployment.');
}
const io = new Server(server, {
  cors: { origin: createCorsOrigin(process.env) }
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

const roomManager = new RoomManager();
const storePaths = resolveStorePaths(process.env);
const accountStore = new AccountStore(storePaths.accounts);
const socialStore = new SocialStore(storePaths.social);
const matchStore = new MatchStore(storePaths.matches);
const achievementStore = new AchievementStore(storePaths.achievements);
const botAdvisor = createBotAdvisor();

const social = createSocialApi({ io, accountStore, socialStore, matchStore, achievementStore });
const runtime = createRuntime({ io, roomManager, accountStore, socialStore, matchStore, achievementStore, botAdvisor, social });

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
