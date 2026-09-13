// The account and room-lifecycle socket domain: registration/login/session
// restore, public-room browsing, and the create/join/leave/set-setting/
// start-game handlers. The original create-room Bumpy Road and the cc10+
// join/leave bodies became single-purpose guard chains in the propertyApi.js
// style; every ack payload, system-message text, and emit order is
// wire-identical (server/rooms.test.js pins the error strings and order).
import {
  normalizeClientId,
  normalizeRequestId,
  normalizeRoomCode,
  normalizeRoomId,
  normalizeAvatarGrid,
  buildRoomParticipant,
  buildCreateRoomRequest,
  validateCreateRoomRequest,
  validateJoinRoomRequest,
  toRoomCreationOptions,
  toJoinPlayerInfo
} from './roomSetup.js';
import { reply } from './socketHandlerSupport.js';

const AUTH_ATTEMPT_WINDOW_MS = 60_000;
const AUTH_ATTEMPT_LIMIT = 8;
const authAttempts = new Map();

function authAttemptKey(socket) {
  return String(socket.handshake?.address || socket.request?.socket?.remoteAddress || socket.id || 'unknown').slice(0, 120);
}

function allowAuthAttempt(socket) {
  const key = authAttemptKey(socket);
  const now = Date.now();
  const current = authAttempts.get(key);
  const bucket = !current || now - current.startedAt >= AUTH_ATTEMPT_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : current;
  bucket.count += 1;
  authAttempts.set(key, bucket);
  if (authAttempts.size > 10_000) {
    for (const [entryKey, entry] of authAttempts) {
      if (now - entry.startedAt >= AUTH_ATTEMPT_WINDOW_MS) authAttempts.delete(entryKey);
    }
  }
  return bucket.count <= AUTH_ATTEMPT_LIMIT;
}

function clearAuthAttempts(socket) {
  authAttempts.delete(authAttemptKey(socket));
}

function joinRoomTarget(roomManager, roomCode, roomId) {
  const room = roomCode ? roomManager.getRoom(roomCode) : roomManager.getRoomByPublicId(roomId);
  if (!room) return null;
  if (roomId && room.visibility !== 'public') return null;
  return room;
}

function seatUnavailable(room, clientId, socketId) {
  const existingSeat = room.game.getPlayerByClient(clientId);
  return Boolean(existingSeat?.socketId && existingSeat.socketId !== socketId && !existingSeat.disconnected);
}

