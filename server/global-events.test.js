// Characterization suite for the global-event lifecycle in gameLogic.js, pinned BEFORE refactoring activateGlobalEvent,
// maybeTriggerGlobalEvent, resolveGlobalEventVote and applyGlobalEventActivationSettlements. Every observable (event ids,
// phases, effect snapshots, feed messages, vote tallies, settlement cash deltas, RNG consumption) must survive verbatim.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { GLOBAL_EVENT_COMBINATIONS } from './globalEventData.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

function makeEventRoom({ globalEvents = true, players = 2 } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', rulesProfile: 'advanced' });
  if (players >= 2) room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  if (players >= 3) room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  if (globalEvents) room.setRoomSetting('globalEvents', true);
  assert.equal(room.startGame().success, true);
  return room;
}

function feedTexts(game) {
  return game.feed.map(entry => entry.text);
}

function ownsTile(game, player, index) {
  const tile = game.getTile(index);
  tile.ownerId = player.id;
  player.properties.push(index);
}

function ownsFullBrownGroup(game, player) {
  ownsTile(game, player, 1);
  ownsTile(game, player, 3);
}

// RNG control. randomFloat() is crypto.randomInt(0, 1_000_000) / 1e6 and
// randomInt(a, b) is crypto.randomInt(a, b + 1). Queued probabilities fire
// in call order per (min, max) signature; everything else stays real.
async function stubRng({ floats = [], ints = {} } = {}) {
  const nodeCrypto = (await import('crypto')).default;
  const original = nodeCrypto.randomInt;
  const queues = Object.fromEntries(Object.entries(ints).map(([key, values]) => [key, [...values]]));
  if (floats.length) queues['0,1000000'] = floats.map(probability => Math.round(probability * 1_000_000));
  nodeCrypto.randomInt = (min, max) => {
    const queue = queues[`${min},${max}`];
    return queue && queue.length ? queue.shift() : original(min, max);
  };
  return () => { nodeCrypto.randomInt = original; };
}

async function testActivateWarningSnapshot() {
  const room = makeEventRoom();
  const game = room.game;
  const definition = game.globalEventDefinition('tourism-boom');
  game.roundNumber = 1;
  game.activateGlobalEvent(definition);
  const event = game.globalEvent;
  assert.equal(event.id, 'tourism-boom');
  assert.equal(event.title, 'TOURISM BOOM');
  assert.equal(event.category, 'INFRASTRUCTURE');
  assert.equal(event.phase, 'warning');
  assert.equal(event.startedRound, 1);
  assert.equal(event.voteRound, null);
  assert.equal(event.durationRounds, 6);
  assert.equal(event.roundsRemaining, 1);
  assert.equal(event.choices, null);
  assert.deepEqual(event.votes, {});
  assert.equal(event.resolvedChoice, null);
  assert.equal(event.targetPlayerId, null);
  assert.equal(event.comboId, null);
  assert.deepEqual(event.effects, { airportRentMultiplier: 1.5, premiumRentMultiplier: 1.3, marketPriceMultiplier: 1.15 });
  assert.notEqual(event.effects, definition.effects);
  assert.equal(game.globalEventsTriggered, 1);
  game.players.forEach(player => assert.equal(player.globalEventsExperienced, 1));
  assert.equal(game.feed[0].text, 'TOURISM BOOM is building. The table has one round to prepare.');
  assert.equal(typeof game.feed[0].timestamp, 'number');
  // warning, active, recovery, off phase ladder via advanceRound
  game.advanceRound();
  assert.equal(game.globalEvent.phase, 'active');
  assert.equal(game.globalEvent.startedRound, 2);
  assert.equal(game.globalEvent.roundsRemaining, 6);
  assert.equal(game.feed[0].text, 'TOURISM BOOM is now active for 6 rounds.');
  for (let i = 0; i < 6; i += 1) game.advanceRound();
  assert.equal(game.globalEvent.phase, 'recovery');
  assert.equal(game.feed[0].text, 'TOURISM BOOM has ended. The table enters recovery.');
  game.advanceRound();
  assert.equal(game.globalEvent, null);
  assert.equal(game.globalEventCooldown, 3);
  assert.deepEqual(game.globalEventHistory, [{
    id: 'tourism-boom', title: 'TOURISM BOOM', comboId: null, startedRound: 2, endedRound: 9
  }]);
  game.players.forEach(player => assert.equal(player.globalEventsSurvived, 1));
}

function testActivateDurationScaling() {
  const room = makeEventRoom();
  const game = room.game;
  // 2 active players: expectedRounds = max(12, 16) = 16.
  game.roundNumber = 1; // progress 0 -> <= 0.6
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  assert.equal(game.globalEvent.durationRounds, 7);
  game.globalEvent = null;
  game.roundNumber = 11; // progress 10/16 > 0.6
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  assert.equal(game.globalEvent.durationRounds, 8);
  game.globalEvent = null;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  assert.equal(game.globalEvent.durationRounds, 7);
  game.globalEvent = null;
  game.roundNumber = 1;
  game.activateGlobalEvent(game.globalEventDefinition('tax-audit'));
  assert.equal(game.globalEvent.durationRounds, 6);
}

function testActivateVotingChoices() {
  const room = makeEventRoom();
  const game = room.game;
  const definition = game.globalEventDefinition('city-election');
  game.roundNumber = 4;
  game.activateGlobalEvent(definition);
  const event = game.globalEvent;
  assert.equal(event.phase, 'voting');
  assert.equal(event.voteRound, 4);
  assert.equal(event.roundsRemaining, 1);
  assert.deepEqual(event.choices.map(choice => choice.id), ['low-tax', 'public-works', 'bank-first']);
  assert.notEqual(event.choices[0], definition.choices[0]);
  assert.deepEqual(event.choices[0], { id: 'low-tax', label: 'LOW TAX PLATFORM', description: 'Taxes fall, but card rewards are reduced.' });
  assert.equal(event.targetPlayerId, null);
  assert.equal(game.feed[0].text, 'CITY ELECTION is live. The table votes before the next round.');
}

function testActivateTargetSelection() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsFullBrownGroup(game, a);
  ownsTile(game, b, 11); // Pink
  ownsTile(game, b, 16); // Orange
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('anti-monopoly'));
  assert.equal(game.globalEvent.id, 'anti-monopoly');
  assert.equal(game.globalEvent.targetPlayerId, b.id); // two groups beats one
  assert.deepEqual(game.globalEvent.effects, { leaderRentMultiplier: 0.6, marketPriceMultiplier: 0.9 });
  game.globalEvent = null;
  a.cash = 2500;
  b.cash = 1200;
  game.activateGlobalEvent(game.globalEventDefinition('tax-audit'));
  assert.equal(game.globalEvent.targetPlayerId, a.id); // richest active player
  assert.equal(game.globalEvent.phase, 'warning');
}

