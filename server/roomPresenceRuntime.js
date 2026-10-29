import { isPlayerPresenceExpired, markPlayerActive, markPlayerInactive, PLAYER_INACTIVITY_REMOVAL_MS } from './playerPresence.js';
import { contractResponderId } from './contractLogic.js';

const SERVER_IDLE_SOURCE = 'server-idle';

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
  // Server-side idle clock, independent of client presence reports:
  // when each seat last sent a socket event, and when it began to block the table.
  const lastEventAt = new Map();
  const blockingSince = new Map();

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
    if (!room.game.started) {
      // Nobody times out while the lobby is being set up: the clock restarts
      // instead, so the seat only becomes removable once the game is running.
      player.presence = { ...player.presence, inactiveUntil: now() + PLAYER_INACTIVITY_REMOVAL_MS };
      synchronizeInactivityTimers(room);
      emitRoomState(room);
      return false;
    }
    const removed = removeSeatForReason(room, player, 'inactivity', false);
    if (removed) timers.delete(inactivityTimerKey(room, player.id));
    else watch.retryRemoval = true;
    return removed;
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
      delete watch.retryRemoval;
      expireInactiveSeat(watch, key);
      // Failed secured settlement retains the same watched identity and
      // presence deadline; retry without a zero-delay expiry loop.
      if (watch.retryRemoval && timers.get(key) === watch) watch.handle = setTimeoutFn(run, 1_000);
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

  // The seats a table is waiting on: the turn holder, and a recipient still to answer a pending trade or player contract.
  // The responder is not always the addressee: after a counter-offer, the seat that made the surviving offer decides.
  function blockingSeatIds(room) {
    if (!room.game?.started) return new Set();
    return new Set([
      room.game.getCurrentPlayer?.()?.id,
      room.game.pendingTrade?.toPlayerId,
      contractResponderId(room.game.pendingPlayerContract),
    ].filter(Boolean));
  }

  function idleClockStart(player) {
    const since = blockingSince.get(player.id);
    return Math.max(since, lastEventAt.get(player.id) ?? since);
  }

  // Returns true when any seat was idled, so the caller can broadcast the change.
  function idleSilentBlockingSeats(room, at) {
    const waiting = blockingSeatIds(room);
    let idled = false;
    room.game.players.forEach(player => {
      if (!waiting.has(player.id) || !isActiveHuman(player)) {
        blockingSince.delete(player.id);
        return;
      }
      if (!blockingSince.has(player.id)) blockingSince.set(player.id, at);
      if (hasInactivePresence(player) || at - idleClockStart(player) < PLAYER_INACTIVITY_REMOVAL_MS) return;
      // Tagged so a later socket event can tell a server-originated idle from a
      // presence the client reported itself (the tag never leaves the server).
      player.presence = { ...markPlayerInactive(player, { reason: 'idle', now: at }).presence, source: SERVER_IDLE_SOURCE };
      idled = true;
    });
    return idled;
  }

  // Successful interactive events from a seated human count as input for the idle clock. A seat the server idled that is plainly
  // still playing goes back to active, or its removal deadline would evict a live player. Keep this list to table interactions and
  // client presence changes. Callers that pass no event name keep the internal legacy behavior.
  const ACTIVITY_EVENTS = new Set([
    'player-presence', 'send-chat', 'set-setting', 'set-player-appearance', 'start-game',
    'roll-dice', 'purchase-property', 'upgrade-bank-account', 'fly-to-airport', 'set-airport-fees',
    'decline-property', 'auction-bid', 'end-turn', 'manage-property', 'propose-trade',
    'counter-trade', 'adjust-trade', 'cancel-trade', 'respond-trade', 'propose-player-contract',
    'counter-player-contract', 'adjust-player-contract', 'respond-player-contract', 'cancel-player-contract',
    'repay-player-contract', 'pay-jail-fine', 'use-jail-free', 'use-item', 'sell-item',
    'take-bank-loan', 'repay-bank-loan', 'market-order', 'open-margin', 'reduce-margin',
    'open-short', 'cover-short', 'settle-short-default', 'open-option', 'exercise-option',
    'close-position', 'vote-global-event', 'declare-bankruptcy', 'place-casino-bet',
    'room-votekick-start', 'room-votekick-cast', 'propose-equity-share-transfer',
    'request-sponsored-purchase', 'contribute-sponsored-purchase', 'withdraw-sponsored-purchase',
    'accept-sponsored-purchase', 'decline-sponsored-purchase',
  ]);

  function noteSocketEvent(socketId, eventName) {
    if (typeof eventName === 'string' && !ACTIVITY_EVENTS.has(eventName)) return;
    const room = roomManager.getRoomBySocket(socketId);
    const player = room?.getPlayerBySocket(socketId);
    if (!player) return;
    lastEventAt.set(player.id, now());
    if (player.presence?.source !== SERVER_IDLE_SOURCE) return;
    player.presence = markPlayerActive(player).presence;
    synchronizeInactivityTimers(room);
    emitRoomState(room);
  }

  // Idled seats enter the existing inactivity flow: emitting the room state
  // re-synchronises the removal timers.
  function sweepIdleSeats() {
    const at = now();
    for (const room of roomManager.rooms.values()) {
      if (idleSilentBlockingSeats(room, at)) emitRoomState(room);
    }
    forgetUnseatedPlayers();
  }

  // A voluntary leave never reaches clearPlayer, so the sweep drops the idle
  // bookkeeping of any seat id that is not seated in a live room.
  function forgetUnseatedPlayers() {
    const seated = new Set();
    for (const room of roomManager.rooms.values()) room.game.players.forEach(player => seated.add(player.id));
    for (const playerId of [...lastEventAt.keys(), ...blockingSince.keys()]) {
      if (seated.has(playerId)) continue;
      lastEventAt.delete(playerId);
      blockingSince.delete(playerId);
    }
  }

  function clearRoom(room) {
    clearInactivityTimer(room);
    room?.game?.players?.forEach(player => {
      lastEventAt.delete(player.id);
      blockingSince.delete(player.id);
    });
  }

  function clearPlayer(room, playerId) {
    clearInactivityTimer(room, playerId);
    lastEventAt.delete(playerId);
    blockingSince.delete(playerId);
  }

  // Seats the idle clock currently holds state for (diagnostics and tests).
  function trackedSeatCount() {
    return new Set([...lastEventAt.keys(), ...blockingSince.keys()]).size;
  }

  return {
    clearRoom,
    clearPlayer,
    trackedSeatCount,
    noteSocketEvent,
    scheduleInactivityTimer,
    sweepIdleSeats,
    synchronizeInactivityTimers,
    setPlayerPresence,
  };
}
