export const VOTE_KICK_DURATION_MS = 30_000;
export const VOTE_KICK_COOLDOWN_MS = 60_000;
// After a vote on a target fails, passes or expires, no human can open another
// vote on that same target for this long. The initiator cooldown alone let a
// different human restart the vote at once.
export const VOTE_KICK_TARGET_COOLDOWN_MS = 300_000;

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

// Once a vote is open, electorate membership needs only a live, un-eliminated
// human seat. A disconnected voter keeps its place while it can reconnect.
function isActiveVoter(player) {
  if (!player) return false;
  return [isHuman(player), isNotEliminated(player), hasPlayerId(player)].every(Boolean);
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

function isVoteStartBlocked(now, activeVote, cooldownUntil, targetCooldownUntil) {
  return [
    !Number.isFinite(now),
    Boolean(activeVote),
    hasUnexpiredCooldown(now, cooldownUntil),
    hasUnexpiredCooldown(now, targetCooldownUntil),
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

export function startRoomVoteKick({ players, initiatorId, targetPlayerId, now, activeVote, cooldownUntil, targetCooldownUntil } = {}) {
  if (!Array.isArray(players)) return null;
  if (isVoteStartBlocked(now, activeVote, cooldownUntil, targetCooldownUntil)) return null;
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

// A seat that leaves or is eliminated mid-vote drops out of the electorate and
// takes its ballot with it. The threshold stays at the majority of the
// electorate that opened the vote, so losing voters can only make a pass
// harder. A target that left or was eliminated closes the vote as 'closed':
// it is never passed against a seat that is no longer there. Returns the same
// object when nothing changed.
export function pruneRoomVoteKick({ vote, players } = {}) {
  if (vote?.status !== 'open' || !Array.isArray(players)) return vote;
  const target = players.find(player => player.id === vote.targetPlayerId);
  if (!isActiveVoter(target)) return { ...vote, status: 'closed' };
  const active = new Set(players.filter(isActiveVoter).map(player => player.id));
  const electorate = vote.electorate.filter(id => active.has(id));
  if (electorate.length === vote.electorate.length) return vote;
  const ballots = Object.fromEntries(Object.entries(vote.ballots || {}).filter(([id]) => electorate.includes(id)));
  return {
    ...vote,
    electorate,
    ballots,
    eligibleCount: electorate.length,
    status: nextVoteStatus({ ...vote, electorate }, ballots),
  };
}

// `players` is the room's live roster. When supplied, the vote is pruned
// against it before the ballot is judged, so a seat eliminated after the vote
// opened cannot cast or keep a ballot.
export function castRoomVoteKick({ vote: suppliedVote, voterId, choice, now, requestId, players } = {}) {
  const vote = pruneRoomVoteKick({ vote: suppliedVote, players });
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