function testActivateAirportStrikeFlags() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsTile(game, a, 5); // ACC Airport
  game.activateGlobalEvent(game.globalEventDefinition('airport-strike'));
  assert.equal(a.airportOwnedDuringStrike, true);
  assert.equal(b.airportOwnedDuringStrike, false);
  assert.equal(game.globalEvent.phase, 'warning');
}

function testActivateCombo() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 8;
  game.globalEventsTriggered = 1;
  game.activateGlobalEvent(game.globalEventDefinition('credit-freeze'), {
    id: 'foreclosure-spiral',
    title: 'FORECLOSURE SPIRAL',
    summary: 'The property crash meets a locked credit market.',
    effects: { constructionBlocked: true, bankLoansBlocked: true, mortgagesBlocked: true, rentMultiplier: 0.55 },
    duration: 8
  });
  const event = game.globalEvent;
  assert.equal(event.id, 'foreclosure-spiral');
  assert.equal(event.comboId, 'foreclosure-spiral');
  assert.equal(event.title, 'FORECLOSURE SPIRAL');
  assert.equal(event.category, 'COMBINATION');
  assert.equal(event.phase, 'warning');
  assert.equal(event.durationRounds, 8);
  assert.deepEqual(event.effects, {
    bankLoansBlocked: true, mortgagesBlocked: true, marketPriceMultiplier: 0.8, tradingEnabled: false, casinoMaxBet: 350,
    constructionBlocked: true, rentMultiplier: 0.55
  });
  game.players.forEach(player => assert.equal(player.comboExperienced, true));
  assert.equal(game.globalEventsTriggered, 2);
  assert.equal(game.feed[0].text, 'FORECLOSURE SPIRAL is building. The table has one round to prepare.');
}

async function testMaybeTriggerGating() {
  // Settings off.
  const off = makeEventRoom({ globalEvents: false });
  off.game.roundNumber = 10;
  off.game.maybeTriggerGlobalEvent();
  assert.equal(off.game.globalEvent, null);
  // Not started.
  const fresh = new RoomManager().createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', rulesProfile: 'advanced' });
  fresh.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  fresh.setRoomSetting('globalEvents', true);
  fresh.game.roundNumber = 10;
  fresh.game.maybeTriggerGlobalEvent();
  assert.equal(fresh.game.globalEvent, null);
  // 'rare' is an accepted truthy setting; here the one-headline cap bites first.
  const rare = makeEventRoom({ globalEvents: false });
  rare.game.settings.globalEvents = 'rare';
  rare.game.roundNumber = 3;
  rare.game.globalEventsTriggered = 1;
  rare.game.maybeTriggerGlobalEvent();
  assert.equal(rare.game.globalEvent, null);
  // Active event blocks.
  const busy = makeEventRoom();
  busy.game.roundNumber = 8;
  busy.game.activateGlobalEvent(busy.game.globalEventDefinition('tourism-boom'));
  const before = busy.game.globalEvent;
  busy.game.maybeTriggerGlobalEvent();
  assert.equal(busy.game.globalEvent, before);
  // Cooldown blocks.
  const cooled = makeEventRoom();
  cooled.game.roundNumber = 8;
  cooled.game.globalEventCooldown = 2;
  cooled.game.maybeTriggerGlobalEvent();
  assert.equal(cooled.game.globalEvent, null);
  // Early rounds are gated out (progress < 0.18: zero chance, even 0.0).
  const early = makeEventRoom();
  early.game.roundNumber = 3;
  const restoreEarly = await stubRng({ floats: [0, 0] });
  try {
    early.game.maybeTriggerGlobalEvent();
  } finally {
    restoreEarly();
  }
  assert.equal(early.game.globalEvent, null);
  // One headline per match unless it completes a combination.
  const capped = makeEventRoom();
  capped.game.roundNumber = 8;
  capped.game.globalEventsTriggered = 1;
  const restoreCapped = await stubRng({ floats: [0, 0, 0, 0] });
  try {
    capped.game.maybeTriggerGlobalEvent();
    capped.game.maybeTriggerGlobalEvent('surprise');
  } finally {
    restoreCapped();
  }
  assert.equal(capped.game.globalEvent, null);
}

async function testMaybeTriggerChanceAndSelection() {
  // Fresh 2-player room at round 8. The eligible pool in definition order is
  // [city-election, tourism-boom, public-works, convention-week, tax-audit], weights all 1.
  // Round 8, progress 0.4375: boundary chance 0.025, surprise 0.05.
  const miss = makeEventRoom();
  miss.game.roundNumber = 8;
  let restore = await stubRng({ floats: [0.025] });
  try {
    miss.game.maybeTriggerGlobalEvent();
  } finally {
    restore();
  }
  assert.equal(miss.game.globalEvent, null); // 0.025 >= 0.025
  const hit = makeEventRoom();
  hit.game.roundNumber = 8;
  restore = await stubRng({ floats: [0.024, 0.3] });
  try {
    hit.game.maybeTriggerGlobalEvent();
  } finally {
    restore();
  }
  assert.equal(hit.game.globalEvent.id, 'tourism-boom'); // roll 1.5 lands on index 1
  assert.equal(hit.game.globalEvent.comboId, null);
  assert.equal(hit.game.globalEventsTriggered, 1);
  const first = makeEventRoom();
  first.game.roundNumber = 8;
  restore = await stubRng({ floats: [0.024, 0.1] });
  try {
    first.game.maybeTriggerGlobalEvent();
  } finally {
    restore();
  }
  assert.equal(first.game.globalEvent.id, 'city-election'); // roll 0.5 -> index 0
  assert.equal(first.game.globalEvent.phase, 'voting');
  // Late progress: round 14, progress 0.8125: boundary 0.04, surprise 0.07.
  const late = makeEventRoom();
  late.game.roundNumber = 14;
  restore = await stubRng({ floats: [0.04] });
  try {
    late.game.maybeTriggerGlobalEvent();
  } finally {
    restore();
  }
  assert.equal(late.game.globalEvent, null); // 0.04 >= 0.04
  const surprise = makeEventRoom();
  surprise.game.roundNumber = 14;
  restore = await stubRng({ floats: [0.039, 0.1] });
  try {
    surprise.game.maybeTriggerGlobalEvent('surprise');
  } finally {
    restore();
  }
  assert.equal(surprise.game.globalEvent.id, 'city-election'); // 0.039 < 0.07
}

