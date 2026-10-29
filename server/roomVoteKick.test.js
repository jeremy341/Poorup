import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOTE_KICK_DURATION_MS,
  VOTE_KICK_COOLDOWN_MS,
  VOTE_KICK_TARGET_COOLDOWN_MS,
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
  assert.equal(VOTE_KICK_TARGET_COOLDOWN_MS, 300_000);
});

test('a target that just survived a vote cannot be re-voted until its cooldown ends (D2b-09)', () => {
  const cooldownUntil = 1_000 + VOTE_KICK_TARGET_COOLDOWN_MS;
  assert.equal(startRoomVoteKick({ players, initiatorId: 'host', targetPlayerId: 'human-3', now: 1_000, targetCooldownUntil: cooldownUntil }), null);
  assert.equal(startRoomVoteKick({ players, initiatorId: 'human-2', targetPlayerId: 'human-3', now: cooldownUntil - 1, targetCooldownUntil: cooldownUntil }), null);
  const reopened = startRoomVoteKick({ players, initiatorId: 'human-2', targetPlayerId: 'human-3', now: cooldownUntil, targetCooldownUntil: cooldownUntil });
  assert.equal(reopened.targetPlayerId, 'human-3');
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

test('a seat eliminated mid-vote stops counting, and its earlier yes ballot goes with it (F-070)', () => {
  const roster = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'target' }];
  const vote = startRoomVoteKick({ players: roster, initiatorId: 'a', targetPlayerId: 'target', now: 0 });
  assert.equal(vote.requiredYes, 3, 'threshold is a strict majority of the electorate frozen at start');
  const afterB = roster.map(player => player.id === 'b' ? { ...player, bankrupt: true, spectating: true } : player);
  const bYes = castRoomVoteKick({ vote, voterId: 'b', choice: 'yes', now: 1, requestId: 'b-yes', players: roster });
  assert.equal(bYes.accepted, true);
  const cYes = castRoomVoteKick({ vote: bYes.vote, voterId: 'c', choice: 'yes', now: 2, requestId: 'c-yes', players: afterB });
  assert.equal(cYes.accepted, true);
  assert.deepEqual(cYes.vote.electorate, ['a', 'c', 'd'], 'the bankrupt seat is pruned from the electorate');
  assert.deepEqual(cYes.vote.ballots, { a: 'yes', c: 'yes' }, 'the bankrupt seat ballot no longer counts toward yes');
  assert.equal(cYes.vote.status, 'open', 'two live yes ballots do not reach the threshold of three (no silent pass)');
  assert.equal(castRoomVoteKick({ vote: cYes.vote, voterId: 'b', choice: 'no', now: 3, requestId: 'b-late', players: afterB }).accepted, false, 'an eliminated seat cannot cast');
  const dYes = castRoomVoteKick({ vote: cYes.vote, voterId: 'd', choice: 'yes', now: 4, requestId: 'd-yes', players: afterB });
  assert.equal(dYes.vote.status, 'passed');
});

test('an elimination that leaves the vote unable to reach its threshold closes it as failed (F-070)', () => {
  const roster = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'target' }];
  const vote = startRoomVoteKick({ players: roster, initiatorId: 'a', targetPlayerId: 'target', now: 0 });
  assert.deepEqual(vote.electorate, ['a', 'b', 'c']);
  const bNo = castRoomVoteKick({ vote, voterId: 'b', choice: 'no', now: 1, requestId: 'b-no', players: roster });
  assert.equal(bNo.vote.status, 'open', 'a yes and b no leave c able to decide');
  const afterC = roster.map(player => player.id === 'c' ? { ...player, bankrupt: true, spectating: true } : player);
  const lateC = castRoomVoteKick({ vote: bNo.vote, voterId: 'c', choice: 'yes', now: 2, requestId: 'c-yes', players: afterC });
  assert.equal(lateC.accepted, false, 'an eliminated seat cannot cast');
  assert.equal(lateC.vote.status, 'failed', 'with c gone a single yes cannot reach the threshold of two');
  assert.deepEqual(lateC.vote.electorate, ['a', 'b']);
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
