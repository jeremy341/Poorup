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
import {
  normalizeRoomCode,
  normalizeAvatarGrid,
  buildRoomParticipant,
  buildCreateRoomRequest,
  validateCreateRoomRequest,
  validateJoinRoomRequest,
  toRoomCreationOptions,
  toJoinPlayerInfo
} from './roomSetup.js';
import { createSafeEmitter, reply } from './socketHandlerSupport.js';
import { createSocialApi } from './socketSocialApi.js';
import { createRuntime } from './socketRuntime.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';
import { registerSocialSocketHandlers } from './serverSocketSocial.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
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
const accountStore = new AccountStore();
const socialStore = new SocialStore();
const matchStore = new MatchStore();
const achievementStore = new AchievementStore();
const botAdvisor = createBotAdvisor();

const social = createSocialApi({ io, accountStore, socialStore, matchStore, achievementStore });
const runtime = createRuntime({ io, roomManager, accountStore, socialStore, matchStore, achievementStore, botAdvisor, social });

io.on('connection', (socket) => {
  console.log('A socket connected:', socket.id);

  const on = createSafeEmitter(socket);

  registerGameSocketHandlers(on, socket, runtime);
  registerSocialSocketHandlers(on, socket, runtime);

  on('account-register', (payload = {}, callback) => {
    const result = accountStore.register(payload);
    if (result?.account?.id) socket.data.accountId = result.account.id;
    reply(callback, result);
  });

  on('check-username', (payload = {}, callback) => {
    // Availability is a read-only hint for the form. Registration still
    // performs the authoritative uniqueness check inside AccountStore.
    reply(callback, accountStore.checkUsername(payload.username));
  });

  on('account-login', (payload = {}, callback) => {
    const result = accountStore.login(payload);
    if (result?.account?.id) socket.data.accountId = result.account.id;
    reply(callback, result);
  });

  on('account-restore', (payload = {}, callback) => {
    const result = accountStore.restore(payload.sessionToken);
    if (result?.account?.id) socket.data.accountId = result.account.id;
    reply(callback, result);
  });

  on('account-logout', (payload = {}, callback) => {
    socket.data.accountId = null;
    reply(callback, accountStore.logout(payload.sessionToken));
  });

  on('account-update', (payload = {}, callback) => {
    const result = accountStore.updateProfile(payload.sessionToken, payload);
    if (!result.success) return reply(callback, result);
    socket.data.accountId = result.account.id;
    const room = roomManager.getRoomBySocket(socket.id);
    const player = room?.getPlayerBySocket(socket.id);
    if (player && !room.game.started && player.accountId === result.account.id) {
      room.game.setPlayerAppearance(socket.id, {
        nickname: result.account.displayName,
        color: result.account.color,
        avatarGrid: normalizeAvatarGrid(result.account.avatarGrid),
      });
      runtime.emitRoomState(room);
    }
    reply(callback, result);
  });

  on('restore-session', (payload = {}, callback) => {
    const account = social.accountForSocket(socket, payload);
    const { clientId } = payload;
    runtime.clearDisconnectTimer(clientId);
    const room = roomManager.restoreConnection(clientId, socket.id);
    if (room) {
      for (const r of [...socket.rooms]) {
        if (r !== socket.id && r !== room.roomCode) {
          socket.leave(r);
        }
      }
      socket.join(room.roomCode);
      if (account?.id) socket.data.accountId = account.id;
      runtime.emitRoomState(room);
      runtime.emitPendingInteractions(room, socket, room.game.getPlayerByClient(clientId));
      socket.emit('system-message', { text: 'Reconnected to your room.' });
      reply(callback, { success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility });
      return;
    }
    reply(callback, { success: false, error: 'No active session found.' });
  });

  on('list-rooms', (_, callback) => {
    reply(callback, { success: true, rooms: roomManager.listPublicRooms() });
  });

  on('create-room', (payload, callback) => {
    const { clientId } = payload || {};
    const account = runtime.accountFromPayload(payload);
    const request = buildCreateRoomRequest(payload, account);
    if (request.accountId) socket.data.accountId = request.accountId;
    const validationError = validateCreateRoomRequest(request);
    if (validationError) {
      return reply(callback, { success: false, error: validationError });
    }
    const existingRoom = request.requestedRoomCode ? roomManager.getRoom(request.requestedRoomCode) : null;
    if (existingRoom) {
      // A room with no connected humans must not lock its private code for
      // the full GC grace period — reclaim it and let the creator take over.
      if (!existingRoom.hasConnectedHumans()) {
        runtime.destroyRoom(existingRoom);
      } else {
        return reply(callback, { success: false, error: 'That private room code is already in use. Choose another.' });
      }
    }
    runtime.clearDisconnectTimer(clientId);

    const previousRoom = roomManager.getRoomByClient(clientId);
    const departedPlayerId = previousRoom?.game.getPlayerByClient(clientId)?.id;
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id);
    if (oldRoom) {
      if (departedPlayerId) {
        runtime.reassignHostIfNeeded(oldRoom, departedPlayerId);
      }
      runtime.emitRoomState(oldRoom);
    }

    runtime.leaveAllGameRooms(socket);

    const room = roomManager.createRoom(toRoomCreationOptions(request, clientId, socket.id));
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    socket.emit('system-message', { text: 'Room created. Waiting for players...' });
    reply(callback, { success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility });
    runtime.scheduleRoomsUpdated();
  });

  on('leave-room', (payload = {}, callback) => {
    const { clientId } = payload || {};
    if (!clientId) {
      return reply(callback, { success: false, error: 'A client session is required to leave.' });
    }
    runtime.clearDisconnectTimer(clientId);
    const currentRoom = roomManager.getRoomByClient(clientId);
    const departing = currentRoom?.game.getPlayerByClient(clientId) || null;
    const departedId = departing?.id;
    const nickname = departing?.nickname || 'A player';
    const wasPublic = currentRoom?.visibility === 'public';
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id);
    if (oldRoom) {
      // Reassign the host on lobby AND started rooms — the older cleanup
      // copies only did it in one branch and left orphan lobbies.
      if (departedId) {
        runtime.reassignHostIfNeeded(oldRoom, departedId);
      }
      socket.leave(oldRoom.roomCode);
      runtime.emitRoomState(oldRoom);
      io.in(oldRoom.roomCode).emit('system-message', { text: `${nickname} left the room.` });
      if (wasPublic) {
        runtime.scheduleRoomsUpdated();
      }
    }
    reply(callback, { success: true });
  });

  on('join-room', (payload, callback) => {
    const roomCode = normalizeRoomCode(payload?.roomCode);
    const account = runtime.accountFromPayload(payload);
    const participant = buildRoomParticipant(payload, account);
    if (participant.accountId) socket.data.accountId = participant.accountId;
    const { clientId } = payload || {};
    const validationError = validateJoinRoomRequest({ roomCode, nickname: participant.nickname });
    if (validationError) {
      return reply(callback, { success: false, error: validationError });
    }
    runtime.clearDisconnectTimer(clientId);
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      return reply(callback, { success: false, error: 'Room not found.' });
    }

    runtime.leaveAllGameRooms(socket);

    runtime.detachSocketFromOtherRoom(socket, room);

    const result = room.addOrReconnectPlayer(toJoinPlayerInfo(participant, clientId, socket.id));
    if (!result.success) {
      return reply(callback, { success: false, error: result.error });
    }
    roomManager.socketRoom.set(socket.id, room);
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    runtime.emitPendingInteractions(room, socket, result.player);
    io.in(room.roomCode).emit('system-message', { text: `${participant.nickname} joined the room.` });
    reply(callback, { success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility });
    runtime.scheduleRoomsUpdated();
  });

  on('set-setting', (payload = {}, callback) => {
    const { key, value } = payload;
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!player || room.hostId !== player.id) {
      return reply(callback, { success: false, error: 'Only the host can change settings.' });
    }
    if (room.game.started) {
      return reply(callback, { success: false, error: 'Game settings can only be changed before the game starts.' });
    }
    room.setRoomSetting(key, value);
    runtime.emitRoomState(room);
    reply(callback, { success: true });
    if (room.visibility === 'public') {
      // Seat counts / settings show in the public directory.
      runtime.scheduleRoomsUpdated();
    }
  });

  on('set-player-appearance', (payload = {}, callback) => {
    const { color, nickname } = payload;
    const avatarGrid = normalizeAvatarGrid(payload.avatarGrid);
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) {
      return reply(callback, { success: false, error: 'Room not found.' });
    }
    const result = room.game.setPlayerAppearance(socket.id, { color, nickname, avatarGrid });
    // gameLogic owns appearance-uniqueness rejection; forward its exact
    // { success, error? } shape so the client can surface the reason.
    if (result?.success) {
      runtime.emitRoomState(room);
    }
    reply(callback, result);
  });

  on('start-game', (_, callback) => {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!player || room.hostId !== player.id) {
      return reply(callback, { success: false, error: 'Only the host can start the game.' });
    }
    const result = room.startGame();
    if (!result.success) {
      return reply(callback, { success: false, error: result.error });
    }
    runtime.emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: 'The game has started.' });
    reply(callback, { success: true });
    runtime.scheduleRoomsUpdated();
  });

  socket.on('disconnect', () => {
    runtime.handleSocketDisconnect(socket);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log('✅ Server is running!');
  console.log('👉 Visit http://localhost:' + PORT);
});

// Last-resort crash guards. Every known throw site is caught at its seam
// (handler scaffold, bot timer try/catch); if anything still escapes, log
// it loudly and stay alive for the players already connected instead of
// taking every room down with one bad stack.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
