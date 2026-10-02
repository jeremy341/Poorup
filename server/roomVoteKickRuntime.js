import {
  VOTE_KICK_COOLDOWN_MS,
  VOTE_KICK_DURATION_MS,
  startRoomVoteKick as createRoomVoteKick,
  castRoomVoteKick as applyRoomVoteKickBallot,
} from './roomVoteKick.js';
import { normalizeRequestId } from './requestId.js';

function publicVoteKick(vote) {
  if (!vote) return null;
  const ballots = Object.values(vote.ballots || {});
  return {
    voteId: vote.voteId,
    targetPlayerId: vote.targetPlayerId,
    openedAt: vote.openedAt,
    expiresAt: vote.expiresAt,
    eligibleCount: vote.eligibleCount,
    yesCount: ballots.filter(choice => choice === 'yes').length,
    noCount: ballots.filter(choice => choice === 'no').length,
    requiredYes: vote.requiredYes,
    status: vote.status,
  };
}

function requestIdFrom(payload) {
  if (typeof payload?.requestId !== 'string') return '';
  return normalizeRequestId(payload.requestId);
}

function replayKeyFor(player, requestId) {
  return `${player.id}:${requestId}`;
}

function replayResult(previous, payload) {
  if (!previous) return null;
  if (previous.fingerprint !== JSON.stringify(payload)) return { success: false, error: 'That request ID was already used.' };
  return previous.result;
}

function storeReplay(room, key, payload, result) {
  room.voteKickReplays.set(key, { fingerprint: JSON.stringify(payload), result });
  while (room.voteKickReplays.size > 500) room.voteKickReplays.delete(room.voteKickReplays.keys().next().value);
}

