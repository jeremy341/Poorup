import crypto from 'node:crypto';
import {
  VOTE_KICK_COOLDOWN_MS,
  VOTE_KICK_DURATION_MS,
  VOTE_KICK_TARGET_COOLDOWN_MS,
  startRoomVoteKick as createRoomVoteKick,
  castRoomVoteKick as applyRoomVoteKickBallot,
  pruneRoomVoteKick,
} from './roomVoteKick.js';
import { normalizeRequestId } from './requestId.js';

// A vote request carries a voteId or a target id, a choice and a request id,
// well under this. Anything larger is refused before it reaches the replay
// cache or the vote.
const VOTE_KICK_PAYLOAD_LIMIT_CHARS = 1024;
// A passed vote retries its seat removal once a second; after this many failures (about 30 s) it gives up so
// the room is not locked out of new votes for as long as a collateral settlement keeps failing.
const VOTE_KICK_REMOVAL_MAX_ATTEMPTS = 30;

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

function stringField(value) {
  return typeof value === 'string' ? value : null;
}

// The replay cache compares a digest of the normalised start fields. The
// payload itself is never retained, so each cached entry has a fixed size.
function startFingerprint(payload) {
  const fields = { targetPlayerId: stringField(payload.targetPlayerId) };
  return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 24);
}

function isOversizedPayload(payload) {
  return (JSON.stringify(payload) || '').length > VOTE_KICK_PAYLOAD_LIMIT_CHARS;
}

function replayResult(previous, fingerprint) {
  if (!previous) return null;
  if (previous.fingerprint !== fingerprint) return { success: false, error: 'That request ID was already used.' };
  return previous.result;
}

function storeReplay(room, key, fingerprint, result) {
  room.voteKickReplays.set(key, { fingerprint, result });
  while (room.voteKickReplays.size > 500) room.voteKickReplays.delete(room.voteKickReplays.keys().next().value);
}

