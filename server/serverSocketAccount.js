// The account and room-lifecycle socket domain: registration/login/session
// restore, public-room browsing, and the create/join/leave/set-setting/
// start-game handlers. The original create-room Bumpy Road and the cc10+
// join/leave bodies became single-purpose guard chains in the propertyApi.js
// style; every ack payload, system-message text, and emit order is
// wire-identical (server/rooms.test.js pins the error strings and order).
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
import { reply } from './socketHandlerSupport.js';

function registerAccountSocketHandlers(on, socket, runtime) {
  const { accountStore, roomManager } = runtime;

  on('check-username', (payload = {}, callback) => {
    // Availability is a read-only hint for the form. Registration still
    // performs the authoritative uniqueness check inside AccountStore.
    reply(callback, accountStore.checkUsername(payload.username));
  });

  on('account-logout', (payload = {}, callback) => {
    socket.data.accountId = null;
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

  on('account-register', sessionGrantHandler(payload => accountStore.register(payload)));
  on('account-login', sessionGrantHandler(payload => accountStore.login(payload)));
  on('account-restore', sessionGrantHandler(payload => accountStore.restore(payload.sessionToken)));

  on('set-setting', handleSetSetting);
  on('start-game', handleStartGame);

  // register/login/restore share the exact same flow: run the store verb,
  // adopt the session account on the socket, forward the store's ack verbatim.
  function sessionGrantHandler(run) {
    return function sessionGrant(payload = {}, callback) {
      const result = run(payload);
      if (result?.account?.id) socket.data.accountId = result.account.id;
      reply(callback, result);
    };
  }

  function handleAccountUpdate(payload = {}, callback) {
    const result = accountStore.updateProfile(payload.sessionToken, payload);
    if (!result.success) return reply(callback, result);
    socket.data.accountId = result.account.id;
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
    const { clientId } = payload;
    runtime.clearDisconnectTimer(clientId);
    const room = roomManager.restoreConnection(clientId, socket.id);
    if (!room) return reply(callback, { success: false, error: 'No active session found.' });
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
  function roomAccessAck(room) {
    return { success: true, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility };
  }

  function handleCreateRoom(payload, callback) {
    const { clientId } = payload || {};
    const account = runtime.accountFromPayload(payload);
    const request = buildCreateRoomRequest(payload, account);
    if (request.accountId) socket.data.accountId = request.accountId;
    const validationError = validateCreateRoomRequest(request);
    if (validationError) return reply(callback, { success: false, error: validationError });
    const conflict = privateCodeConflict(request);
    if (conflict) return reply(callback, { success: false, error: conflict });
    runtime.clearDisconnectTimer(clientId);
    leavePreviousRoom(clientId);
    runtime.leaveAllGameRooms(socket);
    const room = roomManager.createRoom(toRoomCreationOptions(request, clientId, socket.id));
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    socket.emit('system-message', { text: 'Room created. Waiting for players...' });
    reply(callback, roomAccessAck(room));
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

  function leavePreviousRoom(clientId) {
    const previousRoom = roomManager.getRoomByClient(clientId);
    const departedPlayerId = previousRoom?.game.getPlayerByClient(clientId)?.id;
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id);
    if (!oldRoom) return;
    if (departedPlayerId) {
      runtime.reassignHostIfNeeded(oldRoom, departedPlayerId);
    }
    runtime.emitRoomState(oldRoom);
  }

  function handleLeaveRoom(payload = {}, callback) {
    const { clientId } = payload || {};
    if (!clientId) {
      return reply(callback, { success: false, error: 'A client session is required to leave.' });
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
    room.setRoomSetting(key, value);
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
