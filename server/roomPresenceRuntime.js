import { isPlayerPresenceExpired, markPlayerActive, markPlayerInactive } from './playerPresence.js';

function inactivityTimerKey(room, playerId) {
  return `${room.roomCode}:${playerId}`;
}

function isActiveHuman(player) {
  return !player.isBot && !player.bankrupt && !player.disconnected;
}

function hasInactivePresence(player) {
  return player.presence?.state === 'inactive';
}

function watchMatchesPlayer(watch, player) {
  return watch.player === player
    && watch.socketId === player.socketId
    && watch.deadline === player.presence?.inactiveUntil;
}

function createInactivityWatch(room, player, handle) {
  return {
    room,
    roomCode: room.roomCode,
    player,
    playerId: player.id,
    clientId: player.clientId,
    socketId: player.socketId,
    deadline: player.presence.inactiveUntil,
    handle,
  };
}

function isActiveRoomSeat(room, player) {
  if (!room) return false;
  if (!player) return false;
  return !player.isBot && !player.bankrupt && !player.disconnected;
}

function watchIsCurrent(timers, key, watch) {
  return timers.get(key) === watch;
}

function isWatchedSeat(room, watch, player) {
  if (room !== watch.room) return false;
  if (player !== watch.player) return false;
  return player?.socketId === watch.socketId;
}

function playerMayExpire(player) {
  return ![player?.disconnected, player?.bankrupt, player?.isBot].some(Boolean);
}

function playerDeadlineExpired(player, now) {
  return isPlayerPresenceExpired(player, now);
}

function nextPresence(player, payload, now) {
  if (payload.state === 'active') return markPlayerActive(player).presence;
  if (payload.state !== 'inactive') return null;
  if (payload.reason !== 'hidden' && payload.reason !== 'idle') return null;
  return markPlayerInactive(player, { reason: payload.reason, now }).presence;
}

export function createRoomPresenceRuntime({
  roomManager,
  runRoomTimer,
  setTimeoutFn,
  clearTimeoutFn,
  now,
  emitRoomState,
  removeSeatForReason,
}) {
  const timers = new Map();

  function clearInactivityTimer(room, playerId = null) {
    if (!room?.roomCode) return;
    const prefix = `${room.roomCode}:`;
    for (const [key, watch] of timers) {
      if (watch.room !== room) continue;
      if (playerId && watch.playerId !== playerId) continue;
      clearTimeoutFn(watch.handle);
      if (key.startsWith(prefix)) timers.delete(key);
    }
  }

  function expireInactiveSeat(watch, key) {
    if (!watchIsCurrent(timers, key, watch)) return false;
    const room = roomManager.getRoom(watch.roomCode);
    const player = room?.game.getPlayerByClient(watch.clientId);
    if (!isWatchedSeat(room, watch, player)) return false;
    if (!playerMayExpire(player)) return false;
    if (!playerDeadlineExpired(player, now())) return false;
    timers.delete(inactivityTimerKey(room, player.id));
    return removeSeatForReason(room, player, 'inactivity', false);
  }

  function scheduleInactivityTimer(room, player) {
    const key = inactivityTimerKey(room, player.id);
    const existing = timers.get(key);
    if (existing && watchMatchesPlayer(existing, player)) return;
    if (existing) clearTimeoutFn(existing.handle);
    if (!hasInactivePresence(player)) {
      timers.delete(key);
      return;
    }
    const watch = createInactivityWatch(room, player, null);
    const run = () => runRoomTimer('player-inactivity-expiry', room.roomCode, () => {
      if (timers.get(key) !== watch) return;
      const remaining = watch.deadline - now();
      if (remaining > 0) {
        watch.handle = setTimeoutFn(run, remaining);
        return;
      }
      expireInactiveSeat(watch, key);
    });
    watch.handle = setTimeoutFn(run, Math.max(0, watch.deadline - now()));
    timers.set(key, watch);
  }

  function removeStaleRoomWatches(room, activePlayerIds) {
    for (const [key, watch] of timers) {
      if (watch.room !== room) continue;
      if (activePlayerIds.has(watch.playerId) && hasInactivePresence(watch.player)) continue;
      clearTimeoutFn(watch.handle);
      timers.delete(key);
    }
  }

  function synchronizeInactivityTimers(room) {
    if (!room) return;
    const activePlayers = room.game.players.filter(isActiveHuman);
    const activePlayerIds = new Set(activePlayers.map(player => player.id));
    removeStaleRoomWatches(room, activePlayerIds);
    activePlayers.forEach(player => scheduleInactivityTimer(room, player));
  }

  function setPlayerPresence(socket, payload = {}) {
    const room = roomManager.getRoomBySocket(socket?.id);
    const player = room?.getPlayerBySocket(socket.id);
    if (!isActiveRoomSeat(room, player)) return { success: false, error: 'That room seat is no longer active.' };
    const presence = nextPresence(player, payload, now());
    if (!presence) return { success: false, error: 'Invalid presence state.' };
    player.presence = presence;
    synchronizeInactivityTimers(room);
    emitRoomState(room);
    return { success: true, presence: player.presence };
  }

  function clearRoom(room) {
    clearInactivityTimer(room);
  }

  function clearPlayer(room, playerId) {
    clearInactivityTimer(room, playerId);
  }

  return { clearRoom, clearPlayer, scheduleInactivityTimer, synchronizeInactivityTimers, setPlayerPresence };
}