export function createRoomVoteKickRuntime({ io, roomManager, runRoomTimer, setTimeoutFn, clearTimeoutFn, now, removeSeatForReason }) {
  const timers = new Map();

  // A finished match is not mutable: the vote-kick and the seat removal it decides belong to a running match. The room's match phase
  // tells a lobby that never played (where a vote-kick is a normal room action) from a finished match, and game.started tells a running
  // match from both.
  function matchHasEnded(room) {
    if (!room?.matchFinished) return false;
    return !room?.game?.started;
  }

  function emitVoteKickState(room, vote) {
    const snapshot = publicVoteKick(vote);
    room.voteKickSnapshot = snapshot;
    io.in(room.roomCode).emit('room-votekick-update', { vote: snapshot });
    return snapshot;
  }

  function getReplay({ room, player, requestId, fingerprint, result = null }) {
    if (!room.voteKickReplays) room.voteKickReplays = new Map();
    const key = replayKeyFor(player, requestId);
    const cached = replayResult(room.voteKickReplays.get(key), fingerprint);
    if (cached) return cached;
    if (result) storeReplay(room, key, fingerprint, result);
    return null;
  }

  function startContext(socket, payload) {
    const room = roomManager.getRoomBySocket(socket?.id);
    const initiator = room?.getPlayerBySocket(socket.id);
    const requestId = requestIdFrom(payload);
    if (!room) return { error: 'A current room seat and request ID are required.' };
    if (!initiator) return { error: 'A current room seat and request ID are required.' };
    if (!requestId) return { error: 'A current room seat and request ID are required.' };
    if (isOversizedPayload(payload)) return { error: 'That vote request is too large.' };
    return { room, initiator, requestId };
  }

  function createVote(room, initiator, payload) {
    const cooldowns = room.voteKickCooldowns || (room.voteKickCooldowns = new Map());
    const targetCooldowns = room.voteKickTargetCooldowns || (room.voteKickTargetCooldowns = new Map());
    const targetPlayerId = typeof payload.targetPlayerId === 'string' ? payload.targetPlayerId : '';
    return createRoomVoteKick({
      players: room.game.players,
      initiatorId: initiator.id,
      targetPlayerId,
      now: now(),
      activeVote: room.voteKick?.status === 'open' ? room.voteKick : null,
      cooldownUntil: cooldowns.get(initiator.id) || 0,
      targetCooldownUntil: targetCooldowns.get(targetPlayerId) || 0,
    });
  }

  function failedStart(room, initiator, requestId, fingerprint) {
    const result = { success: false, error: 'A vote cannot be started for that player right now.' };
    getReplay({ room, player: initiator, requestId, fingerprint, result });
    return result;
  }

  function setVoteIdentity(room, initiator, vote) {
    room.voteKickCounter = (room.voteKickCounter || 0) + 1;
    vote.voteId = `${room.roomCode}-${now().toString(36)}-${room.voteKickCounter.toString(36)}`;
    // Kept for the notice if the target leaves mid-vote. Not published.
    vote.targetName = room.game.getPlayerById(vote.targetPlayerId)?.nickname || 'The target';
    room.voteKick = vote;
    room.voteKickCooldowns.set(initiator.id, now() + VOTE_KICK_COOLDOWN_MS);
  }

  // Every accepted ballot (and every prune) swaps room.voteKick for a new
  // object with the same voteId, so the timer matches by id and acts on the live
  // vote; comparing the object captured at start left a balloted vote open.
  function expireVote(room, vote) {
    const live = room.voteKick;
    if (!live || live.voteId !== vote.voteId || live.status !== 'open') return;
    live.status = 'expired';
    closeCompletedVote(room, live);
    emitVoteKickState(room, live);
  }

  function scheduleExpiry(room, vote) {
    const existing = timers.get(room.roomCode);
    if (existing) clearTimeoutFn(existing);
    const timer = setTimeoutFn(() => runRoomTimer('room-votekick-expiry', room.roomCode, () => {
      // A vote cleared by a match start/end never reaches closeCompletedVote.
      if (timers.get(room.roomCode) === timer) timers.delete(room.roomCode);
      expireVote(room, vote);
    }), VOTE_KICK_DURATION_MS);
    timers.set(room.roomCode, timer);
  }

  // Brings an open vote in line with the live room. A target who left or was
  // eliminated closes the vote with a notice (never a pass), and voters who
  // left or were eliminated drop out of the electorate.
  function reconcileRoomVoteKick(room) {
    const vote = room.voteKick;
    const next = pruneRoomVoteKick({ vote, players: room.game.players });
    if (next === vote) return;
    room.voteKick = next;
    closeCompletedVote(room, next);
    if (next.status === 'closed') {
      io.in(room.roomCode).emit('system-message', { text: `${next.targetName} left; vote closed.` });
    }
    emitVoteKickState(room, next);
  }

  function startRoomVoteKick(socket, payload = {}) {
    const context = startContext(socket, payload);
    if (context.error) return { success: false, error: context.error };
    const { room, initiator, requestId } = context;
    if (matchHasEnded(room)) return { success: false, error: 'The match is over.' };
    reconcileRoomVoteKick(room);
    const fingerprint = startFingerprint(payload);
    const replay = getReplay({ room, player: initiator, requestId, fingerprint });
    if (replay) return replay;
    if (room.voteKick?.removalPending) return { success: false, retryable: true, error: 'The passed vote is still completing seat removal.' };
    const vote = createVote(room, initiator, payload);
    if (!vote) return failedStart(room, initiator, requestId, fingerprint);
    setVoteIdentity(room, initiator, vote);
    const snapshot = emitVoteKickState(room, vote);
    scheduleExpiry(room, vote);
    const result = { success: true, vote: snapshot };
    getReplay({ room, player: initiator, requestId, fingerprint, result });
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
    if (room && matchHasEnded(room)) {
      return { error: { success: false, error: 'The match is over.' } };
    }
    if (room) reconcileRoomVoteKick(room);
    const voter = room?.getPlayerBySocket(socket.id);
    const requestId = requestIdFrom(payload);
    const vote = room?.voteKick;
    if (isOversizedPayload(payload)) {
      return { error: { success: false, error: 'That vote request is too large.' } };
    }
    if (isInvalidCastContext({ room, voter, requestId, vote, payload })) {
      return { error: { success: false, error: 'That vote is no longer active.' } };
    }
    return { room, voter, requestId, vote };
  }

  function rejectedBallot(room, result) {
    if (result.vote !== room.voteKick) {
      room.voteKick = result.vote;
      closeCompletedVote(room, result.vote);
      emitVoteKickState(room, result.vote);
    }
    return { success: false, error: result.reason || 'That ballot was rejected.', vote: publicVoteKick(result.vote) };
  }

  function removeTarget(room, vote) {
    // A finished match keeps its seats: the removal belongs to the match that
    // is running.
    if (matchHasEnded(room)) return;
    const target = room.game.getPlayerById(vote.targetPlayerId);
    if (!target) return;
    if (!removeSeatForReason(room, target, 'vote-kick', true)) {
      vote.removalAttempts = (vote.removalAttempts || 0) + 1;
      if (vote.removalAttempts >= VOTE_KICK_REMOVAL_MAX_ATTEMPTS) {
        // Give up: the target keeps its seat, the lock clears, and the room can vote again.
        delete vote.removalPending;
        io.in(room.roomCode).emit('system-message', {
          text: `The vote passed, but ${target.nickname}'s seat could not be removed yet. A new vote can be started.`,
        });
        return;
      }
      vote.removalPending = true;
      const timer = setTimeoutFn(() => runRoomTimer('room-votekick-removal', room.roomCode, () => {
        if (timers.get(room.roomCode) !== timer) return;
        timers.delete(room.roomCode);
        if (roomManager.getRoom(room.roomCode) !== room || room.voteKick?.voteId !== vote.voteId) return;
        removeTarget(room, vote);
      }), 1_000);
      timers.set(room.roomCode, timer);
      return;
    }
    delete vote.removalPending;
    io.in(room.roomCode).emit('system-message', {
      text: `${target.nickname} was removed after the room vote-kick passed.`,
    });
  }

  // Every route that ends a vote (ballot, expiry, or an elimination that
  // prunes it) lands here: the expiry timer is released and the target starts
  // its per-target cooldown. A seat that left has no target to protect.
  function closeCompletedVote(room, vote) {
    if (vote.status === 'open') return;
    clearTimeoutFn(timers.get(room.roomCode));
    timers.delete(room.roomCode);
    if (['passed', 'failed', 'expired'].includes(vote.status)) {
      const targetCooldowns = room.voteKickTargetCooldowns || (room.voteKickTargetCooldowns = new Map());
      targetCooldowns.set(vote.targetPlayerId, now() + VOTE_KICK_TARGET_COOLDOWN_MS);
    }
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
    const result = applyRoomVoteKickBallot({ vote, voterId: voter.id, choice: payload.choice, now: now(), requestId, players: room.game.players });
    if (!result.accepted) return rejectedBallot(room, result);
    return acceptedBallot(room, result);
  }

  function clearRoom(roomCode) {
    const timer = timers.get(roomCode);
    if (timer) clearTimeoutFn(timer);
    timers.delete(roomCode);
  }

  return { startRoomVoteKick, castRoomVoteKick, clearRoom, reconcileRoomVoteKick };
}
