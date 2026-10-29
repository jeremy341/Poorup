export const VOTE_KICK_DURATION_MS = 30_000;
export const VOTE_KICK_COOLDOWN_MS = 60_000;

function isHuman(player) {
  return Boolean(player) && !player.isBot && !player.bot;
}

function isNotSpectating(player) {
  return ![player.isSpectator, player.spectator].some(Boolean);
}

function isConnected(player) {
  return !player.disconnected;
}

function isNotEliminated(player) {
  const eliminationFlags = [player.isBankrupt, player.bankrupt, player.eliminated];
  const eliminationStatuses = ['bankrupt', 'eliminated'];
  return !eliminationFlags.some(Boolean) && !eliminationStatuses.includes(player.status);
}

function hasPlayerId(player) {
  return [typeof player.id === 'string', Boolean(player.id?.length)].every(Boolean);
}

function isEligibleHuman(player) {
  if (!player) return false;
  return [
    isHuman(player),
    isNotSpectating(player),
    isConnected(player),
    isNotEliminated(player),
    hasPlayerId(player),
  ].every(Boolean);
}

function isVoteStartBlocked(now, activeVote, cooldownUntil) {
  return [
    !Number.isFinite(now),
    Boolean(activeVote),
    hasUnexpiredCooldown(now, cooldownUntil),
  ].some(Boolean);
}

function hasUnexpiredCooldown(now, cooldownUntil) {
  if (!Number.isFinite(cooldownUntil)) return false;
  return now < cooldownUntil;
}

function eligibleParticipants(humans, initiatorId, targetPlayerId) {
  if (humans.length < 3) return null;
  const initiator = humans.find(player => player.id === initiatorId);
  const target = humans.find(player => player.id === targetPlayerId);
  if (!initiator) return null;
  if (!target) return null;
  if (initiatorId === targetPlayerId) return null;
  return { initiator, target };
}

function voteTimeState(vote, now) {
  if (vote.status !== 'open') return { reason: 'vote-closed' };
  if (!Number.isFinite(now)) return { reason: 'invalid-time' };
  if (now < vote.openedAt) return { reason: 'stale-vote' };
  if (now >= vote.expiresAt) return { reason: 'vote-expired', status: 'expired' };
  return null;
}

function ballotState(vote, voterId, choice, requestId) {
  const replayKey = typeof requestId === 'string' ? `${voterId}:${requestId}` : '';
  const rejection = ballotRejection(vote, voterId, choice, replayKey);
  if (rejection) return { reason: rejection, replayKey };
  return { replayKey };
}

function ballotRejection(vote, voterId, choice, replayKey) {
  if (isReplay(vote, replayKey)) return 'replayed-request';
  if (!vote.electorate?.includes(voterId)) return 'ineligible-voter';
  if (vote.ballots?.[voterId]) return 'already-voted';
  if (!isBallotChoice(choice)) return 'invalid-choice';
  return '';
}

function isReplay(vote, replayKey) {
  return Boolean(replayKey) && vote.requestIds?.includes(replayKey) === true;
}

function isBallotChoice(choice) {
  return ['yes', 'no'].includes(choice);
}

function nextVoteStatus(vote, ballots) {
  const yesCount = Object.values(ballots).filter(ballot => ballot === 'yes').length;
  const remaining = vote.electorate.length - Object.keys(ballots).length;
  if (yesCount >= vote.requiredYes) return 'passed';
  if (yesCount + remaining < vote.requiredYes) return 'failed';
  return 'open';
}

function nextRequestIds(vote, replayKey) {
  const previous = vote.requestIds || [];
  return replayKey ? [...previous, replayKey] : [...previous];
}

export function startRoomVoteKick({ players, initiatorId, targetPlayerId, now, activeVote, cooldownUntil } = {}) {
  if (!Array.isArray(players)) return null;
  if (isVoteStartBlocked(now, activeVote, cooldownUntil)) return null;
  const humans = players.filter(isEligibleHuman);
  const participants = eligibleParticipants(humans, initiatorId, targetPlayerId);
  if (!participants) return null;

  const electorate = humans.filter(player => player.id !== targetPlayerId).map(player => player.id);
  const requiredYes = Math.floor(electorate.length / 2) + 1;
  return {
    voteId: `${initiatorId}:${targetPlayerId}:${now}`,
    targetPlayerId,
    initiatorId,
    electorate,
    ballots: { [initiatorId]: 'yes' },
    requestIds: [],
    openedAt: now,
    expiresAt: now + VOTE_KICK_DURATION_MS,
    cooldownUntil: now + VOTE_KICK_COOLDOWN_MS,
    eligibleCount: electorate.length,
    requiredYes,
    status: 1 >= requiredYes ? 'passed' : 'open',
  };
}

export function castRoomVoteKick({ vote, voterId, choice, now, requestId } = {}) {
  const reject = (reason, currentVote = vote) => ({ accepted: false, reason, vote: currentVote });
  if (!vote) return reject('vote-closed');
  const timing = voteTimeState(vote, now);
  if (timing?.status === 'expired') return {
    accepted: false,
    reason: timing.reason,
    vote: { ...vote, status: 'expired' },
  };
  if (timing) return reject(timing.reason);
  const ballot = ballotState(vote, voterId, choice, requestId);
  if (ballot.reason) return reject(ballot.reason);

  const ballots = { ...vote.ballots, [voterId]: choice };
  return {
    accepted: true,
    vote: {
      ...vote,
      ballots,
      requestIds: nextRequestIds(vote, ballot.replayKey),
      status: nextVoteStatus(vote, ballots),
    },
  };
}
