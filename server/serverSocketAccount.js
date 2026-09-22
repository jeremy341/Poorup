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
import { resolveClientAddress } from './serverConfig.js';
import { withAdminFlag } from './analyticsApi.js';

const AUTH_ATTEMPT_WINDOW_MS = 60_000;
const AUTH_ATTEMPT_LIMIT = 8;
const authAttempts = new Map();
const CREATE_ROOM_REPLAY_TTL_MS = 2 * 60_000;
const CREATE_ROOM_REPLAY_LIMIT = 1_000;
const createRoomReplays = new Map();

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
}

function createRoomFingerprint(request, clientId) {
  // Deliberately fingerprints only normalized room fields. Session tokens and
  // other credentials never enter the replay cache.
  return JSON.stringify(canonicalValue({ clientId, request }));
}

function createRoomReplayKey(account, clientId, socketId, requestId) {
  const actor = account?.id
    ? `account:${String(account.id)}`
    : clientId
      ? `client:${clientId}`
      : `socket:${socketId}`;
  return JSON.stringify([actor, requestId]);
}

function pruneCreateRoomReplays(now = Date.now()) {
  for (const [key, entry] of createRoomReplays) {
    if (entry.expiresAt <= now) createRoomReplays.delete(key);
  }
  while (createRoomReplays.size > CREATE_ROOM_REPLAY_LIMIT) {
    createRoomReplays.delete(createRoomReplays.keys().next().value);
  }
}

function readCreateRoomReplay(key) {
  const now = Date.now();
  const entry = createRoomReplays.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (entry) createRoomReplays.delete(key);
    return null;
  }
  // Touch on read so the bounded map is LRU, not insertion-only FIFO.
  createRoomReplays.delete(key);
  createRoomReplays.set(key, entry);
  return entry;
}

function rememberCreateRoomReplay(key, entry) {
  createRoomReplays.delete(key);
  createRoomReplays.set(key, { ...entry, expiresAt: Date.now() + CREATE_ROOM_REPLAY_TTL_MS });
  pruneCreateRoomReplays();
}