async function testMaybeTriggerComboPath() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 8;
  game.globalEventsTriggered = 1;
  game.globalEventHistory = [{ id: 'housing-bubble', title: 'HOUSING BUBBLE POP', comboId: null, startedRound: 1, endedRound: 7 }];
  game.players[0].bankLoan = { status: 'active', remaining: 300 };
  const restore = await stubRng({ floats: [0.01, 0.5] });
  try {
    game.maybeTriggerGlobalEvent('surprise');
  } finally {
    restore();
  }
  assert.equal(game.globalEvent.id, 'foreclosure-spiral');
  assert.equal(game.globalEvent.comboId, 'foreclosure-spiral');
  assert.equal(game.globalEvent.phase, 'warning');
  assert.equal(game.globalEvent.durationRounds, 8);
  // A combo already consumed in history cannot chain.
  const second = makeEventRoom();
  second.game.roundNumber = 8;
  second.game.globalEventsTriggered = 1;
  second.game.globalEventHistory = [{ id: 'housing-bubble', title: 'HOUSING BUBBLE POP', comboId: 'foreclosure-spiral', startedRound: 1, endedRound: 7 }];
  second.game.players[0].bankLoan = { status: 'active', remaining: 300 };
  const restoreSecond = await stubRng({ floats: [0.01, 0.5] });
  try {
    second.game.maybeTriggerGlobalEvent('surprise');
  } finally {
    restoreSecond();
  }
  assert.equal(second.game.globalEvent, null);
  // Combos are surprise-only; the round boundary cannot chain.
  const boundary = makeEventRoom();
  boundary.game.roundNumber = 8;
  boundary.game.globalEventsTriggered = 1;
  boundary.game.globalEventHistory = [{ id: 'housing-bubble', title: 'HOUSING BUBBLE POP', comboId: null, startedRound: 1, endedRound: 7 }];
  boundary.game.players[0].bankLoan = { status: 'active', remaining: 300 };
  const restoreBoundary = await stubRng({ floats: [0.01, 0.5] });
  try {
    boundary.game.maybeTriggerGlobalEvent();
  } finally {
    restoreBoundary();
  }
  assert.equal(boundary.game.globalEvent, null);
}

function testVoteGuards() {
  const room = makeEventRoom();
  const game = room.game;
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'low-tax'), { success: false, error: 'There is no active global vote.' });
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'low-tax'), { success: false, error: 'There is no active global vote.' });
  game.globalEvent = null;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  assert.deepEqual(game.voteGlobalEvent('socket-zzz', 'low-tax'), { success: false, error: 'There is no active global vote.' });
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'anarchy'), { success: false, error: 'That policy is not available.' });
  assert.equal(game.voteGlobalEvent('socket-a', 'low-tax').success, true);
  assert.equal(game.globalEvent.votes[game.players[0].id], 'low-tax');
  assert.equal(game.feed[0].text, 'A cast a vote in the city election.');
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'low-tax'), { success: false, error: 'You already voted in this election.' });
  const b = game.players[1];
  b.disconnected = true;
  assert.deepEqual(game.voteGlobalEvent('socket-b', 'bank-first'), { success: false, error: 'Only active players can vote.' });
  b.disconnected = false;
}

// A full-turnout vote runs the activation settlements (loan repricing,
// bailout cash) immediately, so it must not land while a payment or auction is
// open - the pending payment amount would go stale mid-turn.
function testVoteWaitsForTableObligations() {
  const room = makeEventRoom();
  const game = room.game;
  const [a] = game.players;
  a.cash = 100;
  a.bankLoan = { status: 'active', principal: 450, remaining: 450, issuedRound: 1, dueRound: 50, cureRound: null };
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('bank-run'));
  const event = game.globalEvent;
  game.pendingPayment = { playerId: a.id, creditorId: null, amountRemaining: 450, reason: 'bank debt' };
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'emergency-bailout'), { success: false, error: 'Resolve the table obligation before voting.' });
  assert.deepEqual(game.voteGlobalEvent('socket-b', 'emergency-bailout'), { success: false, error: 'Resolve the table obligation before voting.' });
  assert.equal(event.phase, 'voting');
  assert.deepEqual(event.votes, {});
  assert.equal(a.bankLoan.remaining, 450);
  game.pendingPayment = null;
  game.startAuction(game.getTile(5), a.id);
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'emergency-bailout'), { success: false, error: 'Resolve the table obligation before voting.' });
  game.finishAuction();
  assert.equal(game.auction, null);
  assert.equal(game.voteGlobalEvent('socket-a', 'emergency-bailout').success, true);
  assert.equal(game.voteGlobalEvent('socket-b', 'emergency-bailout').success, true);
  assert.equal(event.phase, 'active');
  assert.equal(event.resolvedChoice, 'emergency-bailout');
  assert.equal(a.cash, 250);
}

function testResolveVotePreconditions() {
  const room = makeEventRoom();
  const game = room.game;
  game.resolveGlobalEventVote();
  assert.equal(game.globalEvent, null);
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  game.resolveGlobalEventVote();
  assert.equal(game.globalEvent.phase, 'warning');
  assert.deepEqual(feedTexts(game).slice(0, 2), [
    'HOUSING BUBBLE POP is building. The table has one round to prepare.',
    'The game begins. Players take turns clockwise.'
  ]);
}

function testResolveVoteUnanimous() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 4;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  const event = game.globalEvent;
  assert.equal(game.voteGlobalEvent('socket-a', 'low-tax').success, true);
  assert.equal(game.voteGlobalEvent('socket-b', 'low-tax').success, true);
  // Full turnout auto-resolves.
  assert.equal(event.phase, 'active');
  assert.equal(event.resolvedChoice, 'low-tax');
  assert.equal(event.startedRound, 4);
  assert.equal(event.roundsRemaining, event.durationRounds);
  game.players.forEach(player => {
    assert.equal(player.lastVoteChoice, 'low-tax');
    assert.equal(player.councilWins, 1);
    assert.equal(player.unanimousVote, true);
  });
  assert.equal(game.feed[0].text, 'CITY ELECTION resolved: LOW TAX.');
}