function registerAccountSocketHandlers(on, socket, runtime) {
  const { accountStore, roomManager } = runtime;

  on('check-username', (payload = {}, callback) => {
    // Availability is a read-only hint for the form. Registration still
    // performs the authoritative uniqueness check inside AccountStore.
    reply(callback, accountStore.checkUsername(payload.username));
  });

  on('account-logout', (payload = {}, callback) => {
    socket.data.accountId = null;
    socket.data.sessionTokenHash = null;
    reply(callback, accountStore.logout(payload.sessionToken));
  });

  on('account-update', handleAccountUpdate);
  on('restore-session', handleRestoreSession);
  on('list-rooms', (_, callback) => {
    reply(callback, { success: true, rooms: roomManager.listPublicRooms() });
  });
  on('create-room', handleCreateRoom);
  on('leave-room', handleLeaveRoom);
  on('join-room', handleJoinRoom);
  on('set-player-appearance', handleSetPlayerAppearance);

  on('account-register', sessionGrantHandler(payload => accountStore.register(payload), false, true));
  on('account-login', sessionGrantHandler(payload => accountStore.login(payload), false, true));
  on('account-restore', sessionGrantHandler(payload => accountStore.restore(payload.sessionToken), true, true));

  on('set-setting', handleSetSetting);
  on('start-game', handleStartGame);

  // register/login/restore share the exact same flow: run the store verb,
  // adopt the session account on the socket, forward the store's ack verbatim.
  function sessionGrantHandler(run, clearOnFailure = false, rateLimit = false) {
    return function sessionGrant(payload = {}, callback) {
      if (rateLimit && !allowAuthAttempt(socket)) {
        reply(callback, { success: false, error: 'Too many account attempts. Try again shortly.' });
        return;
      }
      const result = run(payload);
      if (result?.account?.id) {
        clearAuthAttempts(socket);
        socket.data.accountId = result.account.id;
        const token = result.sessionToken || payload.sessionToken;
        socket.data.sessionTokenHash = accountStore.sessionTokenHashFor(token);
      } else if (clearOnFailure) {
        socket.data.accountId = null;
        socket.data.sessionTokenHash = null;
      }
      reply(callback, result);
    };
  }

  function handleAccountUpdate(payload = {}, callback) {
    const result = accountStore.updateProfile(payload.sessionToken, payload);
    if (!result.success) return reply(callback, result);
    socket.data.accountId = result.account.id;
    socket.data.sessionTokenHash = accountStore.sessionTokenHashFor(payload.sessionToken);
    syncLobbySeatAppearance(result);
    reply(callback, result);
  }

  function syncLobbySeatAppearance(result) {
    const room = roomManager.getRoomBySocket(socket.id);
    const player = room?.getPlayerBySocket(socket.id);
    if (!player) return;
    if (room.game.started) return;
    if (player.accountId !== result.account.id) return;
    room.game.setPlayerAppearance(socket.id, {
      nickname: result.account.displayName,
      color: result.account.color,
      avatarGrid: normalizeAvatarGrid(result.account.avatarGrid),
    });
    runtime.emitRoomState(room);
  }

  function handleRestoreSession(payload = {}, callback) {
    const account = runtime.social.accountForSocket(socket, payload);
    const clientId = normalizeClientId(payload.clientId);
    if (!clientId) return reply(callback, { success: false, error: 'No active session found.' });
    const room = roomManager.restoreConnection(clientId, socket.id, account?.id, previousClientId => runtime.clearDisconnectTimer(previousClientId));
    if (!room) return reply(callback, { success: false, error: 'No active session found.' });
    socket.data.sessionTokenHash = accountStore.sessionTokenHashFor(payload.sessionToken);
    runtime.clearDisconnectTimer(clientId);
    joinRestoredRoom(room, account, clientId, callback);
  }

  function joinRestoredRoom(room, account, clientId, callback) {
    leaveForeignRooms(room.roomCode);
    socket.join(room.roomCode);
    if (account?.id) socket.data.accountId = account.id;
    runtime.emitRoomState(room);
    runtime.emitPendingInteractions(room, socket, room.game.getPlayerByClient(clientId));
    socket.emit('system-message', { text: 'Reconnected to your room.' });
    reply(callback, roomAccessAck(room));
  }

  function leaveForeignRooms(keepRoomCode) {
    for (const joined of [...socket.rooms]) {
      if (joined === socket.id) continue;
      if (joined === keepRoomCode) continue;
      socket.leave(joined);
    }
  }

  // Private/public ack shape: only private tables ever reveal their code.
  // Create callers also receive authoritative identity metadata so the client
  // can render the host immediately without guessing from local placeholders.
  function roomAccessAck(room, details = {}) {
    const ack = { success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility };
    if (!details.created) return ack;
    return {
      ...ack,
      created: true,
      hostId: room.hostId,
      playerId: details.playerId || null,
      bots: room.game.players.filter(player => player.isBot).length,
      ...(details.requestId ? { requestId: details.requestId } : {})
    };
  }

  function handleCreateRoom(payload, callback) {
    const requestId = normalizeRequestId(payload?.requestId);
    if (requestId && socket.data.createRoomRequestId === requestId && socket.data.createRoomAck) {
      return reply(callback, socket.data.createRoomAck);
    }
    const clientId = normalizeClientId(payload?.clientId);
    const account = runtime.social.accountForSocket(socket, payload);
    const request = buildCreateRoomRequest(payload, account);
    if (request.accountId) socket.data.accountId = request.accountId;
    const validationError = validateCreateRoomRequest(request);
    if (validationError) return reply(callback, { success: false, error: validationError });
    const conflict = privateCodeConflict(request);
    if (conflict) return reply(callback, { success: false, error: conflict });
    leavePreviousRoom(clientId, account);
    runtime.leaveAllGameRooms(socket);
    const room = roomManager.createRoom(toRoomCreationOptions(request, clientId, socket.id));
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    socket.emit('system-message', { text: 'Room created. Waiting for players...' });
    const playerId = room.game.getPlayerBySocket(socket.id)?.id || null;
    const ack = roomAccessAck(room, { created: Boolean(requestId), playerId, requestId });
    if (requestId) {
      socket.data.createRoomRequestId = requestId;
      socket.data.createRoomAck = ack;
    }
    reply(callback, ack);
    runtime.scheduleRoomsUpdated();
  }

  function privateCodeConflict(request) {
    if (!request.requestedRoomCode) return null;
    const existingRoom = roomManager.getRoom(request.requestedRoomCode);
    if (!existingRoom) return null;
    // A room with no connected humans must not lock its private code for
    // the full GC grace period — reclaim it and let the creator take over.
    if (!existingRoom.hasConnectedHumans()) {
      runtime.destroyRoom(existingRoom);
      return null;
    }
    return 'That private room code is already in use. Choose another.';
  }

  function leavePreviousRoom(clientId, account) {
    const previousRoom = roomManager.getRoomByClient(clientId);
    const previousPlayer = previousRoom?.game.getPlayerByClient(clientId);
    if (!previousPlayer || !canManageSeat(previousRoom, previousPlayer, account)) return false;
    runtime.clearDisconnectTimer(clientId);
    const departedPlayerId = previousRoom?.game.getPlayerByClient(clientId)?.id;
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id);
    if (!oldRoom) return false;
    if (departedPlayerId) {
      runtime.reassignHostIfNeeded(oldRoom, departedPlayerId);
    }
    runtime.emitRoomState(oldRoom);
    return true;
  }

  // A room action carries a clientId for tab-restart recovery, but that value
  // must not let an unrelated socket evict somebody else's seat. The current
  // socket may release its own seat; an authenticated account may also
  // release its own disconnected seat after a tab restart. Guest seats have
  // no durable identity and therefore require the owning socket.
  function canManageSeat(room, player, account) {
    if (!room || !player) return false;
    const mappedRoom = roomManager.getRoomBySocket(socket.id);
    const mappedPlayer = mappedRoom?.getPlayerBySocket(socket.id);
    if (mappedRoom === room && mappedPlayer?.id === player.id) return true;
    if (!account?.id) return false;
    if (player.accountId !== account.id) return false;
    return Boolean(player.disconnected);
  }

  function handleLeaveRoom(payload = {}, callback) {
    const clientId = normalizeClientId(payload?.clientId);
    if (!clientId) {
      return reply(callback, { success: false, error: 'A client session is required to leave.' });
    }
    const account = runtime.social.accountForSocket(socket, payload);
    const targetRoom = roomManager.getRoomByClient(clientId);
    const targetPlayer = targetRoom?.game.getPlayerByClient(clientId);
    if (targetPlayer && !canManageSeat(targetRoom, targetPlayer, account)) {
      return reply(callback, { success: false, error: 'No active session found.' });
    }
    runtime.clearDisconnectTimer(clientId);
    const currentRoom = roomManager.getRoomByClient(clientId);
    const departing = currentRoom?.game.getPlayerByClient(clientId) || null;
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id);
    announceRoomDeparture(oldRoom, departing, currentRoom);
    reply(callback, { success: true });
  }

  function announceRoomDeparture(oldRoom, departing, currentRoom) {
    if (!oldRoom) return;
    const departedId = departing?.id;
    const nickname = departing?.nickname || 'A player';
    const wasPublic = currentRoom?.visibility === 'public';
    // Reassign the host on lobby AND started rooms — the older cleanup
    // copies only did it in one branch and left orphan lobbies.
    if (departedId) {
      runtime.reassignHostIfNeeded(oldRoom, departedId);
    }
    socket.leave(oldRoom.roomCode);
    runtime.emitRoomState(oldRoom);
    runtime.io.in(oldRoom.roomCode).emit('system-message', { text: `${nickname} left the room.` });
    if (wasPublic) {
      runtime.scheduleRoomsUpdated();
    }
  }

  function handleJoinRoom(payload, callback) {
    const roomCode = normalizeRoomCode(payload?.roomCode);
    const roomId = normalizeRoomId(payload?.roomId);
    const account = runtime.social.accountForSocket(socket, payload);
    const participant = buildRoomParticipant(payload, account);
    if (participant.accountId) socket.data.accountId = participant.accountId;
    const clientId = normalizeClientId(payload?.clientId);
    const validationError = validateJoinRoomRequest({ roomCode, roomId, nickname: participant.nickname });
    if (validationError) {
      return reply(callback, { success: false, error: validationError });
    }
    const room = joinRoomTarget(roomManager, roomCode, roomId);
    if (!room) {
      return reply(callback, { success: false, error: 'Room not found.' });
    }
    if (seatUnavailable(room, clientId, socket.id)) {
      return reply(callback, { success: false, error: 'That seat is already in use.' });
    }
    const result = room.addOrReconnectPlayer(toJoinPlayerInfo(participant, clientId, socket.id));
    if (!result.success) {
      return reply(callback, { success: false, error: result.error });
    }
    runtime.clearDisconnectTimer(clientId);
    // Do not abandon the current room until the target seat has passed all
    // capacity/state checks. A failed join must leave the player exactly where
    // they were, including their socket-room membership and seat mapping.
    runtime.leaveAllGameRooms(socket);
    runtime.detachSocketFromOtherRoom(socket, room);
    completeRoomJoin(room, participant, result);
    reply(callback, roomAccessAck(room));
    runtime.scheduleRoomsUpdated();
  }

  function completeRoomJoin(room, participant, result) {
    roomManager.socketRoom.set(socket.id, room);
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    runtime.emitPendingInteractions(room, socket, result.player);
    runtime.io.in(room.roomCode).emit('system-message', { text: `${participant.nickname} joined the room.` });
  }

  function handleSetPlayerAppearance(payload = {}, callback) {
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
  }

  function handleSetSetting(payload = {}, callback) {
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
    const settingResult = room.setRoomSetting(key, value);
    if (settingResult?.rejected) {
      return reply(callback, { success: false, error: settingResult.reason });
    }
    runtime.emitRoomState(room);
    reply(callback, { success: true });
    if (room.visibility === 'public') {
      // Seat counts / settings show in the public directory.
      runtime.scheduleRoomsUpdated();
    }
  }

  function handleStartGame(_, callback) {
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
    runtime.io.in(room.roomCode).emit('system-message', { text: 'The game has started.' });
    reply(callback, { success: true });
    runtime.scheduleRoomsUpdated();
  }
}

export { registerAccountSocketHandlers };
