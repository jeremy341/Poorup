// The account and room-lifecycle socket domain: registration, login, session restore, public-room browsing, and the create, join,
// leave, set-setting and start-game handlers. Their guard chains follow the propertyApi.js style. Every ack payload, system message
// and emit order is wire-identical (server/rooms.test.js pins the error strings and order).
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
import { peerBucketKey, pruneWindowBuckets, windowBucket } from './rateBuckets.js';

const AUTH_ATTEMPT_WINDOW_MS = 60_000;
const AUTH_ATTEMPT_LIMIT = 8;
const AUTH_ATTEMPT_LIMITED = 'Too many account attempts. Try again shortly.';
const authAttempts = new Map();
const CREATE_ROOM_REPLAY_TTL_MS = 2 * 60_000;
const CREATE_ROOM_REPLAY_LIMIT = 1_000;
const createRoomReplays = new Map();
// An empty list is never a valid avatar grid.
const INVALID_AVATAR_GRID = Object.freeze([]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
}

function createRoomFingerprint(request, clientId) {
  // Fingerprints only normalized room fields. Session tokens and
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

// The per-address key every pre-auth budget (and the anonymous social budgets)
// uses: the proxy-aware client address, with an IPv6 client collapsed to its /64.
export function authAttemptKey(socket) {
  const trustedProxyHops = Math.max(0, Math.floor(Number(process.env.POORUP_TRUST_PROXY_HOPS) || 0));
  const address = resolveClientAddress({
    address: socket.handshake?.address || socket.request?.socket?.remoteAddress,
    headers: socket.handshake?.headers || socket.request?.headers,
    request: socket.request
  }, trustedProxyHops);
  return (address && peerBucketKey(address)) || String(socket.id || 'unknown');
}

// Every password-checking event (login, register, delete request or cancel, recovery-email request) spends this per-address budget.
// A success never refunds it: an attacker could otherwise interleave a login to an account they own between guesses at someone else's password.
function allowAuthAttempt(socket) {
  const now = Date.now();
  const bucket = windowBucket(authAttempts, authAttemptKey(socket), now, AUTH_ATTEMPT_WINDOW_MS);
  bucket.count += 1;
  pruneWindowBuckets(authAttempts, now, AUTH_ATTEMPT_WINDOW_MS);
  return bucket.count <= AUTH_ATTEMPT_LIMIT;
}

// Username availability answers "is this name registered", so it is walked at
// socket speed unless each address has its own budget.
const USERNAME_CHECK_WINDOW_MS = 60_000;
const USERNAME_CHECK_LIMIT = 30;
const USERNAME_CHECK_LIMITED = 'Too many username checks. Try again shortly.';
const usernameChecks = new Map();

function allowUsernameCheck(socket, now = Date.now()) {
  const bucket = windowBucket(usernameChecks, authAttemptKey(socket), now, USERNAME_CHECK_WINDOW_MS);
  bucket.count += 1;
  pruneWindowBuckets(usernameChecks, now, USERNAME_CHECK_WINDOW_MS);
  return bucket.count <= USERNAME_CHECK_LIMIT;
}

// Private invite codes are short enough to guess at socket speed, so each peer
// gets a budget of failed joins per window. Successful joins never count.
const JOIN_FAILURE_WINDOW_MS = 10 * 60_000;
const JOIN_FAILURE_LIMIT = 30;
const joinFailures = new Map();
const JOIN_THROTTLED_ERROR = 'Too many join attempts. Try again shortly.';

function joinAttemptsExhausted(socket, now = Date.now()) {
  const current = joinFailures.get(authAttemptKey(socket));
  if (!current || now - current.startedAt >= JOIN_FAILURE_WINDOW_MS) return false;
  return current.count >= JOIN_FAILURE_LIMIT;
}

function recordJoinFailure(socket, now = Date.now()) {
  const bucket = windowBucket(joinFailures, authAttemptKey(socket), now, JOIN_FAILURE_WINDOW_MS);
  bucket.count += 1;
  pruneWindowBuckets(joinFailures, now, JOIN_FAILURE_WINDOW_MS);
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
    if (!allowUsernameCheck(socket)) return reply(callback, { success: false, error: USERNAME_CHECK_LIMITED });
    reply(callback, accountStore.checkUsername(payload.username));
  });

  on('account-logout', (payload = {}, callback) => {
    socket.data.accountId = null;
    socket.data.sessionTokenHash = null;
    const legacyToken = typeof payload.sessionToken === 'string' ? payload.sessionToken : '';
    try {
      const result = accountStore.logout(legacyToken);
      if (result?.success && legacyToken) {
        if (typeof runtime.sessionStore?.revokeLegacyTokenSessions !== 'function') throw new Error('Legacy session lineage is unavailable.');
        runtime.sessionStore.revokeLegacyTokenSessions(legacyToken);
      }
      reply(callback, result);
    } catch {
      reply(callback, { success: false, code: 'ACCOUNT_LOGOUT_FAILED', error: 'Sign out could not be completed.' });
    }
    refreshLockoutState();
  });

  on('account-update', handleAccountUpdate);
  on('restore-session', handleRestoreSession);
  on('list-rooms', (_, callback) => {
    reply(callback, { success: true, rooms: roomManager.listPublicRooms() });
  });
  on('get-maintenance-state', (_, callback) => {
    reply(callback, { success: true, maintenance: runtime.maintenanceStateFor ? runtime.maintenanceStateFor(socket) : runtime.maintenanceSnapshot() });
  });
  on('create-room', handleCreateRoom);
  on('leave-room', handleLeaveRoom);
  on('join-room', handleJoinRoom);
  on('set-player-appearance', handleSetPlayerAppearance);

  on('account-register', sessionGrantHandler(payload => accountStore.register(payload), false, true));
  on('account-login', sessionGrantHandler(payload => accountStore.login(payload), false, true));
  // Restore presents a 256-bit session token, not a guessable secret, so it
  // does not spend the password-attempt budget.
  on('account-restore', sessionGrantHandler(payload => accountStore.restore(payload.sessionToken), true, false));

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
    if (!allowAuthAttempt(socket)) return reply(callback, { success: false, error: AUTH_ATTEMPT_LIMITED });
    const room = roomManager.getRoomBySocket(socket.id);
    const result = typeof accountRights.requestDeletion === 'function'
      ? await accountRights.requestDeletion({ accountId: account.id, sessionId: socket.data.sessionId || null, sessionToken: payload.sessionToken || null, currentPassword: payload.currentPassword, typedPhrase: payload.typedPhrase, requestId: payload.requestId, activeRoom: Boolean(room) })
      : { success: false, code: 'ACCOUNT_DELETION_UNAVAILABLE', error: 'Account deletion is not configured.' };
    if (result?.success) socket.emit('account-lifecycle', { state: 'deletion-pending', dueAt: result.dueAt || null, requestId: result.requestId || null });
    return reply(callback, result);
  });

  on('account-delete-cancel', async (payload = {}, callback) => {
    const account = runtime.social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to manage your account.' });
    if (!allowAuthAttempt(socket)) return reply(callback, { success: false, error: AUTH_ATTEMPT_LIMITED });
    const result = typeof accountRights.cancelDeletion === 'function'
      ? await accountRights.cancelDeletion({ accountId: account.id, currentPassword: payload.currentPassword, requestId: payload.requestId })
      : { success: false, code: 'ACCOUNT_DELETION_UNAVAILABLE', error: 'Account deletion is not configured.' };
    if (result?.success) socket.emit('account-lifecycle', { state: 'deletion-cancelled' });
    return reply(callback, result);
  });

  on('account-recovery-email-request', async (payload = {}, callback) => {
    const account = runtime.social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to manage recovery email.' });
    if (!allowAuthAttempt(socket)) return reply(callback, { success: false, error: AUTH_ATTEMPT_LIMITED });
    const result = typeof accountRights.requestRecoveryEmail === 'function'
      ? await accountRights.requestRecoveryEmail({ accountId: account.id, currentPassword: payload.currentPassword, email: payload.email })
      : { success: false, code: 'ACCOUNT_RECOVERY_UNAVAILABLE', error: 'Recovery email is not configured.' };
    return reply(callback, result);
  });

  on('account-recovery-email-verify', async (payload = {}, callback) => {
    // Only the account that requested the address may confirm it from a socket.
    const account = runtime.social.accountForSocket(socket, payload);
    if (!account) return reply(callback, { success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to verify your recovery email.' });
    const result = typeof accountRights.verifyRecoveryEmail === 'function'
      ? await accountRights.verifyRecoveryEmail({ token: payload.token, accountId: account.id })
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

  function sessionGrantHandler(run, clearOnFailure = false, rateLimit = false) {
    return function sessionGrant(payload = {}, callback) {
      if (rateLimit && !allowAuthAttempt(socket)) {
        reply(callback, { success: false, error: AUTH_ATTEMPT_LIMITED });
        return;
      }
      const result = stampOwnerAccount(run(payload));
      if (result?.account?.id) {
        socket.data.accountId = result.account.id;
        const token = result.sessionToken || payload.sessionToken;
        socket.data.sessionTokenHash = accountStore.sessionTokenHashFor(token);
        bindAccountToLobbySeat(result.account);
      } else if (clearOnFailure) {
        socket.data.accountId = null;
        socket.data.sessionTokenHash = null;
      }
      reply(callback, result);
      refreshLockoutState();
    };
  }

  // Signing in or out as an admin account changes this socket's lockout
  // bypass, so the client is told its own state again (only during a lockout).
  function refreshLockoutState() {
    if (runtime.maintenanceSnapshot?.().lockout === true) runtime.emitMaintenanceState?.(socket);
  }

  function bindAccountToLobbySeat(account) {
    // A pending deletion may sign in to cancel it, but never takes a table seat.
    if (!account?.id || account.accountDeactivated === true) return;
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
    adoptBearerHash(payload);
    syncLobbySeatAppearance(result);
    reply(callback, result);
  }

  // Remember the bearer a request presented. A request without one says nothing
  // about the socket's session, so it must not overwrite the binding with null.
  function adoptBearerHash(payload) {
    if (typeof payload.sessionToken !== 'string' || !payload.sessionToken) return;
    const hash = accountStore.sessionTokenHashFor(payload.sessionToken);
    if (hash) socket.data.sessionTokenHash = hash;
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

  // The account-seat reclaim replaces a previous clientId; its grace timer is
  // keyed by the room that seat is in. The seat is attached just after this
  // runs, so the clear is flagged as the reconnect it is.
  function clearReclaimedTimer(previousClientId, reclaimedRoom) {
    runtime.clearDisconnectTimer(previousClientId, reclaimedRoom, { reconnected: true });
  }

  function handleRestoreSession(payload = {}, callback) {
    const account = runtime.social.accountForSocket(socket, payload);
    const clientId = normalizeClientId(payload.clientId);
    if (!clientId) return reply(callback, { success: false, error: 'No active session found.' });
    // Empty "restore-session" requests are normal on a fresh tab. Only count
    // failures when the registry had a retained seat that this socket could
    // reasonably be trying to restore.
    const hadRestoreCandidate = Boolean(
      roomManager.findRestoreRoomFor?.(clientId, socket.id)
      || (account?.id && roomManager.findDisconnectedAccountSeat?.(account.id))
    );
    const recordRestoreFailure = () => {
      if (!hadRestoreCandidate) return;
      try { runtime.metrics?.incrementMetric?.('restore-failures', { source: 'room-session' }); } catch { /* metrics must not affect a reconnect */ }
    };
    let room;
    try {
      room = roomManager.restoreConnection(clientId, socket.id, account?.id, clearReclaimedTimer);
    } catch (error) {
      recordRestoreFailure();
      throw error;
    }
    if (!room) {
      recordRestoreFailure();
      return reply(callback, { success: false, error: 'No active session found.' });
    }
    adoptBearerHash(payload);
    runtime.clearDisconnectTimer(clientId, room);
    joinRestoredRoom(room, account, clientId, callback);
  }

  function joinRestoredRoom(room, account, clientId, callback) {
    leaveForeignRooms(room.roomCode);
    socket.join(room.roomCode);
    if (account?.id) socket.data.accountId = account.id;
    runtime.recordPlayerActivity?.(socket);
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

  function maintenanceRefusal(pausedError) {
    if (typeof runtime.lockoutRefusal === 'function') return runtime.lockoutRefusal(socket, pausedError);
    return { success: false, error: pausedError, code: 'MAINTENANCE_DRAINING', maintenance: runtime.maintenanceSnapshot?.() || null };
  }

  function handleCreateRoom(payload, callback) {
    if (typeof runtime.canCreateRoom === 'function' && !runtime.canCreateRoom(socket)) {
      return reply(callback, maintenanceRefusal('New rooms are paused for maintenance.'));
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
    const conflict = privateCodeConflict(request, clientId, account);
    if (conflict) return reply(callback, { success: false, error: conflict });
    // One seat per clientId and per account across rooms, as the join guard enforces it: a seat held elsewhere is never duplicated.
    // The check runs before any seat is released, so a refused request never drops a seat still in disconnect grace or settles another
    // socket's seat as a bankruptcy. This socket's own live seat may move.
    const heldElsewhere = roomManager.identitySeatElsewhere(null, {
      clientId,
      accountId: request.accountId,
      socketId: socket.id
    });
    if (heldElsewhere) return reply(callback, { success: false, error: heldElsewhere });
    const previousExit = leavePreviousRoom(clientId, account);
    if (previousExit?.success === false) return reply(callback, previousExit);
    // Any other seat this socket still holds is abandoned by creating a room; an
    // empty lobby left behind would stay registered and listed until the GC.
    runtime.releaseSocketSeats?.(socket);
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
        clearReclaimedTimer,
      );
      if (restored !== room) return reply(callback, { success: false, error: 'No active session found.' });
    }
    runtime.clearDisconnectTimer(clientId, room);
    leaveForeignRooms(room.roomCode);
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    runtime.emitPendingInteractions(room, socket, room.game.getPlayerByClient(clientId));
    reply(callback, ack);
  }

  function seatIsLiveOnAnotherSocket(player) {
    return Boolean(player?.socketId && player.socketId !== socket.id && !player.disconnected);
  }

  // A room with no human seat must not lock its private code for the full GC grace period, so it is reclaimed. A seat still in its
  // grace window belongs to a person who can restore it, and that room keeps the code. A clientId or account the room kicked may not
  // reclaim the code either.
  function privateCodeConflict(request, clientId, account) {
    if (!request.requestedRoomCode) return null;
    const existingRoom = roomManager.getRoom(request.requestedRoomCode);
    if (!existingRoom) return null;
    // Answering 'in use' confirms a live code, so probing it spends the same
    // failed-join budget join-room does.
    if (joinAttemptsExhausted(socket)) return JOIN_THROTTLED_ERROR;
    if (!existingRoom.hasHumanSeats() && !existingRoom.isSeatBlocked(clientId, account?.id)) {
      runtime.destroyRoom(existingRoom);
      return null;
    }
    recordJoinFailure(socket);
    return 'That private room code is already in use. Choose another.';
  }

  // The room holding this client's seat, preferring the one this socket is
  // seated in: a live seat moved between rooms leaves a second, graced seat
  // under the same clientId, which the registry order would otherwise pick.
  function roomForClient(clientId) {
    const mapped = roomManager.getRoomBySocket(socket.id);
    if (mapped && mapped.game.getPlayerByClient(clientId)) return mapped;
    return roomManager.getRoomByClient(clientId);
  }

  function leavePreviousRoom(clientId, account) {
    const previousRoom = roomForClient(clientId);
    const previousPlayer = previousRoom?.game.getPlayerByClient(clientId);
    if (!previousPlayer || !canManageSeat(previousRoom, previousPlayer, account)) return false;
    const prepared = runtime.resolveSeatExitObligations?.(previousRoom, previousPlayer, 'leaving the table');
    if (prepared?.success === false) return prepared;
    const departedPlayerId = previousRoom?.game.getPlayerByClient(clientId)?.id;
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id, previousRoom);
    if (!oldRoom) return false;
    if (oldRoom.success === false) return oldRoom;
    runtime.clearDisconnectTimer(clientId, previousRoom);
    if (departedPlayerId) {
      runtime.reassignHostIfNeeded(oldRoom, departedPlayerId);
    }
    runtime.emitRoomState(oldRoom);
    return true;
  }

  // A room action carries a clientId for tab-restart recovery, but that value must not let an unrelated socket evict someone else's seat.
  // The current socket may release its own seat, and an authenticated account may release its own disconnected seat after a tab restart.
  // Guest seats have no durable identity, so they require the owning socket.
  function canManageSeat(room, player, account) {
    if (!room || !player) return false;
    const mappedRoom = roomManager.getRoomBySocket(socket.id);
    const mappedPlayer = mappedRoom?.getPlayerBySocket(socket.id);
    if (mappedRoom === room && mappedPlayer?.id === player.id) return true;
    // A socket seated in another room may not release a seat there: that would
    // strand its own live seat behind a mapping that does not name it.
    if (mappedRoom && mappedRoom !== room) return false;
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
    const targetRoom = roomForClient(clientId);
    const targetPlayer = targetRoom?.game.getPlayerByClient(clientId);
    if (targetPlayer && !canManageSeat(targetRoom, targetPlayer, account)) {
      return reply(callback, { success: false, error: 'No active session found.' });
    }
    const currentRoom = roomForClient(clientId);
    const departing = currentRoom?.game.getPlayerByClient(clientId) || null;
    const wasStarted = Boolean(currentRoom?.game.started);
    // A voluntary leave cancels and announces the same obligations an expiry does.
    if (currentRoom && departing) {
      const prepared = runtime.resolveSeatExitObligations?.(currentRoom, departing, 'leaving the table');
      if (prepared?.success === false) return reply(callback, prepared);
    }
    const oldRoom = roomManager.leaveRoomByClient(clientId, socket.id, currentRoom || undefined);
    if (oldRoom?.success === false) return reply(callback, oldRoom);
    runtime.clearDisconnectTimer(clientId, targetRoom);
    announceRoomDeparture(oldRoom, departing, currentRoom, wasStarted);
    reply(callback, { success: true });
  }

  function announceRoomDeparture(oldRoom, departing, currentRoom, wasStarted) {
    if (!oldRoom) return;
    const departedId = departing?.id;
    const nickname = departing?.nickname || 'A player';
    const wasPublic = currentRoom?.visibility === 'public';
    // Reassign the host on lobby AND started rooms, so a branch that skips it
    // cannot leave an orphan lobby.
    if (departedId) {
      runtime.reassignHostIfNeeded(oldRoom, departedId);
    }
    socket.leave(oldRoom.roomCode);
    runtime.emitRoomState(oldRoom);
    if (!wasStarted) {
      runtime.io.in(oldRoom.roomCode).emit('system-message', { text: `${nickname} left the room.` });
    }
    if (wasPublic) {
      runtime.scheduleRoomsUpdated();
    }
  }

  function rejectJoin(callback, error) {
    recordJoinFailure(socket);
    return reply(callback, { success: false, error });
  }

  function handleJoinRoom(payload, callback) {
    if (joinAttemptsExhausted(socket)) return reply(callback, { success: false, error: JOIN_THROTTLED_ERROR });
    const roomCode = normalizeRoomCode(payload?.roomCode);
    const roomId = normalizeRoomId(payload?.roomId);
    const account = runtime.social.accountForSocket(socket, payload);
    if (account?.accountDeactivated === true) return reply(callback, restrictedError);
    const participant = buildRoomParticipant(payload, account);
    if (participant.accountId) socket.data.accountId = participant.accountId;
    const clientId = normalizeClientId(payload?.clientId);
    const validationError = validateJoinRoomRequest({ roomCode, roomId, nickname: participant.nickname });
    if (validationError) {
      return rejectJoin(callback, validationError);
    }
    // The lockout refuses a new seat before the room is looked up, so the
    // answer is the same whether or not the code exists. Only a client that
    // already holds a seat in that room may come back to it.
    if (typeof runtime.canJoinRoom === 'function') {
      const seatRoom = roomManager.getRoomByClient(clientId);
      const reconnecting = Boolean(seatRoom) && seatRoom === joinRoomTarget(roomManager, roomCode, roomId);
      if (!runtime.canJoinRoom(socket, account, { reconnecting })) return reply(callback, maintenanceRefusal('New rooms are paused for maintenance.'));
    }
    const room = joinRoomTarget(roomManager, roomCode, roomId);
    if (!room) {
      return rejectJoin(callback, 'Room not found.');
    }
    if (seatUnavailable(room, clientId, socket.id)) {
      return rejectJoin(callback, 'That seat is already in use.');
    }
    // One seat per clientId and per account across rooms: a seat held elsewhere
    // is never moved, duplicated, or left with a timer nobody owns.
    const seatConflict = roomManager.identitySeatElsewhere(room, { clientId, accountId: participant.accountId, socketId: socket.id });
    if (seatConflict) return rejectJoin(callback, seatConflict);
    const reconnectingSeat = Boolean(room.game.getPlayerByClient(clientId));
    const result = room.addOrReconnectPlayer(toJoinPlayerInfo(participant, clientId, socket.id));
    if (!result.success) {
      return rejectJoin(callback, result.error);
    }
    runtime.clearDisconnectTimer(clientId, room);
    // Do not abandon the current room until the target seat has passed all
    // capacity/state checks. A failed join must leave the player exactly where
    // they were, including their socket-room membership and seat mapping.
    runtime.leaveAllGameRooms(socket);
    runtime.detachSocketFromOtherRoom(socket, room);
    completeRoomJoin(room, participant, result, reconnectingSeat);
    reply(callback, roomAccessAck(room));
    runtime.scheduleRoomsUpdated();
  }

  function completeRoomJoin(room, participant, result, reconnectingSeat = false) {
    roomManager.socketRoom.set(socket.id, room);
    socket.join(room.roomCode);
    runtime.emitRoomState(room);
    runtime.emitPendingInteractions(room, socket, result.player);
    if (reconnectingSeat) {
      runtime.io.in(room.roomCode).emit('system-message', { text: `${participant.nickname} joined the room.` });
    }
  }

  // An omitted grid keeps the current face and null clears it; anything else is
  // cleaned to canonical 8x8, and a grid that cannot be cleaned is passed on as
  // an invalid value so the game rejects it instead of wiping the face.
  function requestedAvatarGrid(value) {
    if (value === undefined || value === null) return value;
    return normalizeAvatarGrid(value) ?? INVALID_AVATAR_GRID;
  }

  function handleSetPlayerAppearance(payload = {}, callback) {
    const account = runtime.social.accountForSocket(socket, payload);
    if (account?.accountDeactivated === true) return reply(callback, restrictedError);
    const { color, nickname } = payload;
    const avatarGrid = requestedAvatarGrid(payload.avatarGrid);
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
    if (['rulesetPreset', 'rulesetBase', 'rulesetOverrides'].includes(key)) {
      return reply(callback, { success: false, error: 'Ruleset presets and custom overrides are no longer supported.' });
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
    if (typeof runtime.canStartRound === 'function' && !runtime.canStartRound(socket)) {
      return reply(callback, maintenanceRefusal('New rounds are paused for maintenance.'));
    }
    const result = room.startGame();
    if (!result.success) {
      return reply(callback, { success: false, error: result.error });
    }
    runtime.emitRoomState(room);
    reply(callback, { success: true });
    runtime.scheduleRoomsUpdated();
  }
}

export { registerAccountSocketHandlers };