// A split or abstained ballot enacts no policy. The old coin flip
// among tied options is gone, so a 1-1 tie with an abstention and a zero-turnout
// timeout both resolve to no choice.
function testResolveVoteTieAndTimeout() {
  // Three players so a 1-1 split can reach resolve without full turnout.
  const room = makeEventRoom({ players: 3 });
  const game = room.game;
  const [a, b, c] = game.players;
  game.roundNumber = 4;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  const event = game.globalEvent;
  game.voteGlobalEvent('socket-a', 'low-tax');
  game.voteGlobalEvent('socket-b', 'public-works');
  assert.equal(event.phase, 'voting'); // C abstained -> no auto-resolve
  game.resolveGlobalEventVote();
  assert.equal(event.resolvedChoice, null, 'a 1-1 split with an abstention is no majority');
  assert.equal(event.phase, 'active');
  assert.equal(a.lastVoteChoice, 'low-tax');
  assert.equal(a.councilWins, 0);
  assert.equal(b.councilWins, 0);
  assert.equal(c.lastVoteChoice, null);
  assert.equal(a.unanimousVote, false);
  assert.equal(game.feed[0].text, 'CITY ELECTION resolved: NO MAJORITY, NO CHANGE.');
  // Zero-turnout timeout via advanceRound: nobody votes, so no choice is enacted.
  const idle = makeEventRoom();
  idle.game.roundNumber = 6;
  idle.game.activateGlobalEvent(idle.game.globalEventDefinition('city-election'));
  const idleEvent = idle.game.globalEvent;
  idle.game.advanceRound();
  assert.equal(idleEvent.phase, 'active');
  assert.equal(idleEvent.resolvedChoice, null);
  assert.equal(idleEvent.startedRound, 7);
  idle.game.players.forEach(player => {
    assert.equal(player.councilWins, 0);
    assert.equal(player.unanimousVote, false);
  });
  assert.equal(idle.game.feed[0].text, 'CITY ELECTION resolved: NO MAJORITY, NO CHANGE.');
}

// A policy choice is enacted only with a strict majority of the ACTIVE seats. Abstentions count as no change.
// Tables of 2, 3, 4 and 6 are checked: a bare majority is enacted (by timeout or at full turnout), exactly half is not,
// and a full-turnout split is not.
function seatedVoteRoom(seats) {
  const manager = new RoomManager();
  const boardVariant = seats > 4 ? 'metro-52' : 'standard-40';
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'P1', boardVariant });
  if (seats > 4) assert.equal(room.setRoomSetting('maxPlayers', seats).rejected, false);
  for (let index = 1; index < seats; index += 1) {
    const letter = String.fromCharCode(97 + index);
    room.addOrReconnectPlayer({ socketId: `socket-${letter}`, clientId: `client-${letter}`, nickname: `P${index + 1}` });
  }
  room.setRoomSetting('globalEvents', true);
  assert.equal(room.startGame().success, true);
  assert.equal(room.game.players.length, seats);
  return room;
}

function castVotes(game, count, choiceId) {
  game.activePlayers().slice(0, count).forEach(player => {
    assert.equal(game.voteGlobalEvent(player.socketId, choiceId).success, true);
  });
}

function testVoteNeedsStrictMajorityOfActiveSeats() {
  for (const seats of [2, 3, 4, 6]) {
    const half = Math.floor(seats / 2);
    const majority = half + 1;

    const won = seatedVoteRoom(seats);
    won.game.roundNumber = 4;
    won.game.activateGlobalEvent(won.game.globalEventDefinition('city-election'));
    castVotes(won.game, majority, 'low-tax');
    if (won.game.globalEvent.phase === 'voting') won.game.advanceRound(); // timeout path
    assert.equal(won.game.globalEvent.resolvedChoice, 'low-tax', `${seats} seats: a strict majority enacts its choice`);
    assert.equal(won.game.feed[0].text, 'CITY ELECTION resolved: LOW TAX.');

    const thin = seatedVoteRoom(seats);
    thin.game.roundNumber = 4;
    thin.game.activateGlobalEvent(thin.game.globalEventDefinition('city-election'));
    castVotes(thin.game, half, 'public-works');
    thin.game.advanceRound(); // timeout path with the rest abstaining
    assert.equal(thin.game.globalEvent.resolvedChoice, null, `${seats} seats: exactly half is not a majority`);
    assert.equal(thin.game.feed[0].text, 'CITY ELECTION resolved: NO MAJORITY, NO CHANGE.');
  }

  // Full turnout with no bloc above half resolves at once to no choice.
  for (const seats of [2, 3, 4, 6]) {
    const split = seatedVoteRoom(seats);
    split.game.roundNumber = 4;
    split.game.activateGlobalEvent(split.game.globalEventDefinition('city-election'));
    const options = ['low-tax', 'public-works', 'bank-first'];
    split.game.activePlayers().forEach((player, index) => {
      assert.equal(split.game.voteGlobalEvent(player.socketId, options[index % options.length]).success, true);
    });
    assert.equal(split.game.globalEvent.phase, 'active', `${seats} seats: full turnout resolves`);
    assert.equal(split.game.globalEvent.resolvedChoice, null, `${seats} seats: a split full turnout enacts nothing`);
  }
}

