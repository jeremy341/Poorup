import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOTE_KICK_DURATION_MS,
  VOTE_KICK_COOLDOWN_MS,
  startRoomVoteKick,
  castRoomVoteKick,
} from './roomVoteKick.js';

const players = [
  { id: 'host' },
  { id: 'human-2' },
  { id: 'human-3' },
  { id: 'bot-1', isBot: true },
];

test('vote policy durations are fixed', () => {
  assert.equal(VOTE_KICK_DURATION_MS, 30_000);
  assert.equal(VOTE_KICK_COOLDOWN_MS, 60_000);
});

test('vote start freezes eligible humans and auto-casts initiator yes', () => {
  const vote = startRoomVoteKick({ players, initiatorId: 'host', targetPlayerId: 'human-3', now: 1_000 });
  assert.deepEqual(vote.electorate, ['host', 'human-2']);
  assert.deepEqual(vote.ballots, { host: 'yes' });
  assert.equal(vote.expiresAt, 31_000);
  assert.equal(vote.requiredYes, 2);
});

test('vote start rejects too few humans, self-target, bots, active vote and cooldown', () => {
  assert.equal(startRoomVoteKick({ players: [{ id: 'one' }, { id: 'two' }], initiatorId: 'one', targetPlayerId: 'two', now: 1 }), null);
  assert.equal(startRoomVoteKick({ players, initiatorId: 'host', targetPlayerId: 'host', now: 1 }), null);
  assert.equal(startRoomVoteKick({ players, initiatorId: 'bot-1', targetPlayerId: 'human-3', now: 1 }), null);
  assert.equal(startRoomVoteKick({ players, initiatorId: 'host', targetPlayerId: 'human-3', now: 1, activeVote: {} }), null);
  assert.equal(startRoomVoteKick({ players, initiatorId: 'host', targetPlayerId: 'human-3', now: 1, cooldownUntil: 2 }), null);
});

test('strict majority passes, no vote fails, target and new players cannot vote', () => {
  const vote = startRoomVoteKick({ players: [{ id: 'a' }, { id: 'b' }, { id: 'target' }], initiatorId: 'a', targetPlayerId: 'target', now: 0 });
  const oneYes = castRoomVoteKick({ vote, voterId: 'b', choice: 'yes', now: 1 });
  assert.equal(oneYes.vote.status, 'passed');
  assert.equal(castRoomVoteKick({ vote, voterId: 'target', choice: 'yes', now: 1 }).accepted, false);
  assert.equal(castRoomVoteKick({ vote, voterId: 'latecomer', choice: 'yes', now: 1 }).accepted, false);
  assert.equal(castRoomVoteKick({ vote, voterId: 'b', choice: 'yes', now: -1 }).reason, 'stale-vote');
  const noStart = startRoomVoteKick({ players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'target' }], initiatorId: 'a', targetPlayerId: 'target', now: 0 });
  const firstNo = castRoomVoteKick({ vote: noStart, voterId: 'b', choice: 'no', now: 1 });
  const noVote = castRoomVoteKick({ vote: firstNo.vote, voterId: 'c', choice: 'no', now: 2 });
  assert.equal(noVote.vote.status, 'failed');
});

test('one ballot per frozen voter, timeout, and replayed request are rejected', () => {
  const vote = startRoomVoteKick({ players: [{ id: 'host' }, { id: 'human-2' }, { id: 'human-3' }, { id: 'target' }], initiatorId: 'host', targetPlayerId: 'target', now: 5 });
  const ballot = castRoomVoteKick({ vote, voterId: 'human-2', choice: 'no', requestId: 'r1', now: 6 });
  assert.equal(ballot.accepted, true);
  assert.equal(castRoomVoteKick({ vote: ballot.vote, voterId: 'human-2', choice: 'yes', requestId: 'r2', now: 7 }).accepted, false);
  assert.equal(castRoomVoteKick({ vote: ballot.vote, voterId: 'human-2', choice: 'no', requestId: 'r1', now: 8 }).accepted, false);
  assert.equal(castRoomVoteKick({ vote, voterId: 'human-2', choice: 'no', now: 30_005 }).accepted, false);
  assert.equal(castRoomVoteKick({ vote, voterId: 'human-2', choice: 'no', now: 30_005 }).vote.status, 'expired');
});