export function authAttemptKey(socket) {
  const trustedProxyHops = Math.max(0, Math.floor(Number(process.env.POORUP_TRUST_PROXY_HOPS) || 0));
  return resolveClientAddress({
    address: socket.handshake?.address || socket.request?.socket?.remoteAddress,
    headers: socket.handshake?.headers || socket.request?.headers,
    request: socket.request
  }, trustedProxyHops) || String(socket.id || 'unknown');
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
  const accountRights = runtime.accountRights || {};
  const restrictedError = { success: false, code: 'ACCOUNT_DELETION_PENDING', error: 'Account deletion is pending.' };

  on('check-username', (payload = {}, callback) => {
    // Availability is a read-only hint for the form. Registration still
    // performs the authoritative uniqueness check inside AccountStore.
    reply(callback, accountStore.checkUsername(payload.username));
  });

  on('account-logout', (payload = {}, callback) => {
    socket.data.accountId = null;
    socket.data.sessionAccountId = null;
    socket.data.sessionTokenHash = null;
    socket.data.resolveCookieSession = () => null;
    reply(callback, accountStore.logout(payload.sessionToken));
  });

  on('account-update', handleAccountUpdate);
  on('restore-session', handleRestoreSession);
  on('list-rooms', (_, callback) => {
    reply(callback, { success: true, rooms: roomManager.listPublicRooms() });
  });
  on('get-maintenance-state', (_, callback) => {
    reply(callback, { success: true, maintenance: runtime.maintenanceSnapshot() });
  });
  on('create-room', handleCreateRoom);
  on('leave-room', handleLeaveRoom);
  on('join-room', handleJoinRoom);
  on('set-player-appearance', handleSetPlayerAppearance);

  on('account-register', sessionGrantHandler(payload => accountStore.register(payload), false, true, false));
  on('account-login', sessionGrantHandler(payload => accountStore.login(payload), false, true));
  on('account-restore', sessionGrantHandler(payload => accountStore.restore(payload.sessionToken), true, true));

  on('account-export', (payload = {}, callback) => {
    const account = runtime.social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to download your account data.' });
    try {
      const result = typeof accountRights.export === 'function'
        ? accountRights.export({ account, payload, socket })
        : { success: false, code: 'ACCOUNT_EXPORT_UNAVAILABLE', error: 'Account export is not configured.' };
      return reply(callback, result);
    } catch (error) {
      return reply(callback, { success: false, code: 'ACCOUNT_EXPORT_FAILED', error: 'Account export is temporarily unavailable.' });
    }
  });

  on('account-revoke-sessions', (payload = {}, callback) => {
    const account = runtime.social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to manage sessions.' });
    const result = typeof accountRights.revokeSessions === 'function'
      ? accountRights.revokeSessions({ account, payload, socket })
      : { success: false, code: 'ACCOUNT_SESSION_UNAVAILABLE', error: 'Session management is not configured.' };
    return reply(callback, result);
  });

  on('account-delete-request', async (payload = {}, callback) => {
    const account = runtime.social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to manage your account.' });
    const room = roomManager.getRoomBySocket(socket.id);
    const result = typeof accountRights.requestDeletion === 'function'
      ? await accountRights.requestDeletion({ accountId: account.id, sessionId: socket.data.sessionId || payload.sessionId || null, currentPassword: payload.currentPassword, typedPhrase: payload.typedPhrase, requestId: payload.requestId, activeRoom: Boolean(room) })
      : { success: false, code: 'ACCOUNT_DELETION_UNAVAILABLE', error: 'Account deletion is not configured.' };
    if (result?.success) socket.emit('account-lifecycle', { state: 'deletion-pending', dueAt: result.dueAt || null, requestId: result.requestId || null });
    return reply(callback, result);
  });

  on('account-delete-cancel', async (payload = {}, callback) => {
    const account = runtime.social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to manage your account.' });
    const result = typeof accountRights.cancelDeletion === 'function'
      ? await accountRights.cancelDeletion({ accountId: account.id, currentPassword: payload.currentPassword, requestId: payload.requestId })
      : { success: false, code: 'ACCOUNT_DELETION_UNAVAILABLE', error: 'Account deletion is not configured.' };
    if (result?.success) socket.emit('account-lifecycle', { state: 'deletion-cancelled' });
    return reply(callback, result);
  });

  on('account-recovery-email-request', async (payload = {}, callback) => {
    const account = runtime.social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to manage recovery email.' });
    const result = typeof accountRights.requestRecoveryEmail === 'function'
      ? await accountRights.requestRecoveryEmail({ accountId: account.id, currentPassword: payload.currentPassword, email: payload.email })
      : { success: false, code: 'ACCOUNT_RECOVERY_UNAVAILABLE', error: 'Recovery email is not configured.' };
    return reply(callback, result);
  });

  on('account-recovery-email-verify', async (payload = {}, callback) => {
    const result = typeof accountRights.verifyRecoveryEmail === 'function'
      ? await accountRights.verifyRecoveryEmail({ token: payload.token })
      : false;
    return reply(callback, result === true ? { success: true, state: 'verified' } : { success: false, code: 'RECOVERY_TOKEN_INVALID', error: 'That verification link is invalid or expired.' });
  });

  on('set-setting', handleSetSetting);
  on('start-game', handleStartGame);

  // register/login/restore share the exact same flow: run the store verb,
  // adopt the session account on the socket, forward the store's ack verbatim.
  function stampOwnerAccount(result) {
    if (!result?.account?.id) return result;
    return { ...result, account: withAdminFlag(result.account, runtime.adminIds) };
  }

  function sessionGrantHandler(run, clearOnFailure = false, rateLimit = false, clearAttemptsOnSuccess = true) {
    return function sessionGrant(payload = {}, callback) {
      if (rateLimit && !allowAuthAttempt(socket)) {
        reply(callback, { success: false, error: 'Too many account attempts. Try again shortly.' });
        return;
      }
      const result = stampOwnerAccount(run(payload));
      if (result?.account?.id) {
        if (clearAttemptsOnSuccess) clearAuthAttempts(socket);
        socket.data.accountId = result.account.id;
        const token = result.sessionToken || payload.sessionToken;
        socket.data.sessionTokenHash = accountStore.sessionTokenHashFor(token);
        bindAccountToLobbySeat(result.account);
      } else if (clearOnFailure) {
        socket.data.accountId = null;
        socket.data.sessionTokenHash = null;
      }
      reply(callback, result);
    };
  }

  function bindAccountToLobbySeat(account) {
    if (!account?.id) return;
    const room = roomManager.getRoomBySocket(socket.id);
    const player = room?.getPlayerBySocket(socket.id);
    if (!room || !player || room.game.started) return;
    if (player.accountId && player.accountId !== account.id) return;
    const occupiedElsewhere = [...roomManager.rooms.values()].some(candidateRoom => candidateRoom !== room
      && candidateRoom.game.players.some(candidate => candidate.accountId === account.id && !candidate.bankrupt));
    if (occupiedElsewhere) return;
    const duplicate = room.game.players.some(candidate => candidate.id !== player.id && candidate.accountId === account.id);
    if (duplicate) return;
    player.accountId = account.id;
    room.game.setPlayerAppearance?.(socket.id, {
      nickname: account.displayName,
      color: account.color,
      avatarGrid: normalizeAvatarGrid(account.avatarGrid)
    });
    runtime.emitRoomState(room);
  }

  function handleAccountUpdate(payload = {}, callback) {
    const current = runtime.social.accountForSocket(socket, payload);
    if (current?.accountDeactivated === true) return reply(callback, restrictedError);
    const hasBearerToken = typeof payload.sessionToken === 'string' && payload.sessionToken !== '';
    const result = stampOwnerAccount(hasBearerToken
      ? accountStore.updateProfile(payload.sessionToken, payload)
      : accountStore.updateProfileForAccount?.(current, payload) || { success: false, error: 'Account session expired. Sign in again.' });
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
    if (typeof runtime.canCreateRoom === 'function' && !runtime.canCreateRoom()) {
      return reply(callback, {
        success: false,
        error: 'New rooms are paused for maintenance.',
        code: 'MAINTENANCE_DRAINING',
        maintenance: runtime.maintenanceSnapshot?.() || null
      });
    }
    const requestId = normalizeRequestId(payload?.requestId);
    const clientId = normalizeClientId(payload?.clientId);
    const account = runtime.social.accountForSocket(socket, payload);
    if (account?.accountDeactivated === true) return reply(callback, restrictedError);
    const request = buildCreateRoomRequest(payload, account);
    const replayKey = requestId ? createRoomReplayKey(account, clientId, socket.id, requestId) : '';
    const fingerprint = requestId ? createRoomFingerprint(request, clientId) : '';
    if (tryReplayCreateRoom({ replayKey, fingerprint, clientId, account, callback })) return;
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
      rememberCreateRoomReplay(replayKey, { fingerprint, roomCode: room.roomCode, ack });
    }
    reply(callback, ack);
    runtime.scheduleRoomsUpdated();
  }

  function tryReplayCreateRoom({ replayKey, fingerprint, clientId, account, callback }) {
    const replay = replayKey ? readCreateRoomReplay(replayKey) : null;
    if (!replay) return false;
    if (replay.fingerprint !== fingerprint) {
      reply(callback, { success: false, error: 'That create-room request ID was already used with different details.' });
      return true;
    }
    const replayRoom = roomManager.getRoom(replay.roomCode);
    if (!replayRoom) {
      createRoomReplays.delete(replayKey);
      return false;
    }
    restoreCreateRoomReplay({ room: replayRoom, clientId, account, ack: replay.ack, callback });
    return true;
  }

  function restoreCreateRoomReplay({ room, clientId, account, ack, callback }) {
    const replayPlayer = room.game.getPlayerByClient(clientId);
    const mappedRoom = roomManager.getRoomBySocket(socket.id);
    if (mappedRoom !== room) {
      if (seatIsLiveOnAnotherSocket(replayPlayer)) {
        return reply(callback, { success: false, error: 'That seat is already in use.' });
      }
      const restored = roomManager.restoreConnection(
        clientId,
        socket.id,
        account?.id,
        previousClientId => runtime.clearDisconnectTimer(previousClientId),
      );
      if (restored !== room) return reply(callback, { success: false, error: 'No active session found.' });
    }
    runtime.clearDisconnectTimer(clientId);
    leaveForeignRooms(room.roomCode);
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    runtime.emitPendingInteractions(room, socket, room.game.getPlayerByClient(clientId));
    reply(callback, ack);
  }

  function seatIsLiveOnAnotherSocket(player) {
    return Boolean(player?.socketId && player.socketId !== socket.id && !player.disconnected);
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
    if (account?.accountDeactivated === true) return reply(callback, restrictedError);
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
    const account = runtime.social.accountForSocket(socket, payload);
    if (account?.accountDeactivated === true) return reply(callback, restrictedError);
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
    const account = runtime.social.accountForSocket(socket, payload);
    if (account?.accountDeactivated === true) return reply(callback, restrictedError);
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    if (!player || room.hostId !== player.id) {
      return reply(callback, { success: false, error: 'Only the host can change settings.' });
    }
    if (room.game.started) {
      return reply(callback, { success: false, error: 'Game settings can only be changed before the game starts.' });
    }
    const normalizedBrain = String(value ?? '').trim().toLowerCase().replace('_', '-');
    if (key === 'botBrain' && normalizedBrain !== 'no-ai'
      && runtime.botProviderStatus?.().state === 'quota-exhausted') {
      return reply(callback, { success: false, code: 'AI_CREDITS_EXHAUSTED', error: 'AI credits are exhausted. Choose NO-AI BOT.' });
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
    if (typeof runtime.canStartRound === 'function' && !runtime.canStartRound()) {
      return reply(callback, {
        success: false,
        error: 'New rounds are paused for maintenance.',
        code: 'MAINTENANCE_DRAINING',
        maintenance: runtime.maintenanceSnapshot?.() || null
      });
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