// Three seats: a 1-1 split enacts nothing under the strict-majority rule,
// so each enforce outcome needs two of the three ballots.
function testResolveVoteAntiMonopolyAndLegitimacy() {
  const room = makeEventRoom({ players: 3 });
  const game = room.game;
  const [a, b, c] = game.players;
  ownsFullBrownGroup(game, a);
  ownsTile(game, b, 11); // Pink
  ownsTile(game, b, 16); // Orange
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('anti-monopoly'));
  const event = game.globalEvent;
  assert.equal(event.targetPlayerId, b.id);
  assert.equal(event.phase, 'voting');
  game.voteGlobalEvent('socket-a', 'enforce');
  game.voteGlobalEvent('socket-b', 'dismiss');
  assert.equal(event.phase, 'voting'); // one ballot short of full turnout
  game.voteGlobalEvent('socket-c', 'enforce');
  assert.equal(event.resolvedChoice, 'enforce');
  assert.equal(b.publicEnemy, true); // leader voted against the outcome
  assert.equal(a.publicEnemy, false);
  assert.equal(c.publicEnemy, false);
  // A target that voted with the outcome escapes the label.
  const second = makeEventRoom({ players: 3 });
  const [owner, target, bystander] = second.game.players;
  ownsFullBrownGroup(second.game, owner);
  ownsTile(second.game, target, 16); // Orange
  ownsTile(second.game, target, 26); // Yellow
  second.game.roundNumber = 5;
  second.game.activateGlobalEvent(second.game.globalEventDefinition('anti-monopoly'));
  assert.equal(second.game.globalEvent.targetPlayerId, target.id);
  second.game.voteGlobalEvent('socket-a', 'dismiss');
  second.game.voteGlobalEvent('socket-b', 'enforce');
  second.game.voteGlobalEvent('socket-c', 'enforce');
  assert.equal(second.game.globalEvent.resolvedChoice, 'enforce');
  assert.equal(target.publicEnemy, false); // the target voted with the outcome
  assert.equal(owner.publicEnemy, false); // the label only ever hits the target
  assert.equal(bystander.publicEnemy, false);

  const combo = {
    id: 'legitimacy-crisis',
    title: 'LEGITIMACY CRISIS',
    summary: 'The policy vote is now part of the investigation.',
    choices: [
      { id: 'publish-audit', label: 'PUBLISH THE AUDIT', description: 'Expose the books and keep the policy under review.' },
      { id: 'bury-audit', label: 'Bury the audit', description: 'End the investigation quietly and accept the political fallout.' }
    ],
    effects: { taxMultiplier: 1.35, rentCap: 90, tradingEnabled: false },
    duration: 7
  };
  const third = makeEventRoom({ players: 3 });
  third.game.roundNumber = 5;
  third.game.activateGlobalEvent(third.game.globalEventDefinition('city-election'), combo);
  const crisis = third.game.globalEvent;
  assert.equal(crisis.id, 'legitimacy-crisis');
  third.game.voteGlobalEvent('socket-a', 'bury-audit');
  third.game.voteGlobalEvent('socket-b', 'publish-audit');
  third.game.voteGlobalEvent('socket-c', 'bury-audit');
  assert.equal(crisis.resolvedChoice, 'bury-audit');
  assert.equal(third.game.players[0].compromisedCouncil, true);
  assert.equal(third.game.players[1].compromisedCouncil, false);
  assert.equal(third.game.players[2].compromisedCouncil, true);
  assert.equal(third.game.feed[0].text, 'LEGITIMACY CRISIS resolved: BURY AUDIT.');
}

function testRentControlStipendSettlement() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsFullBrownGroup(game, a);
  a.cash = 500;
  b.cash = 700;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('rent-control'));
  // Warning phase applies no settlements yet.
  assert.equal(a.cash, 500);
  game.advanceRound();
  assert.equal(game.globalEvent.phase, 'active');
  assert.equal(a.cash, 525);
  assert.equal(b.cash, 700);
  assert.equal(game.feed[1].text, 'A received a $25 rent-control stipend.');
  assert.equal(game.feed[0].text, 'RENT CONTROL ORDINANCE is now active for 6 rounds.');
  // settlementApplied latch: re-activation settles nothing further.
  game.applyGlobalEventActivationSettlements();
  game.advanceRound();
  assert.equal(a.cash, 525);
}

function testCurrencyDevaluationSettlement() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 1000;
  b.cash = 0;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('currency-devaluation'));
  game.advanceRound();
  assert.equal(a.cash, 920);
  assert.equal(b.cash, 0);
  assert.equal(b.zeroCashReached, true);
  assert.ok(feedTexts(game).includes('CURRENCY DEVALUATION settled a visible cash adjustment across the table.'));
}

function testBankRunBailoutSettlement() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 100;
  a.bankLoan = { status: 'active', remaining: 450 };
  b.cash = 1200;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('bank-run'));
  game.voteGlobalEvent('socket-a', 'emergency-bailout');
  game.voteGlobalEvent('socket-b', 'emergency-bailout');
  const event = game.globalEvent;
  assert.equal(event.phase, 'active');
  assert.equal(event.resolvedChoice, 'emergency-bailout');
  assert.equal(a.cash, 250);
  assert.equal(b.cash, 1200);
  assert.equal(a.bailoutReceived, true);
  assert.equal(a.moralHazard, true);
  assert.equal(b.bailoutReceived, false);
  assert.ok(feedTexts(game).includes('A received a $150 emergency bailout.'));
  assert.ok(feedTexts(game).includes('BANK RUN resolved: EMERGENCY BAILOUT.'));
  const activeRound = game.roundNumber;
  game.advanceRound();
  assert.equal(a.cash, 250); // latch held across the next active round
  assert.equal(game.globalEvent.startedRound, activeRound);
}

// The rescue reaches only players below the distress bar the bank-run
// event itself uses (cash under 35% of starting cash). A solvent player who
// holds a bank loan is not distressed and must not be paid.
function testBankRunBailoutOnlyReachesDistressedPlayers() {
  const room = makeEventRoom({ players: 3 });
  const game = room.game;
  const [distressed, solventBorrower, atBar] = game.players;
  const bar = game.settings.startingCash * 0.35;
  distressed.cash = bar - 1;
  solventBorrower.cash = game.settings.startingCash;
  solventBorrower.bankLoan = { status: 'active', principal: 450, totalDue: 450, remaining: 450 };
  atBar.cash = bar;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('bank-run'));
  game.voteGlobalEvent('socket-a', 'emergency-bailout');
  game.voteGlobalEvent('socket-b', 'emergency-bailout');
  game.voteGlobalEvent('socket-c', 'emergency-bailout');
  assert.equal(game.globalEvent.resolvedChoice, 'emergency-bailout');
  assert.equal(distressed.cash, bar - 1 + 150, 'a distressed player receives the rescue payment');
  assert.equal(distressed.bailoutReceived, true);
  assert.equal(solventBorrower.cash, game.settings.startingCash, 'a solvent loan holder receives nothing');
  assert.ok(!solventBorrower.bailoutReceived);
  assert.ok(!solventBorrower.moralHazard);
  assert.equal(atBar.cash, bar, 'the distress bar is strict: exactly 35% is not distressed');
  assert.ok(!atBar.bailoutReceived);
  assert.ok(feedTexts(game).includes(`${distressed.nickname} received a $150 emergency bailout.`));
  assert.ok(!feedTexts(game).some(text => text.includes(`${solventBorrower.nickname} received`)));
}

// The bank-run bailout text must describe the rule that runs and
// must not promise a loan surcharge the event never applies.
function testBankRunBailoutCopyMatchesRule() {
  const room = makeEventRoom();
  const game = room.game;
  const choice = game.globalEventDefinition('bank-run').choices.find(entry => entry.id === 'emergency-bailout');
  assert.ok(choice.description.includes('35%'), 'the copy states the distress bar');
  assert.ok(!/surcharge|premium/i.test(choice.description), 'the bank-run bailout does not promise a loan premium');
  assert.equal(game.globalEventDefinition('bank-run').effects.loanPremiumMultiplier, undefined);
}

