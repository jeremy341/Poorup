export const VOTE_KICK_DURATION_MS = 30_000;
export const VOTE_KICK_COOLDOWN_MS = 60_000;

function isEligibleHuman(player) {
  return Boolean(
    player &&
    !player.isBot &&
    !player.bot &&
    !player.isSpectator &&
    !player.spectator &&
    !player.disconnected &&
    !player.isBankrupt &&
    !player.bankrupt &&
    !player.eliminated &&
    player.status !== 'bankrupt' &&
    player.status !== 'eliminated' &&
    typeof player.id === 'string' &&
    player.id.length > 0,
  );
}

export function startRoomVoteKick({ players, initiatorId, targetPlayerId, now, activeVote, cooldownUntil } = {}) {
  if (!Array.isArray(players) || !Number.isFinite(now) || activeVote || (Number.isFinite(cooldownUntil) && now < cooldownUntil)) return null;
  const humans = players.filter(isEligibleHuman);
  if (humans.length < 3) return null;

  const initiator = humans.find(player => player.id === initiatorId);
  const target = humans.find(player => player.id === targetPlayerId);
  if (!initiator || !target || initiatorId === targetPlayerId) return null;

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
  if (!vote || vote.status !== 'open') return reject('vote-closed');
  if (!Number.isFinite(now)) return reject('invalid-time');
  if (now < vote.openedAt) return reject('stale-vote');
  if (now >= vote.expiresAt) return {
    accepted: false,
    reason: 'vote-expired',
    vote: { ...vote, status: 'expired' },
  };
  const replayKey = typeof requestId === 'string' ? `${voterId}:${requestId}` : '';
  if (replayKey && vote.requestIds?.includes(replayKey)) return reject('replayed-request');
  if (!vote.electorate?.includes(voterId)) return reject('ineligible-voter');
  if (vote.ballots?.[voterId]) return reject('already-voted');
  if (choice !== 'yes' && choice !== 'no') return reject('invalid-choice');

  const ballots = { ...vote.ballots, [voterId]: choice };
  const yesCount = Object.values(ballots).filter(ballot => ballot === 'yes').length;
  const remaining = vote.electorate.length - Object.keys(ballots).length;
  const status = yesCount >= vote.requiredYes
    ? 'passed'
    : yesCount + remaining < vote.requiredYes
      ? 'failed'
      : 'open';
  return {
    accepted: true,
    vote: {
      ...vote,
      ballots,
      requestIds: replayKey ? [...(vote.requestIds || []), replayKey] : [...(vote.requestIds || [])],
      status,
    },
  };
}