export function createRoomVoteKickRuntime({ io, roomManager, runRoomTimer, setTimeoutFn, clearTimeoutFn, now, removeSeatForReason }) {
  const timers = new Map();

  function emitVoteKickState(room, vote) {
    const snapshot = publicVoteKick(vote);
    room.voteKickSnapshot = snapshot;
    io.in(room.roomCode).emit('room-votekick-update', { vote: snapshot });
    return snapshot;
  }

  function getReplay({ room, player, requestId, payload, result = null }) {
    if (!room.voteKickReplays) room.voteKickReplays = new Map();
    const key = replayKeyFor(player, requestId);
    const cached = replayResult(room.voteKickReplays.get(key), payload);
    if (cached) return cached;
    if (result) storeReplay(room, key, payload, result);
    return null;
  }

  function startContext(socket, payload) {
    const room = roomManager.getRoomBySocket(socket?.id);
    const initiator = room?.getPlayerBySocket(socket.id);
    const requestId = requestIdFrom(payload);
    if (!room) return { error: 'A current room seat and request ID are required.' };
    if (!initiator) return { error: 'A current room seat and request ID are required.' };
    if (!requestId) return { error: 'A current room seat and request ID are required.' };
    return { room, initiator, requestId };
  }

  function createVote(room, initiator, payload) {
    const cooldowns = room.voteKickCooldowns || (room.voteKickCooldowns = new Map());
    return createRoomVoteKick({
      players: room.game.players,
      initiatorId: initiator.id,
      targetPlayerId: typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '',
      now: now(),
      activeVote: room.voteKick?.status === 'open' ? room.voteKick : null,
      cooldownUntil: cooldowns.get(initiator.id) || 0,
    });
  }

  function failedStart(room, initiator, requestId, payload) {
    const result = { success: false, error: 'A vote cannot be started for that player right now.' };
    getReplay({ room, player: initiator, requestId, payload, result });
    return result;
  }

  function setVoteIdentity(room, initiator, vote) {
    room.voteKickCounter = (room.voteKickCounter || 0) + 1;
    vote.voteId = `${room.roomCode}-${now().toString(36)}-${room.voteKickCounter.toString(36)}`;
    room.voteKick = vote;
    room.voteKickCooldowns.set(initiator.id, now() + VOTE_KICK_COOLDOWN_MS);
  }

  function expireVote(room, vote) {
    if (room.voteKick !== vote || vote.status !== 'open') return;
    vote.status = 'expired';
    timers.delete(room.roomCode);
    emitVoteKickState(room, vote);
  }

  function scheduleExpiry(room, vote) {
    const existing = timers.get(room.roomCode);
    if (existing) clearTimeoutFn(existing);
    const timer = setTimeoutFn(() => runRoomTimer('room-votekick-expiry', room.roomCode, () => expireVote(room, vote)), VOTE_KICK_DURATION_MS);
    timers.set(room.roomCode, timer);
  }

  function startRoomVoteKick(socket, payload = {}) {
    const context = startContext(socket, payload);
    if (context.error) return { success: false, error: context.error };
    const { room, initiator, requestId } = context;
    const replay = getReplay({ room, player: initiator, requestId, payload });
    if (replay) return replay;
    const vote = createVote(room, initiator, payload);
    if (!vote) return failedStart(room, initiator, requestId, payload);
    setVoteIdentity(room, initiator, vote);
    const snapshot = emitVoteKickState(room, vote);
    scheduleExpiry(room, vote);
    const result = { success: true, vote: snapshot };
    getReplay({ room, player: initiator, requestId, payload, result });
    return result;
  }

  function hasVoteIdMismatch(vote, payload) {
    if (!vote) return false;
    return payload.voteId !== vote.voteId;
  }

  function isInvalidCastContext({ room, voter, requestId, vote, payload }) {
    return [!room, !voter, !requestId, !vote, hasVoteIdMismatch(vote, payload)].some(Boolean);
  }

  function castContext(socket, payload) {
    const room = roomManager.getRoomBySocket(socket?.id);
    const voter = room?.getPlayerBySocket(socket.id);
    const requestId = requestIdFrom(payload);
    const vote = room?.voteKick;
    if (isInvalidCastContext({ room, voter, requestId, vote, payload })) {
      return { error: { success: false, error: 'That vote is no longer active.' } };
    }
    return { room, voter, requestId, vote };
  }

  function rejectedBallot(room, result) {
    if (result.vote !== room.voteKick) {
      room.voteKick = result.vote;
      emitVoteKickState(room, result.vote);
    }
    return { success: false, error: result.reason || 'That ballot was rejected.', vote: publicVoteKick(result.vote) };
  }

  function removeTarget(room, vote) {
    const target = room.game.getPlayerById(vote.targetPlayerId);
    if (!target) return;
    io.in(room.roomCode).emit('system-message', {
      text: `${target.nickname} was removed after the room vote-kick passed.`,
    });
    removeSeatForReason(room, target, 'vote-kick', true);
  }

  function closeCompletedVote(room, vote) {
    if (vote.status === 'open') return;
    clearTimeoutFn(timers.get(room.roomCode));
    timers.delete(room.roomCode);
  }

  function acceptedBallot(room, result) {
    room.voteKick = result.vote;
    const snapshot = emitVoteKickState(room, result.vote);
    closeCompletedVote(room, result.vote);
    if (result.vote.status === 'passed') removeTarget(room, result.vote);
    return { success: true, vote: snapshot };
  }

  function castRoomVoteKick(socket, payload = {}) {
    const context = castContext(socket, payload);
    if (context.error) return context.error;
    const { room, voter, requestId, vote } = context;
    const result = applyRoomVoteKickBallot({ vote, voterId: voter.id, choice: payload.choice, now: now(), requestId });
    if (!result.accepted) return rejectedBallot(room, result);
    return acceptedBallot(room, result);
  }

  function clearRoom(roomCode) {
    const timer = timers.get(roomCode);
    if (timer) clearTimeoutFn(timer);
    timers.delete(roomCode);
  }

  return { startRoomVoteKick, castRoomVoteKick, clearRoom };
}