function testLetTheLedgerRunAndTaxAuditSettlement() {
  const room = makeEventRoom();
  const game = room.game;
  const [a] = game.players;
  a.cash = 100;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('bank-run'));
  game.voteGlobalEvent('socket-a', 'let-the-ledger-run');
  game.voteGlobalEvent('socket-b', 'let-the-ledger-run');
  assert.equal(game.globalEvent.resolvedChoice, 'let-the-ledger-run');
  assert.equal(a.cash, 100);
  assert.equal(a.bailoutReceived, false);
  assert.ok(!feedTexts(game).some(text => text.includes('emergency bailout')));

  const audit = makeEventRoom();
  const auditGame = audit.game;
  auditGame.settings.vacationCash = true;
  const [x] = auditGame.players;
  x.cash = 2000;
  auditGame.roundNumber = 6;
  auditGame.activateGlobalEvent(auditGame.globalEventDefinition('tax-audit'));
  auditGame.advanceRound();
  assert.equal(auditGame.globalEvent.phase, 'active');
  assert.equal(x.cash, 1800);
  assert.equal(auditGame.vacationPool, 200);
  assert.equal(x.taxAuditCount, 1);
  assert.equal(auditGame.feed[1].text, 'A paid $200 after the tax scandal audit.');
  // A zero-cash target settles nothing (the early return still latches).
  auditGame.globalEvent.settlementApplied = false;
  x.cash = 0;
  auditGame.applyGlobalEventActivationSettlements();
  assert.equal(x.cash, 0);
  assert.equal(x.taxAuditCount, 1);
  // Small balances pay the full remainder, capped by cash on hand.
  const small = makeEventRoom();
  small.game.roundNumber = 6;
  const [s, t] = small.game.players;
  s.cash = 10;
  t.cash = 10;
  small.game.activateGlobalEvent(small.game.globalEventDefinition('tax-audit'));
  small.game.advanceRound();
  assert.equal(s.cash, 0);
  assert.equal(s.zeroCashReached, true);
  assert.ok(feedTexts(small.game).includes('A paid $10 after the tax scandal audit.'));
  assert.equal(t.cash, 10);
}

function testInterestRateShockSettlement() {
  const room = makeEventRoom();
  const game = room.game;
  game.players.forEach(player => {
    player.bankLoan = { status: 'active', principal: 300, totalDue: 450, remaining: 450 };
  });
  game.activateGlobalEvent(game.globalEventDefinition('interest-rate-shock'));
  game.advanceRound();
  assert.equal(game.globalEvent.phase, 'active');
  assert.equal(game.players[0].bankLoan.remaining, 608);
  assert.equal(game.players[0].bankLoan.totalDue, 608);
  game.applyGlobalEventActivationSettlements();
  assert.equal(game.players[0].bankLoan.remaining, 608);
}

function testInterestRateShockPreservesPaidCredit() {
  const room = makeEventRoom();
  const game = room.game;
  game.players.forEach(player => {
    player.bankLoan = { status: 'active', principal: 300, totalDue: 450, remaining: 250 };
  });
  game.activateGlobalEvent(game.globalEventDefinition('interest-rate-shock'));
  game.advanceRound();
  // Paid 200 stays paid: 200 + ceil(250 × 1.35) = 538, not max(338, 450).
  assert.equal(game.players[0].bankLoan.remaining, 338);
  assert.equal(game.players[0].bankLoan.totalDue, 538);
}

function testLaborStrikeShortfallCreatesDebt() {
  const room = makeEventRoom();
  const game = room.game;
  const player = game.players[0];
  ownsFullBrownGroup(game, player);
  game.getTile(1).houseCount = 2;
  player.cash = 0;
  game.globalEvent = { id: 'labor-strike', phase: 'active', roundsRemaining: 2, durationRounds: 2, effects: { buildingMaintenance: 20 } };
  game.advanceGlobalEventPhase();
  assert.equal(game.pendingPayment.playerId, player.id);
  assert.equal(game.pendingPayment.amountRemaining, 40);
}

function testHousingBubbleSurvivorFlags() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsFullBrownGroup(game, a);
  game.getTile(1).houseCount = 2;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  game.advanceRound(); // -> active
  assert.equal(game.globalEvent.settlementApplied, true);
  for (let i = 0; i < game.globalEvent.durationRounds; i += 1) game.advanceRound();
  assert.equal(game.globalEvent.phase, 'recovery');
  assert.equal(a.bubbleSurvivor, true);
  assert.equal(a.housingBubbleEnded, true);
  assert.equal(b.bubbleSurvivor, false);
  assert.equal(b.housingBubbleEnded, true);
  game.players.forEach(player => assert.equal(player.globalEventsSurvived, 1));
}

function testActivePhaseEffectQueries() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  assert.equal(game.globalEventActive('housing-bubble'), false);
  assert.deepEqual(game.activeEventEffects(), {});
  game.advanceRound();
  assert.equal(game.globalEventActive('housing-bubble'), true);
  assert.equal(game.isConstructionBlocked(), true);
  // housing-bubble casinoMaxBet 300 applies regardless of the casino toggle.
  assert.equal(game.casinoLimits().maxBet, 300);
  assert.equal(game.globalEventDefinition('nope'), null);
  assert.equal(game.globalEventActive('bank-run'), false);
}

// The match owns the election. Once the match is over the headline is
// closed - it stays in the history - and a late ballot resolves nothing.
function testFinishedMatchRefusesTheBallot() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 4;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  game.endGame(game.players[0]);
  assert.equal(game.started, false);
  const late = game.voteGlobalEvent('socket-a', 'low-tax');
  assert.equal(late.success, false);
  assert.equal(late.error, 'The match has ended.');
  assert.equal(game.globalEvent, null, 'the headline is closed with the match');
  assert.equal(game.globalEventHistory[0].id, 'city-election', 'the headline is preserved in the history');
  assert.equal(game.globalEventHistory.length, 1, 'the history keeps one row for the closed headline');
  // A late resolution attempt changes nothing.
  game.resolveGlobalEventVote();
  assert.equal(game.globalEvent, null);
  assert.equal(game.players[0].lastVoteChoice, null, 'no ballot was recorded');
  assert.equal(game.players[1].lastVoteChoice, null);
  // The round ladder does not restart the closed headline either.
  game.advanceRound();
  assert.equal(game.globalEvent, null);
}

// A ballot names the election it was cast in. A ballot from another
// election must not count in the election on the table, even when the choice
// id exists in both.
function testStaleBallotIsRefused() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 4;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  const first = game.globalEvent;
  const stale = { eventId: first.id, voteRound: first.voteRound, voteNonce: first.voteNonce };
  // The next election shares the choice id with the closed one.
  game.globalEvent = null;
  game.activateGlobalEvent(game.globalEventDefinition('bank-run'));
  const second = game.globalEvent;
  assert.equal(second.id, 'bank-run');
  assert.deepEqual(
    game.voteGlobalEvent('socket-b', 'emergency-bailout', stale),
    { success: false, error: 'That vote belongs to a different election.' }
  );
  assert.deepEqual(second.votes, {}, 'the stale ballot was not counted');
  // A ballot that names the running election is accepted.
  const accepted = game.voteGlobalEvent('socket-b', 'emergency-bailout', { eventId: second.id, voteNonce: second.voteNonce });
  assert.equal(accepted.success, true);
  assert.equal(second.votes[game.players[1].id], 'emergency-bailout');
}

// A vote is a write, so it is idempotent: the same request id answers
// the same way twice and is counted once.
function testVoteRequestIdIsCountedOnce() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 4;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  const event = game.globalEvent;
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'low-tax', { requestId: 'ballot-1' }), { success: true });
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'low-tax', { requestId: ' ballot-1 ' }), { success: true });
  assert.equal(Object.keys(event.votes).length, 1, 'the replay is not counted twice');
  assert.equal(event.votes[game.players[0].id], 'low-tax');
}

// The socket layer carries the ballot identity to the game, so a ballot
// that names another election never reaches the tally.
function testSocketVoteCarriesTheBallotIdentity() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', rulesProfile: 'advanced' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.setRoomSetting('globalEvents', true);
  assert.equal(room.startGame().success, true);
  room.game.roundNumber = 4;
  room.game.activateGlobalEvent(room.game.globalEventDefinition('city-election'));
  const event = room.game.globalEvent;
  const handlers = new Map();
  const socket = { id: 'socket-a', emitted: [], emit() {} };
  const runtime = {
    getRoomForSocket() { return room; },
    emitRoomState() {},
    io: { to: () => ({ emit() {} }), in: () => ({ emit() {} }) }
  };
  registerGameSocketHandlers((name, handler) => handlers.set(name, handler), socket, runtime);
  const vote = handlers.get('vote-global-event');
  const invoke = payload => {
    let response;
    vote(payload, value => { response = value; });
    return response;
  };
  const refused = invoke({ choiceId: 'low-tax', eventId: 'anti-monopoly', voteNonce: 'anti-monopoly-1' });
  assert.equal(refused.success, false);
  assert.equal(refused.error, 'That vote belongs to a different election.');
  assert.deepEqual(event.votes, {}, 'the refused ballot was not counted');
  const accepted = invoke({ choiceId: 'low-tax', eventId: event.id, voteNonce: event.voteNonce });
  assert.equal(accepted.success, true);
  assert.equal(event.votes[room.game.players[0].id], 'low-tax');
}

// A combination is the sum of the headlines it fused. The order the
// halves happened to arrive in must not decide the payload.
function testComboEffectsDoNotDependOnTriggerOrder() {
  const combo = GLOBAL_EVENT_COMBINATIONS.find(candidate => candidate.id === 'moral-hazard');
  const [bankRun, debtAmnesty] = combo.required;
  const first = makeEventRoom();
  first.game.roundNumber = 8;
  first.game.activateGlobalEvent(first.game.globalEventDefinition(bankRun), combo);
  const second = makeEventRoom();
  second.game.roundNumber = 8;
  second.game.activateGlobalEvent(second.game.globalEventDefinition(debtAmnesty), combo);
  assert.deepEqual(first.game.globalEvent.effects, second.game.globalEvent.effects, 'the combination payload does not depend on which half fired it');
  // The bank-run half contributes its auction, market and casino effects.
  assert.equal(first.game.globalEvent.effects.auctionBlocked, true);
  assert.equal(first.game.globalEvent.effects.casinoMaxBet, 250);
  assert.equal(first.game.globalEvent.effects.tradingEnabled, false);
  // The debt-amnesty half contributes its settlement discount.
  assert.equal(first.game.globalEvent.effects.loanSettlementMultiplier, 0.8);
  // The combination's own effects still win.
  assert.equal(first.game.globalEvent.effects.loanPremiumMultiplier, 1.6);
  assert.equal(first.game.globalEvent.effects.bankActionsBlocked, true);
}

// The debt-amnesty settlement discount follows the headline into a combination:
// a full repayment under moral-hazard costs 0.8x the balance, like plain amnesty.
function fullRepaymentCostUnder(eventId, comboId) {
  const room = makeEventRoom();
  const game = room.game;
  const player = game.players[0];
  game.currentPlayerId = player.id;
  game.roundNumber = 8;
  const combo = comboId ? GLOBAL_EVENT_COMBINATIONS.find(candidate => candidate.id === comboId) : null;
  game.activateGlobalEvent(game.globalEventDefinition(eventId), combo);
  game.advanceRound(); // warning -> active
  assert.equal(game.globalEvent.phase, 'active');
  game.currentPlayerId = player.id;
  player.cash = 1000;
  player.bankLoan = { status: 'active', remaining: 450, collateralTileIndex: null, issuedRound: 1, dueRound: 20, cureRound: 21 };
  const result = game.repayBankLoan('socket-a', { amount: 450, requestId: `amnesty-${eventId}-${comboId}` });
  assert.equal(result.success, true, result.error);
  assert.equal(player.bankLoan.status, 'paid');
  return 1000 - player.cash;
}

function testDebtAmnestyDiscountAppliesUnderTheMoralHazardCombo() {
  assert.equal(fullRepaymentCostUnder('debt-amnesty', null), 360, 'plain debt-amnesty is unchanged');
  assert.equal(fullRepaymentCostUnder('bank-run', 'moral-hazard'), 360, 'the fused debt-amnesty discount applies');
}

// The lifecycle rules belong to the headline, so a combination runs the
// rules of the headlines it fused.
function testComboRunsTheComponentLifecycle() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsTile(game, a, 5); // ACC Airport is a railroad
  const travelChaos = GLOBAL_EVENT_COMBINATIONS.find(candidate => candidate.id === 'travel-chaos');
  game.roundNumber = 1;
  game.activateGlobalEvent(game.globalEventDefinition('tourism-boom'), travelChaos);
  assert.equal(a.airportOwnedDuringStrike, true, 'the airport-strike hook runs for the fused headline');
  game.advanceRound(); // warning -> active
  assert.equal(game.globalEvent.phase, 'active');
  ownsTile(game, b, 5);
  game.recordAirportStrikeRentFacts(game.getTile(1), b);
  assert.equal(b.airportOwnedDuringStrike, true, 'the airport-strike tile rule runs for the fused headline');
  assert.equal(b.nonAirportRentDuringStrike, true);
}

// The recovery rule belongs to the housing bubble, so it also runs when
// the bubble was fused into a combination.
function testComboRecoveryEndsTheHousingBubble() {
  const room = makeEventRoom();
  const game = room.game;
  const foreclosure = GLOBAL_EVENT_COMBINATIONS.find(candidate => candidate.id === 'foreclosure-spiral');
  game.activateGlobalEvent(game.globalEventDefinition('credit-freeze'), foreclosure);
  game.globalEvent.phase = 'active';
  game.beginGlobalEventRecovery();
  assert.equal(game.globalEvent.phase, 'recovery');
  game.players.forEach(player => assert.equal(player.housingBubbleEnded, true));
}

// The activation settlement reprices loans and pays bailouts against the
// table's cash. Under an open payment or a live auction that money is spoken
// for, so the settlement waits for the obligation to clear.
function testActivationSettlementWaitsForTheTableObligation() {
  const room = makeEventRoom();
  const game = room.game;
  const [a] = game.players;
  a.bankLoan = { status: 'active', principal: 450, remaining: 450, totalDue: 450, issuedRound: 1, dueRound: 50, cureRound: null };
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('interest-rate-shock'));
  const event = game.globalEvent;
  assert.equal(event.phase, 'warning');
  game.pendingPayment = { playerId: a.id, creditorId: null, amountRemaining: 450, reason: 'bank debt' };
  game.advanceRound(); // the warning becomes active under a parked payment
  assert.equal(event.phase, 'active');
  assert.equal(event.settlementApplied, undefined, 'the settlement waits for the obligation');
  assert.equal(a.bankLoan.remaining, 450, 'no repricing lands under the parked payment');
  game.pendingPayment = null;
  game.advanceRound(); // the obligation cleared: the settlement lands now
  assert.equal(event.settlementApplied, true);
  assert.equal(a.bankLoan.remaining, 608, 'the repricing lands once the table is clear');
}

const CONTRACT_SUITES = [
  ['activate: warning snapshot + phase ladder', testActivateWarningSnapshot],
  ['activate: duration scaling (housing-bubble vs others)', testActivateDurationScaling],
  ['activate: voting choices copy', testActivateVotingChoices],
  ['activate: anti-monopoly leader / tax-audit target', testActivateTargetSelection],
  ['activate: airport-strike ownership flags', testActivateAirportStrikeFlags],
  ['activate: combo merge + comboExperienced', testActivateCombo],
  ['maybeTrigger: settings/started/active/cooldown/round/cap gates', testMaybeTriggerGating],
  ['maybeTrigger: chance thresholds + weighted selection', testMaybeTriggerChanceAndSelection],
  ['maybeTrigger: surprise combination chaining', testMaybeTriggerComboPath],
  ['vote: guards and tallies', testVoteGuards],
  ['vote: waits for pending payment and open auction', testVoteWaitsForTableObligations],
  ['resolveVote: preconditions', testResolveVotePreconditions],
  ['resolveVote: unanimous + full-turnout auto-resolve', testResolveVoteUnanimous],
  ['resolveVote: split and zero-turnout enact no choice (A8-06)', testResolveVoteTieAndTimeout],
  ['resolveVote: strict majority of active seats at 2, 3, 4 and 6 seats (A8-06)', testVoteNeedsStrictMajorityOfActiveSeats],
  ['resolveVote: publicEnemy + compromisedCouncil', testResolveVoteAntiMonopolyAndLegitimacy],
  ['settlements: rent-control stipend + latch', testRentControlStipendSettlement],
  ['settlements: currency devaluation + zero-cash flag', testCurrencyDevaluationSettlement],
  ['settlements: bank-run bailout', testBankRunBailoutSettlement],
  ['settlements: bank-run bailout reaches only distressed players (F-035)', testBankRunBailoutOnlyReachesDistressedPlayers],
  ['copy: bank-run bailout text matches the rule (F-035)', testBankRunBailoutCopyMatchesRule],
  ['settlements: ledger-run no-op + tax-audit amounts', testLetTheLedgerRunAndTaxAuditSettlement],
  ['settlements: interest-rate shock reprices existing loans once', testInterestRateShockSettlement],
  ['settlements: interest-rate shock preserves paid credit', testInterestRateShockPreservesPaidCredit],
  ['settlements: labor-strike shortfalls become payable debt', testLaborStrikeShortfallCreatesDebt],
  ['phases: housing-bubble survivor flags', testHousingBubbleSurvivorFlags],
  ['effects: active-phase queries', testActivePhaseEffectQueries],
  ['vote: a finished match refuses the ballot and closes the headline', testFinishedMatchRefusesTheBallot],
  ['vote: a ballot from another election is stale', testStaleBallotIsRefused],
  ['vote: the same request id is counted once', testVoteRequestIdIsCountedOnce],
  ['vote: the socket layer carries the ballot identity', testSocketVoteCarriesTheBallotIdentity],
  ['combo: the effects do not depend on which half fired it', testComboEffectsDoNotDependOnTriggerOrder],
  ['combo: the debt-amnesty discount applies under moral-hazard', testDebtAmnestyDiscountAppliesUnderTheMoralHazardCombo],
  ['combo: the component hooks and tile rules run',testComboRunsTheComponentLifecycle],
  ['combo: the housing-bubble recovery rule runs', testComboRecoveryEndsTheHousingBubble],
  ['settlements: the activation settlement waits for the table obligation', testActivationSettlementWaitsForTheTableObligation]
];

let passedCount = 0;
const failedSuites = [];
for (const [name, fn] of CONTRACT_SUITES) {
  try {
    await fn();
    passedCount += 1;
    console.log(`PASS - ${name}`);
  } catch (error) {
    failedSuites.push([name, error]);
    console.error(`FAIL - ${name}: ${error && error.message}`);
  }
}
const total = passedCount + failedSuites.length;
console.log(`global-events tests: ${total} suites, ${passedCount} passed, ${failedSuites.length} failed`);
if (failedSuites.length) {
  process.exitCode = 1;
}
